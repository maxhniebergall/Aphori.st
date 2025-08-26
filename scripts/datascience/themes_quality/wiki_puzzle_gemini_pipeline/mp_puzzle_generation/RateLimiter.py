#!/usr/bin/env python3
"""
RateLimiter - Cross-process rate limiting for Gemini API calls

This module provides thread-safe and process-safe rate limiting to ensure
that all workers respect the Gemini API rate limits (RPM and concurrent requests).
"""

import logging
import time
import threading
from collections import deque
from contextlib import contextmanager
from typing import Optional, Dict, Any
from multiprocessing import Manager, Process, Value
from pathlib import Path
import json

logger = logging.getLogger(__name__)


class SharedRateLimiter:
    """
    Process-safe rate limiter using multiprocessing.Manager for shared state.
    
    This rate limiter ensures that all worker processes collectively stay within
    the API rate limits for Gemini embedding requests.
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
        
        # Shared state using multiprocessing.Manager
        self.manager = Manager()
        
        # Shared lists and values for cross-process coordination
        self.request_times = self.manager.list()  # Timestamps of recent requests
        self.last_request_time = self.manager.Value('d', 0.0)  # Last request timestamp
        self.active_requests = self.manager.Value('i', 0)  # Current active requests
        self.total_requests = self.manager.Value('i', 0)  # Total requests made
        
        # Locks for thread safety within processes
        self.request_lock = self.manager.Lock()
        self.rpm_lock = self.manager.Lock()
        self.active_lock = self.manager.Lock()
        
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
        
        logger.info(f"SharedRateLimiter initialized: {requests_per_minute} RPM, "
                   f"{min_request_interval}s interval, {max_concurrent_requests} concurrent")
    
    def _cleanup_old_request_times(self, current_time: float):
        """Remove request timestamps older than 1 minute."""
        one_minute_ago = current_time - 60
        
        # Convert to regular list for manipulation
        times_list = list(self.request_times)
        # Filter out old timestamps
        recent_times = [t for t in times_list if t > one_minute_ago]
        
        # Update the shared list
        self.request_times[:] = recent_times
    
    def _wait_for_rpm_limit(self) -> float:
        """
        Wait if we're at the RPM limit.
        Returns wait time in seconds.
        """
        wait_time = 0.0
        current_time = time.time()
        
        with self.rpm_lock:
            self._cleanup_old_request_times(current_time)
            
            if len(self.request_times) >= self.requests_per_minute:
                # Calculate wait time until oldest request is more than 1 minute old
                oldest_request_time = min(self.request_times)
                wait_time = 60 - (current_time - oldest_request_time)
                
                if wait_time > 0:
                    logger.info(f"🚦 RPM limit reached: waiting {wait_time:.2f}s "
                              f"({len(self.request_times)}/{self.requests_per_minute} requests in last minute)")
                    
                    # Update stats
                    self.stats['requests_blocked_rpm'] += 1
                    self.stats['total_wait_time'] += wait_time
                    self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                    
                    time.sleep(wait_time)
                    current_time = time.time()
                    self._cleanup_old_request_times(current_time)
        
        return wait_time
    
    def _wait_for_interval_limit(self) -> float:
        """
        Wait for minimum interval between requests.
        Returns wait time in seconds.
        """
        wait_time = 0.0
        current_time = time.time()
        
        with self.request_lock:
            time_since_last = current_time - self.last_request_time.value
            
            if time_since_last < self.min_request_interval:
                wait_time = self.min_request_interval - time_since_last
                
                logger.debug(f"⏱️ Interval limit: waiting {wait_time:.3f}s "
                           f"(min interval: {self.min_request_interval}s)")
                
                # Update stats
                self.stats['requests_blocked_interval'] += 1
                self.stats['total_wait_time'] += wait_time
                self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                
                time.sleep(wait_time)
        
        return wait_time
    
    def _wait_for_concurrent_limit(self) -> float:
        """
        Wait if we're at the concurrent request limit.
        Returns wait time in seconds.
        """
        wait_time = 0.0
        start_wait = time.time()
        
        while True:
            with self.active_lock:
                if self.active_requests.value < self.max_concurrent_requests:
                    # We can proceed
                    self.active_requests.value += 1
                    break
            
            # Wait a bit before checking again
            logger.debug(f"🔄 Concurrent limit reached: waiting "
                        f"({self.active_requests.value}/{self.max_concurrent_requests} active)")
            time.sleep(0.1)
            wait_time = time.time() - start_wait
        
        if wait_time > 0:
            self.stats['requests_blocked_concurrent'] += 1
            self.stats['total_wait_time'] += wait_time
            self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
        
        return wait_time
    
    @contextmanager
    def acquire_request_slot(self):
        """
        Context manager to acquire a request slot with rate limiting.
        
        Usage:
            with rate_limiter.acquire_request_slot():
                # Make API request here
                response = api_client.make_request()
        """
        total_wait_time = 0.0
        
        try:
            # Wait for all rate limits
            total_wait_time += self._wait_for_rpm_limit()
            total_wait_time += self._wait_for_interval_limit()
            total_wait_time += self._wait_for_concurrent_limit()
            
            # Record this request
            current_time = time.time()
            with self.rpm_lock:
                self.request_times.append(current_time)
            
            with self.request_lock:
                self.last_request_time.value = current_time
            
            # Update stats
            self.stats['requests_made'] += 1
            self.total_requests.value += 1
            
            if total_wait_time > 0:
                logger.debug(f"⏳ Total wait time for request: {total_wait_time:.3f}s")
            
            yield
            
        finally:
            # Release concurrent request slot
            with self.active_lock:
                self.active_requests.value -= 1
    
    def get_stats(self) -> Dict[str, Any]:
        """Get rate limiter statistics."""
        current_time = time.time()
        elapsed_time = current_time - self.stats['start_time']
        
        stats_dict = dict(self.stats)
        stats_dict.update({
            'active_requests': self.active_requests.value,
            'total_requests': self.total_requests.value,
            'recent_request_count': len(self.request_times),
            'elapsed_time': elapsed_time,
            'requests_per_second': self.total_requests.value / max(elapsed_time, 1),
            'average_wait_time': self.stats['total_wait_time'] / max(self.stats['requests_made'], 1)
        })
        
        return stats_dict
    
    def reset_stats(self):
        """Reset statistics counters."""
        self.stats.update({
            'requests_made': 0,
            'requests_blocked_rpm': 0,
            'requests_blocked_interval': 0,
            'requests_blocked_concurrent': 0,
            'total_wait_time': 0.0,
            'longest_wait': 0.0,
            'start_time': time.time()
        })
        self.total_requests.value = 0


class LocalRateLimiter:
    """
    Thread-safe rate limiter for single-process use.
    
    This is a simpler rate limiter for when multiprocessing is not needed.
    It provides the same interface but uses threading primitives.
    """
    
    def __init__(self, 
                 requests_per_minute: int = 2900,
                 min_request_interval: float = 0.1,
                 max_concurrent_requests: int = 10):
        """Initialize local rate limiter."""
        self.requests_per_minute = requests_per_minute
        self.min_request_interval = min_request_interval
        self.max_concurrent_requests = max_concurrent_requests
        
        # Thread-safe data structures
        self.request_times = deque()
        self.last_request_time = 0.0
        self.active_requests = 0
        self.total_requests = 0
        
        # Thread locks
        self.request_lock = threading.Lock()
        self.rpm_lock = threading.Lock()
        self.active_lock = threading.Lock()
        
        # Statistics
        self.stats = {
            'requests_made': 0,
            'requests_blocked_rpm': 0,
            'requests_blocked_interval': 0,
            'requests_blocked_concurrent': 0,
            'total_wait_time': 0.0,
            'longest_wait': 0.0,
            'start_time': time.time()
        }
        
        logger.info(f"LocalRateLimiter initialized: {requests_per_minute} RPM, "
                   f"{min_request_interval}s interval, {max_concurrent_requests} concurrent")
    
    def _cleanup_old_request_times(self, current_time: float):
        """Remove request timestamps older than 1 minute."""
        one_minute_ago = current_time - 60
        while self.request_times and self.request_times[0] < one_minute_ago:
            self.request_times.popleft()
    
    @contextmanager
    def acquire_request_slot(self):
        """Context manager to acquire a request slot with rate limiting."""
        total_wait_time = 0.0
        
        try:
            # RPM limiting
            current_time = time.time()
            with self.rpm_lock:
                self._cleanup_old_request_times(current_time)
                
                if len(self.request_times) >= self.requests_per_minute:
                    wait_time = 60 - (current_time - self.request_times[0])
                    if wait_time > 0:
                        logger.info(f"🚦 RPM limit: waiting {wait_time:.2f}s")
                        self.stats['requests_blocked_rpm'] += 1
                        self.stats['total_wait_time'] += wait_time
                        self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                        time.sleep(wait_time)
                        total_wait_time += wait_time
                        current_time = time.time()
                        self._cleanup_old_request_times(current_time)
            
            # Interval limiting
            with self.request_lock:
                time_since_last = current_time - self.last_request_time
                if time_since_last < self.min_request_interval:
                    wait_time = self.min_request_interval - time_since_last
                    logger.debug(f"⏱️ Interval limit: waiting {wait_time:.3f}s")
                    self.stats['requests_blocked_interval'] += 1
                    self.stats['total_wait_time'] += wait_time
                    self.stats['longest_wait'] = max(self.stats['longest_wait'], wait_time)
                    time.sleep(wait_time)
                    total_wait_time += wait_time
                    current_time = time.time()
            
            # Concurrent limiting
            start_wait = time.time()
            while True:
                with self.active_lock:
                    if self.active_requests < self.max_concurrent_requests:
                        self.active_requests += 1
                        break
                logger.debug(f"🔄 Concurrent limit: waiting ({self.active_requests}/{self.max_concurrent_requests})")
                time.sleep(0.1)
            
            concurrent_wait = time.time() - start_wait
            if concurrent_wait > 0:
                self.stats['requests_blocked_concurrent'] += 1
                self.stats['total_wait_time'] += concurrent_wait
                self.stats['longest_wait'] = max(self.stats['longest_wait'], concurrent_wait)
                total_wait_time += concurrent_wait
            
            # Record this request
            with self.rpm_lock:
                self.request_times.append(current_time)
            with self.request_lock:
                self.last_request_time = current_time
            
            self.stats['requests_made'] += 1
            self.total_requests += 1
            
            yield
            
        finally:
            with self.active_lock:
                self.active_requests -= 1
    
    def get_stats(self) -> Dict[str, Any]:
        """Get rate limiter statistics."""
        current_time = time.time()
        elapsed_time = current_time - self.stats['start_time']
        
        return {
            **self.stats,
            'active_requests': self.active_requests,
            'total_requests': self.total_requests,
            'recent_request_count': len(self.request_times),
            'elapsed_time': elapsed_time,
            'requests_per_second': self.total_requests / max(elapsed_time, 1),
            'average_wait_time': self.stats['total_wait_time'] / max(self.stats['requests_made'], 1)
        }
    
    def reset_stats(self):
        """Reset statistics counters."""
        self.stats = {
            'requests_made': 0,
            'requests_blocked_rpm': 0,
            'requests_blocked_interval': 0,
            'requests_blocked_concurrent': 0,
            'total_wait_time': 0.0,
            'longest_wait': 0.0,
            'start_time': time.time()
        }
        self.total_requests = 0


def create_rate_limiter(multiprocessing_enabled: bool = True, **kwargs) -> 'SharedRateLimiter | LocalRateLimiter':
    """
    Factory function to create appropriate rate limiter.
    
    Args:
        multiprocessing_enabled: Whether to use multiprocessing-safe rate limiter
        **kwargs: Configuration options for rate limiter
    
    Returns:
        SharedRateLimiter if multiprocessing_enabled, else LocalRateLimiter
    """
    if multiprocessing_enabled:
        return SharedRateLimiter(**kwargs)
    else:
        return LocalRateLimiter(**kwargs)