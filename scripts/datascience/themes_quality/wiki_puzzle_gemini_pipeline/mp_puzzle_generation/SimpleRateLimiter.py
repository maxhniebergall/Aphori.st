#!/usr/bin/env python3
"""
SimpleRateLimiter - Process-safe rate limiting without Manager objects

This module provides a simplified rate limiter that avoids the pickling issues
associated with multiprocessing.Manager objects.
"""

import logging
import time
import threading
from contextlib import contextmanager
from multiprocessing import Value, Lock
from typing import Dict, Any

logger = logging.getLogger(__name__)


class SimpleSharedRateLimiter:
    """
    Simple process-safe rate limiter using basic multiprocessing primitives.
    
    This avoids the pickling issues with Manager objects by using only 
    basic shared values and locks.
    """
    
    def __init__(self, 
                 requests_per_minute: int = 2900,
                 min_request_interval: float = 0.1,
                 max_concurrent_requests: int = 10):
        """
        Initialize simple shared rate limiter.
        
        Args:
            requests_per_minute: Maximum requests per minute across all processes
            min_request_interval: Minimum time between any two requests (seconds)
            max_concurrent_requests: Maximum concurrent requests
        """
        self.requests_per_minute = requests_per_minute
        self.min_request_interval = min_request_interval
        self.max_concurrent_requests = max_concurrent_requests
        
        # Simple shared values that can be pickled
        self.last_request_time = Value('d', 0.0)
        self.active_requests = Value('i', 0)
        self.total_requests = Value('i', 0)
        self.requests_this_minute = Value('i', 0)
        self.minute_start_time = Value('d', time.time())
        
        # Simple locks
        self.request_lock = Lock()
        self.active_lock = Lock()
        
        logger.info(f"SimpleSharedRateLimiter initialized: {requests_per_minute} RPM, "
                   f"{min_request_interval}s interval, {max_concurrent_requests} concurrent")
    
    def _reset_minute_counter(self, current_time: float):
        """Reset the minute counter if we've moved to a new minute."""
        with self.request_lock:
            if current_time - self.minute_start_time.value >= 60:
                self.requests_this_minute.value = 0
                self.minute_start_time.value = current_time
    
    def _wait_for_rpm_limit(self) -> float:
        """Wait if we're at the RPM limit."""
        wait_time = 0.0
        current_time = time.time()
        
        self._reset_minute_counter(current_time)
        
        with self.request_lock:
            if self.requests_this_minute.value >= self.requests_per_minute:
                # Wait until the next minute
                wait_time = 60 - (current_time - self.minute_start_time.value)
                if wait_time > 0:
                    logger.debug(f"RPM limit reached: waiting {wait_time:.2f}s")
                    time.sleep(wait_time)
                    # Reset counter after waiting
                    self.requests_this_minute.value = 0
                    self.minute_start_time.value = time.time()
        
        return wait_time
    
    def _wait_for_interval_limit(self) -> float:
        """Wait for minimum interval between requests."""
        wait_time = 0.0
        current_time = time.time()
        
        with self.request_lock:
            time_since_last = current_time - self.last_request_time.value
            
            if time_since_last < self.min_request_interval:
                wait_time = self.min_request_interval - time_since_last
                logger.debug(f"Interval limit: waiting {wait_time:.3f}s")
                time.sleep(wait_time)
        
        return wait_time
    
    def _wait_for_concurrent_limit(self) -> float:
        """Wait if we're at the concurrent request limit."""
        wait_time = 0.0
        start_wait = time.time()
        
        while True:
            with self.active_lock:
                if self.active_requests.value < self.max_concurrent_requests:
                    self.active_requests.value += 1
                    break
            
            logger.debug(f"Concurrent limit reached: waiting")
            time.sleep(0.1)
            wait_time = time.time() - start_wait
        
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
            self.last_request_time.value = current_time
            self.requests_this_minute.value += 1
            self.total_requests.value += 1
        
        try:
            yield
        finally:
            # Release concurrent request slot
            with self.active_lock:
                self.active_requests.value -= 1
    
    def get_stats(self) -> Dict[str, Any]:
        """Get rate limiter statistics."""
        return {
            'active_requests': self.active_requests.value,
            'total_requests': self.total_requests.value,
            'requests_this_minute': self.requests_this_minute.value,
            'requests_per_minute': self.requests_per_minute,
            'max_concurrent': self.max_concurrent_requests
        }