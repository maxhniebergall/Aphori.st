#!/usr/bin/env python3
"""
ResultAggregator - Collects and aggregates results from theme workers

This module takes individual ThemeProcessingResults and aggregates them into
the format expected by the original pipeline (puzzles grouped by themes, 
embedding data, metadata, etc.).
"""

import logging
import time
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict

from ThemeProcessingTask import ThemeProcessingResult

logger = logging.getLogger(__name__)


class ResultAggregator:
    """
    Aggregates theme processing results into puzzle format.
    
    This class takes individual theme results from workers and:
    1. Groups them into puzzles (4 themes per puzzle)
    2. Validates puzzle completeness
    3. Generates embedding data for CSV output
    4. Creates metadata and statistics
    5. Formats output to match original pipeline
    """
    
    def __init__(self, config: Dict[str, Any], output_dir: str):
        """
        Initialize result aggregator.
        
        Args:
            config: Pipeline configuration
            output_dir: Output directory path
        """
        self.config = config
        self.output_dir = Path(output_dir)
        self.puzzle_config = config['puzzle_generation']
        self.gemini_config = config['gemini']
        
        # Constants from config
        self.themes_per_puzzle = self.puzzle_config.get('themes_per_puzzle', 4)
        self.words_per_theme = self.puzzle_config.get('words_per_theme', 4)
        self.total_puzzle_count = self.puzzle_config.get('total_puzzle_count', 20)
        
        logger.info(f"ResultAggregator initialized: {self.themes_per_puzzle} themes per puzzle, "
                   f"{self.words_per_theme} words per theme, {self.total_puzzle_count} total puzzles")
    
    def aggregate_results(self, successful_results: List[ThemeProcessingResult], 
                         failed_results: List[ThemeProcessingResult]) -> Tuple[Dict, List[Dict]]:
        """
        Aggregate theme results into puzzle format.
        
        Args:
            successful_results: List of successful theme processing results
            failed_results: List of failed theme processing results
        
        Returns:
            Tuple of (results_dict, all_embeddings_list) matching original pipeline format
        """
        logger.info(f"Aggregating {len(successful_results)} successful and {len(failed_results)} failed results")
        
        # Group results by puzzle
        puzzle_groups = self._group_results_by_puzzle(successful_results)
        
        # Create puzzles from complete groups
        puzzles, puzzle_metadata = self._create_puzzles_from_groups(puzzle_groups)
        
        # Generate embedding data for CSV output
        all_embeddings = self._generate_embedding_data(successful_results)
        
        # Create overall metadata
        overall_metadata = self._create_overall_metadata(
            successful_results, failed_results, puzzles, puzzle_metadata
        )
        
        # Format results to match original pipeline
        results_dict = {
            "puzzles": puzzles,
            "metadata": overall_metadata
        }
        
        logger.info(f"Aggregation completed: {len(puzzles)} puzzles created from {len(successful_results)} themes")
        
        return results_dict, all_embeddings
    
    def _group_results_by_puzzle(self, results: List[ThemeProcessingResult]) -> Dict[int, List[ThemeProcessingResult]]:
        """Group results by puzzle ID based on task information."""
        puzzle_groups = defaultdict(list)
        
        for result in results:
            # Extract puzzle ID from task_id (format: p{puzzle_id:02d}_t{theme_idx}_{theme})
            try:
                if result.task_id.startswith('p'):
                    puzzle_id = int(result.task_id.split('_')[0][1:])  # Extract number after 'p'
                    puzzle_groups[puzzle_id].append(result)
                else:
                    # Fallback: assign to puzzle based on order
                    puzzle_id = len(puzzle_groups) // self.themes_per_puzzle + 1
                    puzzle_groups[puzzle_id].append(result)
            except (ValueError, IndexError) as e:
                logger.warning(f"Could not parse puzzle ID from task {result.task_id}: {e}")
                # Assign to next available puzzle
                puzzle_id = len(puzzle_groups) + 1
                puzzle_groups[puzzle_id].append(result)
        
        logger.debug(f"Grouped results into {len(puzzle_groups)} puzzle groups")
        return dict(puzzle_groups)
    
    def _create_puzzles_from_groups(self, puzzle_groups: Dict[int, List[ThemeProcessingResult]]) -> Tuple[Dict, List[Dict]]:
        """Create puzzle objects from grouped results."""
        puzzles = {}
        puzzle_metadata = []
        
        for puzzle_id, theme_results in puzzle_groups.items():
            try:
                # Check if puzzle is complete (has required number of themes)
                if len(theme_results) != self.themes_per_puzzle:
                    logger.warning(f"Puzzle {puzzle_id} incomplete: {len(theme_results)}/{self.themes_per_puzzle} themes")
                    puzzle_metadata.append({
                        "puzzle_id": puzzle_id,
                        "themes": [r.theme for r in theme_results],
                        "error": f"Incomplete puzzle: {len(theme_results)}/{self.themes_per_puzzle} themes"
                    })
                    continue
                
                # Validate all themes have required number of words
                valid_puzzle = True
                for result in theme_results:
                    if len(result.selected_words) != self.words_per_theme:
                        logger.warning(f"Theme '{result.theme}' in puzzle {puzzle_id} has "
                                     f"{len(result.selected_words)}/{self.words_per_theme} words")
                        valid_puzzle = False
                
                if not valid_puzzle:
                    puzzle_metadata.append({
                        "puzzle_id": puzzle_id,
                        "themes": [r.theme for r in theme_results],
                        "error": "Invalid word counts in themes"
                    })
                    continue
                
                # Create puzzle
                puzzle = self._create_puzzle_from_themes(puzzle_id, theme_results)
                puzzle_key = f"puzzle_{puzzle_id}"
                puzzles[puzzle_key] = puzzle
                
                logger.debug(f"Created puzzle {puzzle_id} with {len(theme_results)} themes")
                
            except Exception as e:
                logger.error(f"Error creating puzzle {puzzle_id}: {e}")
                puzzle_metadata.append({
                    "puzzle_id": puzzle_id,
                    "themes": [r.theme for r in theme_results] if theme_results else [],
                    "error": f"Error creating puzzle: {str(e)}"
                })
        
        return puzzles, puzzle_metadata
    
    def _create_puzzle_from_themes(self, puzzle_id: int, theme_results: List[ThemeProcessingResult]) -> Dict:
        """Create a single puzzle from theme results."""
        # Sort results by theme index if available (for consistent ordering)
        try:
            theme_results.sort(key=lambda r: int(r.task_id.split('_')[1][1:]) if '_t' in r.task_id else 0)
        except:
            pass  # Keep original order if sorting fails
        
        # Collect all words and data
        all_words = []
        theme_similarities = []
        themes = []
        
        for result in theme_results:
            all_words.extend(result.selected_words)
            theme_similarities.extend(result.similarities)
            themes.append(result.theme)
        
        # Validate we have exactly 16 words
        if len(all_words) != 16:
            raise ValueError(f"Puzzle has {len(all_words)} words, expected 16")
        
        # Create puzzle object matching original format
        puzzle = {
            "words": all_words,  # All 16 words in order
            "theme_similarity_scores": theme_similarities,  # Similarity scores for each word
            "themes": themes,  # The 4 theme words
            "all_candidates": [],  # Not tracking in multiprocessing version
            "all_similarities": theme_similarities  # Same as theme_similarity_scores
        }
        
        return puzzle
    
    def _generate_embedding_data(self, results: List[ThemeProcessingResult]) -> List[Dict]:
        """Generate embedding data for CSV output matching original format."""
        all_embeddings = []
        
        for result in results:
            if not result.success:
                continue
            
            # Add theme embedding
            theme_embedding_data = {
                "theme": result.theme,
                "word": result.theme,
                "word_type": "theme",
                "embedding": result.theme_embedding,
                "similarity_to_theme": 1.0,
                "rank": 0,
                "dataset": "puzzle"
            }
            all_embeddings.append(theme_embedding_data)
            
            # Add selected word embeddings
            for rank, (word, embedding, similarity) in enumerate(
                zip(result.selected_words, result.word_embeddings, result.similarities), 1
            ):
                word_embedding_data = {
                    "theme": result.theme,
                    "word": word,
                    "word_type": "selected_word",
                    "embedding": embedding,
                    "similarity_to_theme": similarity,
                    "rank": rank,
                    "dataset": "puzzle"
                }
                all_embeddings.append(word_embedding_data)
        
        logger.debug(f"Generated {len(all_embeddings)} embedding entries")
        return all_embeddings
    
    def _create_overall_metadata(self, successful_results: List[ThemeProcessingResult], 
                                failed_results: List[ThemeProcessingResult],
                                puzzles: Dict, puzzle_metadata: List[Dict]) -> Dict:
        """Create overall metadata for the pipeline results."""
        
        # Calculate statistics
        total_themes = len(successful_results) + len(failed_results)
        successful_puzzles = len(puzzles)
        total_processing_time = sum(r.processing_time for r in successful_results + failed_results)
        total_api_calls = sum(r.api_calls_made for r in successful_results)
        total_cache_hits = sum(r.cache_hits for r in successful_results)
        
        # Calculate average similarity
        all_similarities = []
        for result in successful_results:
            all_similarities.extend(result.similarities)
        avg_similarity = sum(all_similarities) / len(all_similarities) if all_similarities else 0.0
        
        metadata = {
            "total_themes_needed": self.total_puzzle_count * self.themes_per_puzzle,
            "total_themes_available": total_themes,
            "themes_reused": False,  # Assume no reuse for now
            "successful_puzzles": successful_puzzles,
            "failed_puzzles": puzzle_metadata,  # List of failed puzzle info
            "processing_time": total_processing_time,
            "gemini_config": {
                "model_id": self.gemini_config['model_id'],
                "embedding_dimension": self.gemini_config['embedding_dimension'],
                "words_per_theme": self.words_per_theme,
                "themes_per_puzzle": self.themes_per_puzzle
            },
            "multiprocessing_stats": {
                "total_api_calls": total_api_calls,
                "total_cache_hits": total_cache_hits,
                "cache_miss_rate": (total_api_calls / (total_api_calls + total_cache_hits)) if (total_api_calls + total_cache_hits) > 0 else 0,
                "avg_processing_time_per_theme": total_processing_time / total_themes if total_themes > 0 else 0,
                "avg_similarity": avg_similarity
            }
        }
        
        return metadata
    
    def get_aggregation_stats(self) -> Dict[str, Any]:
        """Get statistics about the aggregation process."""
        return {
            "themes_per_puzzle": self.themes_per_puzzle,
            "words_per_theme": self.words_per_theme,
            "total_puzzle_count": self.total_puzzle_count,
            "output_dir": str(self.output_dir)
        }


class SingleProcessResultAggregator:
    """
    Simplified result aggregator for single-process mode.
    
    This provides the same interface but handles results from a single process
    without the complexity of multiprocessing coordination.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize single-process aggregator."""
        self.config = config
        self.puzzle_config = config['puzzle_generation']
        
        logger.info("SingleProcessResultAggregator initialized")
    
    def aggregate_theme_results(self, theme_results: List[Dict], 
                              theme_embeddings: List[List[float]]) -> Tuple[Dict, List[Dict]]:
        """
        Aggregate results from single-process theme processing.
        
        Args:
            theme_results: List of theme result dictionaries
            theme_embeddings: List of theme embedding vectors
        
        Returns:
            Tuple of (results_dict, all_embeddings_list)
        """
        # This would implement aggregation for single-process results
        # For now, pass through to maintain compatibility
        
        results_dict = {
            "puzzles": {},  # Would group themes into puzzles
            "metadata": {
                "multiprocessing_enabled": False,
                "single_process_mode": True
            }
        }
        
        all_embeddings = []  # Would format embedding data
        
        return results_dict, all_embeddings