#!/usr/bin/env python3
"""
ImprovedThemeWorker - Worker implementation for ProcessPoolExecutor

This module implements the worker functionality that processes individual
theme tasks using shared cache and rate limiting.
"""

import logging
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

# Add the pipeline directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from ThemeProcessingTask import ThemeProcessingTask, ThemeProcessingResult
from SharedRateLimiter import WorkerRateLimiter

# Import the original GeminiEmbeddingProvider
try:
    from pipeline.gemini_enhancer import GeminiEmbeddingProvider, EmbeddingResult
except ImportError as e:
    logging.error(f"Could not import GeminiEmbeddingProvider: {e}")
    sys.exit(1)

logger = logging.getLogger(__name__)


class ImprovedThemeWorker:
    """
    Improved theme worker that uses shared cache and rate limiting.
    
    This worker:
    1. Uses shared cache for embeddings (no file locking)
    2. Uses shared rate limiting across all processes
    3. Provides robust error handling and recovery
    4. Maintains compatibility with original pipeline
    """
    
    def __init__(self, 
                 worker_id: int,
                 shared_cache_data: Dict[str, Any],
                 rate_limiter_data: Dict[str, Any],
                 config: Dict[str, Any]):
        """
        Initialize improved theme worker.
        
        Args:
            worker_id: Unique ID for this worker
            shared_cache_data: Shared cache data from SharedEmbeddingCache
            rate_limiter_data: Shared rate limiter data from SharedRateLimiter
            config: Configuration dictionary
        """
        self.worker_id = worker_id
        self.config = config
        
        # Initialize shared cache access
        self.shared_cache = shared_cache_data['shared_cache']
        self.cache_stats = shared_cache_data['stats']
        
        # Initialize shared rate limiter
        self.rate_limiter = WorkerRateLimiter(rate_limiter_data)
        
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
        
        # Initialize components
        self.embedding_provider: Optional[GeminiEmbeddingProvider] = None
        self._initialize_worker_components()
        
        logger.info(f"ImprovedThemeWorker {worker_id} initialized")
    
    def _initialize_worker_components(self):
        """Initialize worker components."""
        try:
            # Initialize Gemini embedding provider
            gemini_config = self.config['gemini']
            api_key = os.getenv(gemini_config['api_key_env'])
            
            if not api_key:
                raise ValueError(f"Environment variable {gemini_config['api_key_env']} not set")
            
            self.embedding_provider = GeminiEmbeddingProvider(
                model_id=gemini_config['model_id'],
                dimension=gemini_config['embedding_dimension'],
                api_key=api_key,
                cache_file=None,  # We use shared cache instead
                min_request_interval=gemini_config.get('min_request_interval', 0.1),
                max_retries=gemini_config.get('max_retries', 3),
                retry_base_delay=gemini_config.get('retry_base_delay', 1.0),
                requests_per_minute=gemini_config.get('requests_per_minute', 2900)
            )
            
            logger.info(f"Worker {self.worker_id} components initialized successfully")
            
        except Exception as e:
            logger.error(f"Worker {self.worker_id} initialization failed: {e}")
            raise
    
    def _normalize_key(self, word: str) -> str:
        """Normalize word for consistent cache keys."""
        return word.lower().strip()
    
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
    
    def _is_duplicate_word(self, word: str, processed_words: set) -> Tuple[bool, Optional[str], Optional[str]]:
        """Check if a word is a duplicate of already processed words."""
        word_lower = self._normalize_key(word)
        
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
    
    def _get_embedding_from_cache(self, word: str) -> Optional[List[float]]:
        """Get embedding from shared cache."""
        cache_key = self._normalize_key(word)
        entry_dict = self.shared_cache.get(cache_key)
        
        if entry_dict:
            self.stats['cache_hits'] += 1
            self.cache_stats['hits'] = self.cache_stats.get('hits', 0) + 1
            return entry_dict['embedding']
        else:
            self.stats['cache_misses'] += 1
            self.cache_stats['misses'] = self.cache_stats.get('misses', 0) + 1
            return None
    
    def _put_embedding_in_cache(self, word: str, embedding: List[float], 
                                theme: Optional[str] = None, word_type: Optional[str] = None,
                                similarity_to_theme: Optional[float] = None):
        """Store embedding in shared cache."""
        from SharedEmbeddingCache import EmbeddingEntry
        
        cache_key = self._normalize_key(word)
        entry = EmbeddingEntry(
            word=word,
            embedding=embedding,
            timestamp=time.time(),
            theme=theme,
            word_type=word_type,
            similarity_to_theme=similarity_to_theme
        )
        
        self.shared_cache[cache_key] = entry.to_dict()
        self.cache_stats['writes'] = self.cache_stats.get('writes', 0) + 1
        self.cache_stats['cache_size'] = len(self.shared_cache)
    
    def _get_embeddings_with_cache(self, texts: List[str]) -> Tuple[List[Optional[List[float]]], int, int]:
        """
        Get embeddings for texts using cache first, then API.
        
        Returns:
            Tuple of (embeddings, cache_hits, api_calls)
        """
        cache_hits = 0
        api_calls = 0
        
        # Check cache first
        cached_embeddings = []
        texts_to_generate = []
        text_indices = []
        
        for i, text in enumerate(texts):
            embedding = self._get_embedding_from_cache(text)
            if embedding is not None:
                cached_embeddings.append(embedding)
                cache_hits += 1
            else:
                cached_embeddings.append(None)
                texts_to_generate.append(text)
                text_indices.append(i)
        
        # Generate embeddings for uncached texts
        if texts_to_generate:
            logger.debug(f"Worker {self.worker_id}: Generating {len(texts_to_generate)} embeddings via API")
            
            try:
                # Use shared rate limiter for API calls
                with self.rate_limiter.acquire_request_slot():
                    api_embeddings = self.embedding_provider.generate_embeddings(texts_to_generate)
                    api_calls = 1  # One batch API call
                    self.stats['api_calls_made'] += 1
                
                # Merge API results back into cached results
                api_idx = 0
                for i in text_indices:
                    if api_idx < len(api_embeddings) and api_embeddings[api_idx] is not None:
                        embedding = api_embeddings[api_idx]
                        cached_embeddings[i] = embedding
                        # Cache the new embedding
                        self._put_embedding_in_cache(texts[i], embedding)
                    api_idx += 1
                    
            except Exception as api_error:
                logger.error(f"Worker {self.worker_id}: API call failed: {api_error}")
                # If API fails, cached_embeddings already has None for failed texts
                api_calls = 0
        
        return cached_embeddings, cache_hits, api_calls
    
    def process_task(self, task: ThemeProcessingTask) -> ThemeProcessingResult:
        """
        Process a single theme task with improved error handling.
        
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
                
                processed_words.add(self._normalize_key(word))
                unique_words.append(word)
            
            if skipped_count > 0:
                logger.debug(f"Worker {self.worker_id}: Skipped {skipped_count} duplicate words for theme '{task.theme}'")
            
            min_words_required = self.config['puzzle_generation']['words_per_theme']
            if len(unique_words) < min_words_required:
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Not enough unique candidates: {len(unique_words)} < {min_words_required}",
                    time.time() - start_time
                )
            
            # Prepare batch: theme + unique candidate words
            batch_texts = [task.theme] + unique_words
            
            # Get embeddings with caching
            batch_embeddings, cache_hits, api_calls = self._get_embeddings_with_cache(batch_texts)
            
            if not batch_embeddings or len(batch_embeddings) != len(batch_texts):
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Failed to generate embeddings: expected {len(batch_texts)}, got {len(batch_embeddings) if batch_embeddings else 0}",
                    time.time() - start_time
                )
            
            # Extract theme embedding
            theme_embedding = batch_embeddings[0]
            if not theme_embedding:
                return ThemeProcessingResult.create_error_result(
                    task.task_id,
                    task.theme,
                    f"Failed to generate embedding for theme: {task.theme}",
                    time.time() - start_time
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
                    
                    # Update cache with similarity info
                    self._put_embedding_in_cache(
                        word, word_embedding, 
                        theme=task.theme, 
                        word_type="candidate",
                        similarity_to_theme=similarity
                    )
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
                    f"Not enough valid words after embedding: {len(selected_results)} < {words_per_theme}",
                    time.time() - start_time
                )
            
            # Extract final data
            selected_words = [result[0] for result in selected_results]
            selected_embeddings = [result[1] for result in selected_results]
            similarities = [result[2] for result in selected_results]
            
            processing_time = time.time() - start_time
            
            # Update statistics
            self.stats['cache_hits'] += cache_hits
            self.stats['tasks_processed'] += 1
            self.stats['tasks_succeeded'] += 1
            self.stats['total_processing_time'] += processing_time
            
            # Cache theme embedding with metadata
            self._put_embedding_in_cache(
                task.theme, theme_embedding, 
                theme=task.theme, 
                word_type="theme"
            )
            
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
                cache_misses=len([e for e in batch_embeddings if e is None])
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Error processing task: {str(e)}"
            logger.error(f"Worker {self.worker_id}: {error_msg}")
            logger.error(f"Worker {self.worker_id}: Traceback: {traceback.format_exc()}")
            
            # Update error statistics
            self.stats['tasks_processed'] += 1
            self.stats['tasks_failed'] += 1
            self.stats['total_processing_time'] += processing_time
            
            return ThemeProcessingResult.create_error_result(
                task.task_id,
                task.theme,
                error_msg,
                processing_time
            )
    
    def get_worker_stats(self) -> Dict[str, Any]:
        """Get worker statistics."""
        elapsed_time = time.time() - self.stats['start_time']
        
        return {
            'worker_id': self.worker_id,
            'elapsed_time': elapsed_time,
            'avg_processing_time': (
                self.stats['total_processing_time'] / max(self.stats['tasks_processed'], 1)
            ),
            **self.stats
        }


if __name__ == "__main__":
    # Test worker functionality
    logging.basicConfig(level=logging.INFO)
    
    # This would normally be called from the ProcessPoolExecutor
    logger.info("ImprovedThemeWorker test - this should be called from ProcessPoolExecutor")