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
        from .SharedRateLimiter import SharedRateLimiter
        return SharedRateLimiter(**kwargs)
    else:
        return LocalRateLimiter(**kwargs)