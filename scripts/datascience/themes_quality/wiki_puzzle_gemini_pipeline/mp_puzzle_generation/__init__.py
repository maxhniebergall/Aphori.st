#!/usr/bin/env python3
"""
Multiprocessing package for Gemini puzzle generation.

This package provides a multi-processing task-based system for efficiently 
processing theme_word+words units in parallel while respecting API rate limits.

Main Components:
- ThemeProcessingTask: Individual task unit (theme + candidate words)
- ThemeWorker: Worker process that handles individual tasks  
- GeminiTaskProcessor: Main orchestrator that manages workers and queues
- RateLimiter: Shared rate limiting across all processes
- EmbeddingCacheManager: Thread-safe file-based embedding cache
- ResultAggregator: Collects and formats results from workers

Usage:
    from mp_puzzle_generation.GeminiTaskProcessor import create_task_processor
    
    processor = create_task_processor(multiprocessing_enabled=True)
    results, embeddings = processor.process_themes(themes, candidates_dict)
"""

from .ThemeProcessingTask import ThemeProcessingTask, ThemeProcessingResult, TaskGenerator
from .GeminiTaskProcessor import GeminiTaskProcessor, create_task_processor
from .ThemeWorker import ThemeWorker, start_worker
from .RateLimiter import SharedRateLimiter, LocalRateLimiter, create_rate_limiter
from .EmbeddingCacheManager import EmbeddingCacheManager, EmbeddingCacheEntry
from .ResultAggregator import ResultAggregator, SingleProcessResultAggregator

__all__ = [
    'ThemeProcessingTask',
    'ThemeProcessingResult', 
    'TaskGenerator',
    'GeminiTaskProcessor',
    'create_task_processor',
    'ThemeWorker',
    'start_worker',
    'SharedRateLimiter',
    'LocalRateLimiter', 
    'create_rate_limiter',
    'EmbeddingCacheManager',
    'EmbeddingCacheEntry',
    'ResultAggregator',
    'SingleProcessResultAggregator'
]

__version__ = '1.0.0'
__author__ = 'Aphori.st Team'
__description__ = 'Multi-processing system for Gemini puzzle generation'