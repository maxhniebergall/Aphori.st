#!/usr/bin/env python3
"""
ImprovedGeminiTaskProcessor - ProcessPoolExecutor-based theme processing

This module provides an improved multiprocessing implementation that uses Python's
concurrent.futures for better process management and eliminates file locking issues.
"""

import logging
import multiprocessing as mp
import os
import signal
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed, TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import yaml

# Add the pipeline directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))
sys.path.append(str(Path(__file__).parent))

from ThemeProcessingTask import ThemeProcessingTask, ThemeProcessingResult, TaskGenerator
from SharedEmbeddingCache import SharedEmbeddingCache
from SharedRateLimiter import SharedRateLimiter
from ResultAggregator import ResultAggregator

logger = logging.getLogger(__name__)


def process_theme_batch_worker(worker_args):
    """
    Worker function for processing a batch of theme tasks.
    
    This function runs in a separate process and must be defined at module level
    to be pickable by ProcessPoolExecutor.
    
    Args:
        worker_args: Tuple containing (tasks, shared_cache, rate_limiter, config)
    
    Returns:
        List of ThemeProcessingResult objects
    """
    tasks, shared_cache_data, rate_limiter_data, config = worker_args
    
    # Initialize worker components
    worker_id = os.getpid()
    logger.info(f"Worker {worker_id} starting with {len(tasks)} tasks")
    
    try:
        # Import here to avoid issues with multiprocessing
        from ImprovedThemeWorker import ImprovedThemeWorker
        
        # Create worker instance
        worker = ImprovedThemeWorker(
            worker_id=worker_id,
            shared_cache_data=shared_cache_data,
            rate_limiter_data=rate_limiter_data,
            config=config
        )
        
        # Process all tasks in this batch
        results = []
        for task in tasks:
            result = worker.process_task(task)
            results.append(result)
        
        logger.info(f"Worker {worker_id} completed {len(results)} tasks")
        return results
        
    except Exception as e:
        logger.error(f"Worker {worker_id} failed: {e}")
        # Return error results for all tasks
        error_results = []
        for task in tasks:
            error_results.append(ThemeProcessingResult.create_error_result(
                task.task_id, task.theme, f"Worker error: {str(e)}"
            ))
        return error_results


class ImprovedGeminiTaskProcessor:
    """
    Improved multiprocessing orchestrator using ProcessPoolExecutor.
    
    This implementation:
    1. Uses ProcessPoolExecutor for automatic process lifecycle management
    2. Eliminates file locking with in-memory shared cache
    3. Provides proper exception handling and recovery
    4. Maintains CSV backup compatibility
    """
    
    def __init__(self, config_path: str = "params.yaml"):
        """
        Initialize the improved task processor.
        
        Args:
            config_path: Path to configuration file
        """
        self.config = self._load_config(config_path)
        self.multiprocessing_config = self.config.get('multiprocessing', {})
        
        # Determine worker count
        cpu_count = mp.cpu_count()
        default_workers = max(2, min(cpu_count - 1, 8))
        self.worker_count = self.multiprocessing_config.get('worker_count', default_workers)
        
        # Batch configuration
        self.tasks_per_batch = self.multiprocessing_config.get('tasks_per_batch', 5)
        self.task_timeout = self.multiprocessing_config.get('task_timeout_seconds', 300)
        
        # Shared resources - will be initialized in process_themes()
        self.shared_cache = None
        self.rate_limiter = None
        self.result_aggregator = None
        
        # Control flags
        self.shutdown_requested = False
        self.csv_backup_thread = None
        
        # Statistics
        self.total_tasks = 0
        self.completed_tasks = 0
        self.failed_tasks = 0
        self.start_time = 0.0
        
        # Set up signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        logger.info(f"ImprovedGeminiTaskProcessor initialized with {self.worker_count} workers")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load pipeline configuration."""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except FileNotFoundError:
            logger.error(f"Configuration file not found: {config_path}")
            sys.exit(1)
        except yaml.YAMLError as e:
            logger.error(f"Error parsing configuration file: {e}")
            sys.exit(1)
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True
    
    def _initialize_shared_resources(self):
        """Initialize shared cache and rate limiter."""
        logger.info("Initializing shared resources...")
        
        # Create shared embedding cache
        cache_file = self.config.get('cache_file', 'data/cache/all_embeddings.csv')
        self.shared_cache = SharedEmbeddingCache(
            cache_file=cache_file,
            backup_interval=self.multiprocessing_config.get('cache_backup_interval', 60)
        )
        
        # Create shared rate limiter
        gemini_config = self.config['gemini']
        self.rate_limiter = SharedRateLimiter(
            requests_per_minute=gemini_config.get('requests_per_minute', 2900),
            min_request_interval=gemini_config.get('min_request_interval', 0.1),
            max_concurrent_requests=self.multiprocessing_config.get('max_concurrent_requests', 10)
        )
        
        # Create result aggregator
        self.result_aggregator = ResultAggregator(
            config=self.config,
            output_dir=self.config['paths']['outputs']
        )
        
        logger.info("Shared resources initialized successfully")
    
    def _start_csv_backup_thread(self):
        """Start the CSV backup thread."""
        if not self.shared_cache:
            return
        
        def backup_worker():
            """Background thread to periodically backup cache to CSV."""
            while not self.shutdown_requested:
                try:
                    time.sleep(60)  # Backup every minute
                    if not self.shutdown_requested:
                        self.shared_cache.backup_to_csv()
                except Exception as e:
                    logger.error(f"CSV backup thread error: {e}")
        
        self.csv_backup_thread = threading.Thread(target=backup_worker, daemon=True)
        self.csv_backup_thread.start()
        logger.info("CSV backup thread started")
    
    def _create_task_batches(self, tasks: List[ThemeProcessingTask]) -> List[List[ThemeProcessingTask]]:
        """Create batches of tasks for parallel processing."""
        batches = []
        for i in range(0, len(tasks), self.tasks_per_batch):
            batch = tasks[i:i + self.tasks_per_batch]
            batches.append(batch)
        
        logger.info(f"Created {len(batches)} task batches of {self.tasks_per_batch} tasks each")
        return batches
    
    def _process_tasks_with_executor(self, tasks: List[ThemeProcessingTask]) -> List[ThemeProcessingResult]:
        """Process tasks using ProcessPoolExecutor."""
        all_results = []
        task_batches = self._create_task_batches(tasks)
        
        # Prepare shared data for workers
        shared_cache_data = self.shared_cache.get_shared_data()
        rate_limiter_data = self.rate_limiter.get_shared_data()
        
        with ProcessPoolExecutor(max_workers=self.worker_count) as executor:
            logger.info(f"Starting ProcessPoolExecutor with {self.worker_count} workers")
            
            # Submit all batches
            future_to_batch = {}
            for batch in task_batches:
                if self.shutdown_requested:
                    break
                
                worker_args = (batch, shared_cache_data, rate_limiter_data, self.config)
                future = executor.submit(process_theme_batch_worker, worker_args)
                future_to_batch[future] = batch
            
            # Collect results as they complete
            for future in as_completed(future_to_batch.keys(), timeout=self.task_timeout):
                if self.shutdown_requested:
                    break
                
                batch = future_to_batch[future]
                try:
                    batch_results = future.result(timeout=30)
                    all_results.extend(batch_results)
                    
                    # Update statistics
                    for result in batch_results:
                        if result.success:
                            self.completed_tasks += 1
                        else:
                            self.failed_tasks += 1
                    
                    # Log progress
                    total_processed = self.completed_tasks + self.failed_tasks
                    if total_processed % 20 == 0:  # Log every 20 tasks
                        progress_pct = (total_processed / self.total_tasks) * 100
                        elapsed_time = time.time() - self.start_time
                        rate = total_processed / elapsed_time if elapsed_time > 0 else 0
                        
                        logger.info(f"Progress: {total_processed}/{self.total_tasks} ({progress_pct:.1f}%) "
                                   f"- {self.completed_tasks} successful, {self.failed_tasks} failed "
                                   f"(rate: {rate:.1f} tasks/sec)")
                    
                except FutureTimeoutError:
                    logger.error(f"Batch timeout - {len(batch)} tasks failed")
                    # Create error results for timed-out batch
                    for task in batch:
                        error_result = ThemeProcessingResult.create_error_result(
                            task.task_id, task.theme, "Processing timeout"
                        )
                        all_results.append(error_result)
                        self.failed_tasks += 1
                        
                except Exception as e:
                    logger.error(f"Batch processing error: {e}")
                    # Create error results for failed batch
                    for task in batch:
                        error_result = ThemeProcessingResult.create_error_result(
                            task.task_id, task.theme, f"Processing error: {str(e)}"
                        )
                        all_results.append(error_result)
                        self.failed_tasks += 1
        
        logger.info(f"ProcessPoolExecutor completed: {self.completed_tasks} successful, {self.failed_tasks} failed")
        return all_results
    
    def _cleanup_resources(self):
        """Clean up shared resources."""
        try:
            # Stop CSV backup thread
            if self.csv_backup_thread and self.csv_backup_thread.is_alive():
                self.shutdown_requested = True
                self.csv_backup_thread.join(timeout=5)
            
            # Final cache backup
            if self.shared_cache:
                self.shared_cache.backup_to_csv()
                logger.info("Final cache backup completed")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
    
    def _get_processing_stats(self) -> Dict[str, Any]:
        """Get overall processing statistics."""
        elapsed_time = time.time() - self.start_time
        total_processed = self.completed_tasks + self.failed_tasks
        
        # Get cache and rate limiter stats
        cache_stats = self.shared_cache.get_stats() if self.shared_cache else {}
        rate_limiter_stats = self.rate_limiter.get_stats() if self.rate_limiter else {}
        
        return {
            'total_tasks': self.total_tasks,
            'completed_tasks': self.completed_tasks,
            'failed_tasks': self.failed_tasks,
            'success_rate': (self.completed_tasks / self.total_tasks) if self.total_tasks > 0 else 0,
            'processing_time': elapsed_time,
            'tasks_per_second': total_processed / elapsed_time if elapsed_time > 0 else 0,
            'worker_count': self.worker_count,
            'cache_stats': cache_stats,
            'rate_limiter_stats': rate_limiter_stats
        }
    
    def process_themes(self, themes: List[str], candidates_dict: Dict[str, Dict]) -> Tuple[Dict, List[Dict]]:
        """
        Process themes using improved multiprocessing with ProcessPoolExecutor.
        
        Args:
            themes: List of theme words to process
            candidates_dict: Dictionary mapping themes to candidate words
        
        Returns:
            Tuple of (results_dict, all_embeddings_list) compatible with original pipeline
        """
        try:
            logger.info(f"Starting improved multiprocessing theme processing for {len(themes)} themes")
            self.start_time = time.time()
            
            # Initialize shared resources
            self._initialize_shared_resources()
            
            # Start CSV backup thread
            self._start_csv_backup_thread()
            
            # Generate processing tasks
            puzzle_config = self.config['puzzle_generation']
            tasks = TaskGenerator.create_tasks_for_puzzles(
                themes=themes,
                candidates_dict=candidates_dict,
                themes_per_puzzle=puzzle_config.get('themes_per_puzzle', 4),
                total_puzzles=puzzle_config.get('total_puzzle_count', 20)
            )
            
            if not tasks:
                logger.error("No tasks generated from themes and candidates")
                return {}, []
            
            self.total_tasks = len(tasks)
            logger.info(f"Generated {self.total_tasks} processing tasks")
            
            # Process tasks using ProcessPoolExecutor
            results = self._process_tasks_with_executor(tasks)
            
            # Categorize results
            successful_results = [r for r in results if r.success]
            failed_results = [r for r in results if not r.success]
            
            # Aggregate results
            results_dict, all_embeddings = self.result_aggregator.aggregate_results(
                successful_results, failed_results
            )
            
            # Get final statistics
            stats = self._get_processing_stats()
            
            # Update results metadata
            results_dict['metadata'].update({
                'multiprocessing_enabled': True,
                'multiprocessing_implementation': 'ImprovedGeminiTaskProcessor',
                'multiprocessing_stats': stats
            })
            
            logger.info("Improved multiprocessing theme processing completed successfully")
            logger.info(f"Final stats: {self.completed_tasks}/{self.total_tasks} successful "
                       f"in {stats['processing_time']:.1f}s ({stats['tasks_per_second']:.1f} tasks/sec)")
            
            return results_dict, all_embeddings
            
        except Exception as e:
            logger.error(f"Error in improved multiprocessing theme processing: {e}")
            raise
        finally:
            # Always cleanup resources
            self._cleanup_resources()


def create_improved_task_processor(config_path: str = "params.yaml") -> ImprovedGeminiTaskProcessor:
    """
    Factory function to create an improved task processor.
    
    Args:
        config_path: Path to configuration file
    
    Returns:
        ImprovedGeminiTaskProcessor instance
    """
    return ImprovedGeminiTaskProcessor(config_path)


if __name__ == "__main__":
    # Simple test/demo
    import json
    
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Load test data
    themes_file = Path("data/themes/selected_themes.json")
    candidates_file = Path("data/candidates/candidate_words.json")
    
    if not themes_file.exists() or not candidates_file.exists():
        logger.error("Test data files not found")
        sys.exit(1)
    
    with open(themes_file) as f:
        themes_data = json.load(f)
        themes = themes_data['themes'][:4]  # Test with small subset
    
    with open(candidates_file) as f:
        candidates_data = json.load(f)
        candidates_dict = candidates_data['candidates']
    
    # Create and run improved processor
    processor = create_improved_task_processor()
    results, embeddings = processor.process_themes(themes, candidates_dict)
    
    logger.info(f"Test completed: {len(results.get('puzzles', {}))} puzzles generated")