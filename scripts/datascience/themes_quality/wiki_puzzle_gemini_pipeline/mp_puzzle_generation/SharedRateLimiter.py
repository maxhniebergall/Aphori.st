#!/usr/bin/env python3
"""
SharedRateLimiter - Manager-based rate limiting for multiprocessing

This module provides a rate limiter using multiprocessing.Manager for
safe concurrent rate limiting across multiple processes.
"""

import logging
import multiprocessing as mp
import threading
import time
from contextlib import contextmanager
from typing import Dict, Any

logger = logging.getLogger(__name__)


class SharedRateLimiter:
    """
    Process-safe rate limiter using multiprocessing.Manager for shared state.
    
    This rate limiter ensures that all worker processes collectively stay within
    the API rate limits using shared counters and timestamps.
    """
    
    def __init__(self, 
                 requests_per_minute: int = 2900,
                 min_request_interval: float = 0.1,
                 max_concurrent_requests: int = 10):
        """
        Initialize shared rate limiter.
        
        Args:
            requests_per_minute: Maximum requests per minute across all processes
            min_request_interval: Minimum time between any two requests (seconds)
            max_concurrent_requests: Maximum concurrent requests
        """
        self.requests_per_minute = requests_per_minute
        self.min_request_interval = min_request_interval
        self.max_concurrent_requests = max_concurrent_requests
        
        # Initialize multiprocessing manager
        self.manager = mp.Manager()
        
        # Shared state for rate limiting
        self.shared_state = self.manager.dict({
            'last_request_time': 0.0,
            'active_requests': 0,
            'total_requests': 0,
            'requests_this_minute': 0,
            'minute_start_time': time.time(),
            'requests_per_second': 0.0,
            'last_second': int(time.time())
        })
        
        # Statistics tracking
        self.stats = self.manager.dict({
            'requests_made': 0,
            'requests_blocked_rpm': 0,
            'requests_blocked_interval': 0,
            'requests_blocked_concurrent': 0,
            'total_wait_time': 0.0,
            'longest_wait': 0.0,
            'start_time': time.time()
        })
        
        # Shared locks for coordination
        self.request_lock = self.manager.Lock()
        self.active_lock = self.manager.Lock()
        # Protect composite RMW operations on stats
        self.stats_lock = self.manager.Lock()
        
        # Shared counters using Value for atomic operations
        self.total_requests = mp.Value('i', 0)
        
        logger.info(f"SharedRateLimiter initialized: {requests_per_minute} RPM, "
                   f"{min_request_interval}s interval, {max_concurrent_requests} concurrent")
    
    def _reset_minute_counter(self, current_time: float):
        """Reset the minute counter if we've moved to a new minute."""
        if current_time - self.shared_state['minute_start_time'] >= 60:
            self.shared_state['requests_this_minute'] = 0
            self.shared_state['minute_start_time'] = current_time
    
    def _update_rps_counter(self, current_time: float):
        """Update requests per second counter."""
        current_second = int(current_time)
        if current_second != self.shared_state['last_second']:
            # Reset RPS counter for new second
            self.shared_state['requests_per_second'] = 0.0
            self.shared_state['last_second'] = current_second
    
    def _wait_for_rpm_limit(self) -> float:
        """Wait if we're at the RPM limit."""
        wait_time = 0.0
        
        # Compute wait time while holding lock
        with self.request_lock:
            current_time = time.time()
            self._reset_minute_counter(current_time)
            
            if self.shared_state['requests_this_minute'] >= self.requests_per_minute:
                # Calculate wait time until next minute
                wait_time = 60 - (current_time - self.shared_state['minute_start_time'])
                if wait_time > 0:
                    logger.debug(f"RPM limit reached: waiting {wait_time:.2f}s")
                    
                    # Update stats (atomic section)
                    with self.stats_lock:
                        self.stats['requests_blocked_rpm'] += 1
                        self.stats['total_wait_time'] += wait_time
                        self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
        
        # Sleep outside the lock to avoid global stall
        if wait_time > 0:
            time.sleep(wait_time)
            
            # Reacquire lock to reset counter and recheck state
            with self.request_lock:
                current_time = time.time()
                self._reset_minute_counter(current_time)
                # Reset counter after waiting - we've waited a full minute
                self.shared_state['requests_this_minute'] = 0
                self.shared_state['minute_start_time'] = current_time
        
        return wait_time
    
    def _wait_for_interval_limit(self) -> float:
        """Wait for minimum interval between requests."""
        wait_time = 0.0
        current_time = time.time()
        
        with self.request_lock:
            time_since_last = current_time - self.shared_state['last_request_time']
            
            if time_since_last < self.min_request_interval:
                wait_time = self.min_request_interval - time_since_last
                logger.debug(f"Interval limit: waiting {wait_time:.3f}s")
                
                # Update stats (atomic section)
                with self.stats_lock:
                    self.stats['requests_blocked_interval'] += 1
                    self.stats['total_wait_time'] += wait_time
                    self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                
                time.sleep(wait_time)
        
        return wait_time
    
    def _wait_for_concurrent_limit(self) -> float:
        """Wait if we're at the concurrent request limit."""
        wait_time = 0.0
        start_wait = time.time()
        
        while True:
            with self.active_lock:
                if self.shared_state['active_requests'] < self.max_concurrent_requests:
                    self.shared_state['active_requests'] += 1
                    break
            
            logger.debug("Concurrent limit reached: waiting")
            time.sleep(0.1)
            wait_time = time.time() - start_wait
            
            # Prevent infinite waiting
            if wait_time > 60:  # 60 second timeout
                logger.warning("Concurrent limit wait timeout, proceeding anyway")
                with self.active_lock:
                    self.shared_state['active_requests'] += 1
                break
        
        if wait_time > 0:
            with self.stats_lock:
                self.stats['requests_blocked_concurrent'] += 1
                self.stats['total_wait_time'] += wait_time
                self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
        
        return wait_time
    
    @contextmanager
    def acquire_request_slot(self):
        """Context manager to acquire a request slot with rate limiting."""
        # Wait for all rate limits
        self._wait_for_rpm_limit()
        self._wait_for_interval_limit()
        self._wait_for_concurrent_limit()
        
        # Record this request
        current_time = time.time()
        with self.request_lock:
            self.shared_state['last_request_time'] = current_time
            self.shared_state['requests_this_minute'] += 1
            self.shared_state['total_requests'] += 1
            
            # Update RPS counter
            self._update_rps_counter(current_time)
            self.shared_state['requests_per_second'] += 1
        
        # Update stats
        with self.stats_lock:
            self.stats['requests_made'] += 1
        self.total_requests.value += 1
        
        try:
            yield
        finally:
            # Release concurrent request slot
            with self.active_lock:
                self.shared_state['active_requests'] = max(0, self.shared_state['active_requests'] - 1)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get rate limiter statistics."""
        current_time = time.time()
        elapsed_time = current_time - self.stats['start_time']
        
        # Create a copy to avoid issues with shared dict
        stats_copy = dict(self.stats)
        stats_copy.update({
            'active_requests': self.shared_state['active_requests'],
            'total_requests': self.shared_state['total_requests'],
            'requests_this_minute': self.shared_state['requests_this_minute'],
            'requests_per_second': self.shared_state['requests_per_second'],
            'requests_per_minute_limit': self.requests_per_minute,
            'max_concurrent_limit': self.max_concurrent_requests,
            'min_request_interval': self.min_request_interval,
            'elapsed_time': elapsed_time,
            'average_wait_time': stats_copy['total_wait_time'] / max(stats_copy['requests_made'], 1)
        })
        return stats_copy
    
    def get_shared_data(self) -> Dict[str, Any]:
        """
        Get data needed by worker processes.
        
        Returns:
            Dictionary containing shared state and locks
        """
        return {
            'shared_state': self.shared_state,
            'stats': self.stats,
            'request_lock': self.request_lock,
            'active_lock': self.active_lock,
            'stats_lock': self.stats_lock,
            'config': {
                'requests_per_minute': self.requests_per_minute,
                'min_request_interval': self.min_request_interval,
                'max_concurrent_requests': self.max_concurrent_requests
            }
        }
    
    def reset_stats(self):
        """Reset all statistics counters."""
        current_time = time.time()
        with self.request_lock:
            self.shared_state.update({
                'total_requests': 0,
                'requests_this_minute': 0,
                'minute_start_time': current_time,
                'requests_per_second': 0.0,
                'last_second': int(current_time)
            })
        with self.stats_lock:
            self.stats.update({
                'requests_made': 0,
                'requests_blocked_rpm': 0,
                'requests_blocked_interval': 0,
                'requests_blocked_concurrent': 0,
                'total_wait_time': 0.0,
                'longest_wait': 0.0,
                'start_time': current_time
            })
        self.total_requests.value = 0
        logger.info("Rate limiter statistics reset")


class WorkerRateLimiter:
    """
    Worker-side rate limiter that uses shared state from SharedRateLimiter.
    
    This class is used by worker processes to access the shared rate limiting
    functionality without needing the full SharedRateLimiter instance.
    """
    
    def __init__(self, shared_data: Dict[str, Any]):
        """
        Initialize worker rate limiter with shared data.
        
        Args:
            shared_data: Shared data from SharedRateLimiter.get_shared_data()
        """
        self.shared_state = shared_data['shared_state']
        self.stats = shared_data['stats']
        self.request_lock = shared_data['request_lock']
        self.active_lock = shared_data['active_lock']
        self.stats_lock = shared_data['stats_lock']
        self.config = shared_data['config']
        
        self.requests_per_minute = self.config['requests_per_minute']
        self.min_request_interval = self.config['min_request_interval']
        self.max_concurrent_requests = self.config['max_concurrent_requests']
    
    def _reset_minute_counter(self, current_time: float):
        """Reset the minute counter if we've moved to a new minute."""
        if current_time - self.shared_state['minute_start_time'] >= 60:
            self.shared_state['requests_this_minute'] = 0
            self.shared_state['minute_start_time'] = current_time
    
    def _wait_for_rpm_limit(self) -> float:
        """Wait if we're at the RPM limit."""
        wait_time = 0.0
        current_time = time.time()
        
        with self.request_lock:
            self._reset_minute_counter(current_time)
            
            if self.shared_state['requests_this_minute'] >= self.requests_per_minute:
                # Wait until the next minute
                wait_time = 60 - (current_time - self.shared_state['minute_start_time'])
                if wait_time > 0:
                    logger.debug(f"Worker RPM limit: waiting {wait_time:.2f}s")
                    
                    # Update stats (atomic section)
                    with self.stats_lock:
                        self.stats['requests_blocked_rpm'] += 1
                        self.stats['total_wait_time'] += wait_time
                        self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                    
                    time.sleep(wait_time)
                    # Reset counter after waiting
                    self.shared_state['requests_this_minute'] = 0
                    self.shared_state['minute_start_time'] = time.time()
        
        return wait_time
    
    def _wait_for_interval_limit(self) -> float:
        """Wait for minimum interval between requests."""
        wait_time = 0.0
        current_time = time.time()
        
        with self.request_lock:
            time_since_last = current_time - self.shared_state['last_request_time']
            
            if time_since_last < self.min_request_interval:
                wait_time = self.min_request_interval - time_since_last
                logger.debug(f"Worker interval limit: waiting {wait_time:.3f}s")
                
                # Update stats (atomic section)
                with self.stats_lock:
                    self.stats['requests_blocked_interval'] += 1
                    self.stats['total_wait_time'] += wait_time
                    self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                
                time.sleep(wait_time)
        
        return wait_time
    
    def _wait_for_concurrent_limit(self) -> float:
        """Wait if we're at the concurrent request limit."""
        wait_time = 0.0
        start_wait = time.time()
        
        while True:
            with self.active_lock:
                if self.shared_state['active_requests'] < self.max_concurrent_requests:
                    self.shared_state['active_requests'] += 1
                    break
            
            logger.debug("Worker concurrent limit: waiting")
            time.sleep(0.1)
            wait_time = time.time() - start_wait
            
            # Prevent infinite waiting
            if wait_time > 60:
                logger.warning("Worker concurrent limit timeout, proceeding anyway")
                with self.active_lock:
                    self.shared_state['active_requests'] += 1
                break
        
        if wait_time > 0:
            with self.stats_lock:
                self.stats['requests_blocked_concurrent'] += 1
                self.stats['total_wait_time'] += wait_time
                self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
        
        return wait_time
    
    @contextmanager
    def acquire_request_slot(self):
        """Context manager to acquire a request slot with rate limiting."""
        # Wait for all rate limits
        self._wait_for_rpm_limit()
        self._wait_for_interval_limit()
        self._wait_for_concurrent_limit()
        
        # Record this request
        current_time = time.time()
        with self.request_lock:
            self.shared_state['last_request_time'] = current_time
            self.shared_state['requests_this_minute'] += 1
            self.shared_state['total_requests'] += 1
        
        # Update stats
        with self.stats_lock:
            self.stats['requests_made'] += 1
        
        try:
            yield
        finally:
            # Release concurrent request slot
            with self.active_lock:
                self.shared_state['active_requests'] = max(0, self.shared_state['active_requests'] - 1)


if __name__ == "__main__":
    # Test the shared rate limiter
    import threading
    
    logging.basicConfig(level=logging.INFO)
    
    rate_limiter = SharedRateLimiter(requests_per_minute=60, min_request_interval=0.5, max_concurrent_requests=2)
    
    def test_requests():
        for i in range(5):
            with rate_limiter.acquire_request_slot():
                print(f"Making request {i+1}")
                time.sleep(0.1)  # Simulate API call
    
    # Test with multiple threads
    threads = []
    for i in range(3):
        thread = threading.Thread(target=test_requests)
        threads.append(thread)
        thread.start()
    
    for thread in threads:
        thread.join()
    
    print(f"Final stats: {rate_limiter.get_stats()}")