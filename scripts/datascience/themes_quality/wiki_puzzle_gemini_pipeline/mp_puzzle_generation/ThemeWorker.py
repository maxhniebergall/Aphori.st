#!/usr/bin/env python3
"""
ThemeWorker - Worker process for processing theme tasks with Gemini embeddings

This module implements the worker process that handles individual ThemeProcessingTasks.
Each worker runs in its own process and communicates via queues with the main orchestrator.
"""

import logging
import os
import sys
import time
import traceback
from multiprocessing import Queue, Process
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

# Add the pipeline directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from ThemeProcessingTask import ThemeProcessingTask, ThemeProcessingResult
from SimpleRateLimiter import SimpleSharedRateLimiter
from EmbeddingCacheManager import EmbeddingCacheManager

# Import the original GeminiEmbeddingProvider
try:
    from pipeline.gemini_enhancer import GeminiEmbeddingProvider, EmbeddingResult
except ImportError as e:
    logging.error(f"Could not import GeminiEmbeddingProvider: {e}")
    sys.exit(1)

logger = logging.getLogger(__name__)


class ThemeWorker:
    """
    Worker process that processes ThemeProcessingTasks using Gemini embeddings.
    
    Each worker:
    1. Receives tasks from a shared queue
    2. Processes theme + candidates with Gemini API
    3. Respects shared rate limiting
    4. Uses shared embedding cache
    5. Returns results via result queue
    """
    
    def __init__(self, 
                 worker_id: int,
                 task_queue: Queue,
                 result_queue: Queue,
                 rate_limiter: SimpleSharedRateLimiter,
                 config: Dict[str, Any]):
        """
        Initialize theme worker.
        
        Args:
            worker_id: Unique ID for this worker
            task_queue: Queue to receive tasks from
            result_queue: Queue to send results to
            rate_limiter: Shared rate limiter
            config: Configuration dictionary
        """
        self.worker_id = worker_id
        self.task_queue = task_queue
        self.result_queue = result_queue
        self.rate_limiter = rate_limiter
        self.config = config
        
        # Worker statistics
        self.stats = {
            'tasks_processed': 0,
            'tasks_succeeded': 0,
            'tasks_failed': 0,
            'api_calls_made': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'total_processing_time': 0.0,
            'start_time': time.time()
        }
        
        # Initialize components (will be done in worker process)
        self.embedding_provider: Optional[GeminiEmbeddingProvider] = None
        self.cache_manager: Optional[EmbeddingCacheManager] = None
        
        logger.info(f"ThemeWorker {worker_id} initialized")
    
    def _initialize_worker_components(self):
        """Initialize worker components in the worker process."""
        try:
            # Set up logging for this worker process
            worker_logger = logging.getLogger(f"worker_{self.worker_id}")
            worker_logger.setLevel(logging.INFO)
            
            # Initialize embedding cache manager
            cache_file = self.config.get('cache_file', 'data/cache/all_embeddings.csv')
            self.cache_manager = EmbeddingCacheManager(
                cache_file=cache_file,
                sync_interval=self.config.get('cache_sync_interval', 60)
            )
            
            # Initialize Gemini embedding provider
            gemini_config = self.config['gemini']
            api_key = os.getenv(gemini_config['api_key_env'])
            
            if not api_key:
                raise ValueError(f"Environment variable {gemini_config['api_key_env']} not set")
            
            self.embedding_provider = GeminiEmbeddingProvider(
                model_id=gemini_config['model_id'],
                dimension=gemini_config['embedding_dimension'],
                api_key=api_key,
                cache_file=None,  # We use our own cache manager
                min_request_interval=gemini_config.get('min_request_interval', 0.1),
                max_retries=gemini_config.get('max_retries', 5),
                retry_base_delay=gemini_config.get('retry_base_delay', 1.0),
                requests_per_minute=gemini_config.get('requests_per_minute', 2900)
            )
            
            logger.info(f"Worker {self.worker_id} components initialized successfully")
            
        except Exception as e:
            logger.error(f"Worker {self.worker_id} initialization failed: {e}")
            raise
    
    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        try:
            a_np = np.array(a)
            b_np = np.array(b)
            
            dot_product = np.dot(a_np, b_np)
            norm_a = np.linalg.norm(a_np)
            norm_b = np.linalg.norm(b_np)
            
            if norm_a == 0 or norm_b == 0:
                return 0.0
            
            return float(dot_product / (norm_a * norm_b))
        except Exception as e:
            logger.error(f"Error calculating cosine similarity: {e}")
            return 0.0
    
    def _normalize_word(self, word: str) -> str:
        """Normalize a word for duplicate detection."""
        return word.lower().strip()
    
    def _is_duplicate_word(self, word: str, processed_words: set) -> Tuple[bool, Optional[str], Optional[str]]:
        """Check if a word is a duplicate of already processed words."""
        word_lower = self._normalize_word(word)
        
        # Check exact case-insensitive match
        if word_lower in processed_words:
            return True, word_lower, "case-insensitive match"
        
        # Check if it's a plural form
        if word_lower.endswith('s') and len(word_lower) > 1:
            singular_form = word_lower[:-1]
            if singular_form in processed_words:
                return True, singular_form, "plural form"
        
        # Check if any existing word is a plural of this word
        plural_form = word_lower + 's'
        if plural_form in processed_words:
            return True, plural_form, "singular of existing plural"
        
        return False, None, None
    
    def _get_embeddings_with_cache(self, texts: List[str]) -> Tuple[List[Optional[List[float]]], int, int]:
        """
        Get embeddings for texts using cache first, then API.
        
        Returns:
            Tuple of (embeddings, cache_hits, api_calls)
        """
        cache_hits = 0
        api_calls = 0
        
        # Check cache first
        cached_embeddings = self.cache_manager.get_batch(texts)
        
        # Identify which texts need API calls
        texts_to_generate = []
        text_indices = []
        
        for i, embedding in enumerate(cached_embeddings):
            if embedding is None:
                texts_to_generate.append(texts[i])
                text_indices.append(i)
            else:
                cache_hits += 1
        
        # Generate embeddings for uncached texts
        if texts_to_generate:
            logger.debug(f"Worker {self.worker_id}: Generating {len(texts_to_generate)} embeddings via API")
            
            # Use rate limiter for API calls
            with self.rate_limiter.acquire_request_slot():
                api_embeddings = self.embedding_provider.generate_embeddings(texts_to_generate)
                api_calls = 1  # One batch API call
            
            # Merge API results back into cached results
            api_idx = 0
            for i in text_indices:
                if api_idx < len(api_embeddings) and api_embeddings[api_idx] is not None:
                    cached_embeddings[i] = api_embeddings[api_idx]
                    # Cache the new embedding
                    self.cache_manager.put(texts[i], api_embeddings[api_idx])
                api_idx += 1
        
        return cached_embeddings, cache_hits, api_calls
    
    def _process_theme_task(self, task: ThemeProcessingTask) -> ThemeProcessingResult:
        """
        Process a single theme task with Gemini embeddings.
        
        Args:
            task: The theme processing task
        
        Returns:
            ThemeProcessingResult with embeddings and similarities
        """
        start_time = time.time()
        
        try:
            logger.info(f"Worker {self.worker_id}: Processing task {task.task_id} - '{task.theme}' with {len(task.candidates)} candidates")
            
            # Filter out duplicate words
            processed_words = set()
            unique_words = []
            skipped_count = 0
            
            for word in task.candidates:
                is_duplicate, matching_word, reason = self._is_duplicate_word(word, processed_words)
                
                if is_duplicate:
                    logger.debug(f"Skipping duplicate word '{word}' (matches '{matching_word}', reason: {reason})")
                    skipped_count += 1
                    continue
                
                processed_words.add(self._normalize_word(word))
                unique_words.append(word)
            
            if skipped_count > 0:
                logger.debug(f"Worker {self.worker_id}: Skipped {skipped_count} duplicate words for theme '{task.theme}'")
            
            if len(unique_words) < self.config['puzzle_generation']['words_per_theme']:
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Not enough unique candidates: {len(unique_words)} < {self.config['puzzle_generation']['words_per_theme']}"
                )
            
            # Prepare batch: theme + unique candidate words
            batch_texts = [task.theme] + unique_words
            
            # Get embeddings with caching
            batch_embeddings, cache_hits, api_calls = self._get_embeddings_with_cache(batch_texts)
            
            if not batch_embeddings or len(batch_embeddings) != len(batch_texts):
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Failed to generate embeddings: expected {len(batch_texts)}, got {len(batch_embeddings) if batch_embeddings else 0}"
                )
            
            # Extract theme embedding
            theme_embedding = batch_embeddings[0]
            if not theme_embedding:
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Failed to generate embedding for theme: {task.theme}"
                )
            
            # Process word embeddings and calculate similarities
            word_results = []
            word_embeddings = []
            
            for i, word in enumerate(unique_words):
                word_embedding = batch_embeddings[i + 1]  # +1 because theme is at index 0
                if word_embedding:
                    similarity = self._cosine_similarity(theme_embedding, word_embedding)
                    word_results.append((word, word_embedding, similarity))
                    word_embeddings.append(word_embedding)
                    logger.debug(f"Worker {self.worker_id}: {word} similarity = {similarity:.4f}")
                else:
                    logger.warning(f"Worker {self.worker_id}: Failed to generate embedding for word: {word}")
            
            # Sort by similarity (highest first)
            word_results.sort(key=lambda x: x[2], reverse=True)
            
            # Select final words
            words_per_theme = self.config['puzzle_generation']['words_per_theme']
            selected_results = word_results[:words_per_theme]
            
            if len(selected_results) < words_per_theme:
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Not enough valid words after embedding: {len(selected_results)} < {words_per_theme}"
                )
            
            # Extract final data
            selected_words = [result[0] for result in selected_results]
            selected_embeddings = [result[1] for result in selected_results]
            similarities = [result[2] for result in selected_results]
            
            processing_time = time.time() - start_time
            
            # Update statistics
            self.stats['cache_hits'] += cache_hits
            self.stats['api_calls_made'] += api_calls
            if api_calls == 0:
                self.stats['cache_hits'] += len(batch_texts)
            else:
                self.stats['cache_misses'] += len(texts_to_generate) if 'texts_to_generate' in locals() else 0
            
            logger.info(f"Worker {self.worker_id}: Completed task {task.task_id} in {processing_time:.2f}s "
                       f"(cache hits: {cache_hits}, API calls: {api_calls})")
            
            return ThemeProcessingResult(
                task_id=task.task_id,
                theme=task.theme,
                success=True,
                processing_time=processing_time,
                theme_embedding=theme_embedding,
                word_embeddings=selected_embeddings,
                similarities=similarities,
                selected_words=selected_words,
                api_calls_made=api_calls,
                cache_hits=cache_hits,
                cache_misses=len(texts_to_generate) if 'texts_to_generate' in locals() else 0
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Error processing task: {str(e)}"
            logger.error(f"Worker {self.worker_id}: {error_msg}\nTraceback: {traceback.format_exc()}")
            
            return ThemeProcessingResult.create_error_result(
                task.task_id,
                task.theme,
                error_msg,
                processing_time
            )
    
    def run(self):
        """Main worker loop - runs in separate process."""
        try:
            logger.info(f"Worker {self.worker_id} starting up")
            
            # Initialize components in worker process
            self._initialize_worker_components()
            
            self.stats['start_time'] = time.time()
            
            while True:
                try:
                    # Get next task (blocks with timeout)
                    task = self.task_queue.get(timeout=30)  # 30 second timeout
                    
                    if task is None:  # Shutdown signal
                        logger.info(f"Worker {self.worker_id} received shutdown signal")
                        break
                    
                    # Process the task
                    self.stats['tasks_processed'] += 1
                    result = self._process_theme_task(task)
                    
                    # Update statistics
                    if result.success:
                        self.stats['tasks_succeeded'] += 1
                    else:
                        self.stats['tasks_failed'] += 1
                    
                    self.stats['total_processing_time'] += result.processing_time
                    
                    # Send result back
                    self.result_queue.put(result)
                    
                    # Mark task as done
                    self.task_queue.task_done()
                    
                except Exception as e:
                    if "Empty" not in str(e):  # Ignore timeout exceptions
                        logger.error(f"Worker {self.worker_id} error in main loop: {e}")
                        logger.error(f"Traceback: {traceback.format_exc()}")
                    continue
            
        except Exception as e:
            logger.error(f"Worker {self.worker_id} fatal error: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
        
        finally:
            # Sync cache before shutdown
            if self.cache_manager:
                self.cache_manager.sync()
            
            # Log final statistics
            elapsed_time = time.time() - self.stats['start_time']
            logger.info(f"Worker {self.worker_id} shutting down after {elapsed_time:.1f}s:")
            logger.info(f"  Tasks: {self.stats['tasks_processed']} processed, "
                       f"{self.stats['tasks_succeeded']} succeeded, {self.stats['tasks_failed']} failed")
            logger.info(f"  API calls: {self.stats['api_calls_made']}, Cache hits: {self.stats['cache_hits']}")
            logger.info(f"  Avg processing time: {self.stats['total_processing_time'] / max(self.stats['tasks_processed'], 1):.2f}s")


def start_worker(worker_id: int, task_queue: Queue, result_queue: Queue, 
                rate_limiter: SimpleSharedRateLimiter, config: Dict[str, Any]) -> Process:
    """
    Start a worker process.
    
    Args:
        worker_id: Unique worker ID
        task_queue: Queue to receive tasks from
        result_queue: Queue to send results to
        rate_limiter: Shared rate limiter
        config: Configuration dictionary
    
    Returns:
        Process object for the started worker
    """
    worker = ThemeWorker(worker_id, task_queue, result_queue, rate_limiter, config)
    process = Process(target=worker.run, name=f"ThemeWorker-{worker_id}")
    process.start()
    
    logger.info(f"Started worker process {worker_id} (PID: {process.pid})")
    return process