#!/usr/bin/env python3
"""
GeminiTaskProcessor - Main orchestrator for multiprocessing theme processing

This module coordinates multiple worker processes to efficiently process themes
with Gemini embeddings while respecting API rate limits and managing shared resources.
"""

import logging
import multiprocessing as mp
import os
import signal
import sys
import time
from pathlib import Path
from queue import Empty
from typing import Dict, List, Optional, Any, Tuple
import yaml

# Add the pipeline directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))
sys.path.append(str(Path(__file__).parent))

from ThemeProcessingTask import ThemeProcessingTask, ThemeProcessingResult, TaskGenerator
from ThemeWorker import start_worker
from RateLimiter import SharedRateLimiter
from ResultAggregator import ResultAggregator

logger = logging.getLogger(__name__)


class GeminiTaskProcessor:
    """
    Main orchestrator for multiprocessing Gemini theme processing.
    
    This class:
    1. Creates and manages worker processes
    2. Distributes tasks via queues
    3. Collects and aggregates results
    4. Monitors progress and handles failures
    5. Provides graceful shutdown capabilities
    """
    
    def __init__(self, config_path: str = "params.yaml"):
        """
        Initialize the task processor.
        
        Args:
            config_path: Path to configuration file
        """
        self.config = self._load_config(config_path)
        self.multiprocessing_config = self.config.get('multiprocessing', {})
        
        # Determine worker count
        cpu_count = mp.cpu_count()
        default_workers = max(2, min(cpu_count - 1, 8))  # Leave 1 CPU free, max 8 workers
        self.worker_count = self.multiprocessing_config.get('worker_count', default_workers)
        
        # Queue configurations
        self.task_queue_size = self.multiprocessing_config.get('task_queue_size', 100)
        self.result_queue_size = self.multiprocessing_config.get('result_queue_size', 100)
        
        # Shared resources
        self.task_queue: Optional[mp.Queue] = None
        self.result_queue: Optional[mp.Queue] = None
        self.rate_limiter: Optional[SharedRateLimiter] = None
        self.result_aggregator: Optional[ResultAggregator] = None
        
        # Worker management
        self.workers: List[mp.Process] = []
        self.worker_stats: Dict[int, Dict] = {}
        self.shutdown_requested = False
        
        # Progress tracking
        self.total_tasks = 0
        self.completed_tasks = 0
        self.failed_tasks = 0
        self.start_time = 0.0
        
        # Results storage
        self.results: Dict[str, ThemeProcessingResult] = {}
        
        # Set up signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        logger.info(f"GeminiTaskProcessor initialized with {self.worker_count} workers")
    
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
        """Initialize shared queues and rate limiter."""
        logger.info("Initializing shared resources...")
        
        # Create queues
        self.task_queue = mp.Queue(maxsize=self.task_queue_size)
        self.result_queue = mp.Queue(maxsize=self.result_queue_size)
        
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
    
    def _start_workers(self):
        """Start all worker processes."""
        logger.info(f"Starting {self.worker_count} worker processes...")
        
        for worker_id in range(self.worker_count):
            try:
                process = start_worker(
                    worker_id=worker_id,
                    task_queue=self.task_queue,
                    result_queue=self.result_queue,
                    rate_limiter=self.rate_limiter,
                    config=self.config
                )
                self.workers.append(process)
                self.worker_stats[worker_id] = {
                    'started_at': time.time(),
                    'pid': process.pid,
                    'status': 'running'
                }
                logger.info(f"Started worker {worker_id} (PID: {process.pid})")
                
            except Exception as e:
                logger.error(f"Failed to start worker {worker_id}: {e}")
                # Continue with other workers
        
        logger.info(f"Successfully started {len(self.workers)} worker processes")
    
    def _submit_tasks(self, tasks: List[ThemeProcessingTask]):
        """Submit all tasks to the task queue."""
        logger.info(f"Submitting {len(tasks)} tasks to queue...")
        
        submitted_count = 0
        
        for task in tasks:
            if self.shutdown_requested:
                logger.info("Shutdown requested, stopping task submission")
                break
            
            try:
                self.task_queue.put(task, timeout=10)
                submitted_count += 1
                
                if submitted_count % 10 == 0:
                    logger.info(f"Submitted {submitted_count}/{len(tasks)} tasks")
                    
            except Exception as e:
                logger.error(f"Failed to submit task {task.task_id}: {e}")
        
        self.total_tasks = submitted_count
        logger.info(f"Submitted {submitted_count} tasks successfully")
    
    def _collect_results(self) -> Dict[str, List[ThemeProcessingResult]]:
        """
        Collect results from worker processes.
        
        Returns:
            Dictionary mapping status to list of results
        """
        logger.info("Starting result collection...")
        
        results = {
            'successful': [],
            'failed': [],
            'retried': []
        }
        
        last_progress_log = 0
        
        while self.completed_tasks + self.failed_tasks < self.total_tasks:
            if self.shutdown_requested:
                logger.info("Shutdown requested, stopping result collection")
                break
            
            try:
                # Get result with timeout
                result = self.result_queue.get(timeout=5)
                
                # Store result
                self.results[result.task_id] = result
                
                if result.success:
                    results['successful'].append(result)
                    self.completed_tasks += 1
                else:
                    results['failed'].append(result)
                    self.failed_tasks += 1
                    logger.warning(f"Task failed: {result.task_id} - {result.error_message}")
                
                # Log progress periodically
                total_processed = self.completed_tasks + self.failed_tasks
                if total_processed - last_progress_log >= 10:
                    progress_pct = (total_processed / self.total_tasks) * 100
                    elapsed_time = time.time() - self.start_time
                    rate = total_processed / elapsed_time if elapsed_time > 0 else 0
                    
                    logger.info(f"Progress: {total_processed}/{self.total_tasks} ({progress_pct:.1f}%) "
                               f"- {self.completed_tasks} successful, {self.failed_tasks} failed "
                               f"(rate: {rate:.1f} tasks/sec)")
                    
                    last_progress_log = total_processed
                
            except Empty:
                # Check if workers are still alive
                alive_workers = [w for w in self.workers if w.is_alive()]
                if not alive_workers and self.task_queue.empty():
                    logger.warning("No workers alive and task queue empty, stopping collection")
                    break
                continue
            except Exception as e:
                logger.error(f"Error collecting result: {e}")
                continue
        
        logger.info(f"Result collection completed: {self.completed_tasks} successful, {self.failed_tasks} failed")
        return results
    
    def _shutdown_workers(self, timeout: int = 30):
        """Gracefully shutdown all worker processes."""
        logger.info("Shutting down worker processes...")
        
        # Send shutdown signals to workers
        for i in range(len(self.workers)):
            try:
                self.task_queue.put(None, timeout=5)  # None is shutdown signal
            except:
                pass  # Queue might be full
        
        # Wait for workers to finish
        start_time = time.time()
        for i, worker in enumerate(self.workers):
            remaining_timeout = max(1, timeout - (time.time() - start_time))
            worker.join(timeout=remaining_timeout)
            
            if worker.is_alive():
                logger.warning(f"Worker {i} did not shutdown gracefully, terminating...")
                worker.terminate()
                worker.join(timeout=5)
                
                if worker.is_alive():
                    logger.error(f"Worker {i} could not be terminated, killing...")
                    worker.kill()
                    worker.join()
            
            self.worker_stats[i]['status'] = 'terminated'
        
        logger.info("All workers have been shut down")
    
    def _get_processing_stats(self) -> Dict[str, Any]:
        """Get overall processing statistics."""
        elapsed_time = time.time() - self.start_time
        total_processed = self.completed_tasks + self.failed_tasks
        
        # Get rate limiter stats
        rate_limiter_stats = self.rate_limiter.get_stats() if self.rate_limiter else {}
        
        return {
            'total_tasks': self.total_tasks,
            'completed_tasks': self.completed_tasks,
            'failed_tasks': self.failed_tasks,
            'success_rate': (self.completed_tasks / self.total_tasks) if self.total_tasks > 0 else 0,
            'processing_time': elapsed_time,
            'tasks_per_second': total_processed / elapsed_time if elapsed_time > 0 else 0,
            'worker_count': len(self.workers),
            'rate_limiter_stats': rate_limiter_stats,
            'worker_stats': self.worker_stats
        }
    
    def process_themes(self, themes: List[str], candidates_dict: Dict[str, Dict]) -> Tuple[Dict, List[Dict]]:
        """
        Process themes using multiprocessing workers.
        
        Args:
            themes: List of theme words to process
            candidates_dict: Dictionary mapping themes to candidate words
        
        Returns:
            Tuple of (results_dict, all_embeddings_list) compatible with original pipeline
        """
        try:
            logger.info(f"Starting multiprocessing theme processing for {len(themes)} themes")
            self.start_time = time.time()
            
            # Initialize shared resources
            self._initialize_shared_resources()
            
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
            
            # Start worker processes
            self._start_workers()
            
            # Submit tasks to queue
            self._submit_tasks(tasks)
            
            # Collect results
            categorized_results = self._collect_results()
            
            # Aggregate results using ResultAggregator
            results_dict, all_embeddings = self.result_aggregator.aggregate_results(
                categorized_results['successful'],
                categorized_results['failed']
            )
            
            # Get final statistics
            stats = self._get_processing_stats()
            
            # Update results metadata with multiprocessing stats
            results_dict['metadata'].update({
                'multiprocessing_enabled': True,
                'multiprocessing_stats': stats
            })
            
            logger.info("Multiprocessing theme processing completed successfully")
            logger.info(f"Final stats: {self.completed_tasks}/{self.total_tasks} successful "
                       f"in {stats['processing_time']:.1f}s ({stats['tasks_per_second']:.1f} tasks/sec)")
            
            return results_dict, all_embeddings
            
        except Exception as e:
            logger.error(f"Error in multiprocessing theme processing: {e}")
            raise
        finally:
            # Always cleanup resources
            self._shutdown_workers()
            
            if self.rate_limiter:
                final_stats = self.rate_limiter.get_stats()
                logger.info(f"Rate limiter final stats: {final_stats['total_requests']} requests, "
                           f"{final_stats['requests_per_second']:.2f} RPS")


def create_task_processor(config_path: str = "params.yaml", 
                         multiprocessing_enabled: bool = None) -> GeminiTaskProcessor:
    """
    Factory function to create a task processor.
    
    Args:
        config_path: Path to configuration file
        multiprocessing_enabled: Override for multiprocessing setting
    
    Returns:
        GeminiTaskProcessor instance
    """
    # Load config to check if multiprocessing is enabled
    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        raise
    
    # Check if multiprocessing should be enabled
    if multiprocessing_enabled is None:
        multiprocessing_enabled = config.get('multiprocessing', {}).get('enabled', True)
    
    if not multiprocessing_enabled:
        logger.info("Multiprocessing disabled, falling back to single-process mode")
        # Could return a single-process version here if needed
        raise NotImplementedError("Single-process fallback not implemented yet")
    
    return GeminiTaskProcessor(config_path)


if __name__ == "__main__":
    # Simple test/demo
    import json
    
    logging.basicConfig(level=logging.INFO)
    
    # Load test data
    themes_file = Path("data/themes/selected_themes.json")
    candidates_file = Path("data/candidates/candidate_words.json")
    
    if not themes_file.exists() or not candidates_file.exists():
        logger.error("Test data files not found")
        sys.exit(1)
    
    with open(themes_file) as f:
        themes_data = json.load(f)
        themes = themes_data['themes'][:8]  # Test with small subset
    
    with open(candidates_file) as f:
        candidates_data = json.load(f)
        candidates_dict = candidates_data['candidates']
    
    # Create and run processor
    processor = create_task_processor()
    results, embeddings = processor.process_themes(themes, candidates_dict)
    
    logger.info(f"Test completed: {len(results.get('puzzles', {}))} puzzles generated")