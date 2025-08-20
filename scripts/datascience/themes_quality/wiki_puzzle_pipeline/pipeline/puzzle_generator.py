#!/usr/bin/env python3
"""
Puzzle Generator for Wiki Puzzle Pipeline

Uses semantic search on the themes_index to find the 4 closest words for each
selected theme, creating simple embedding-based puzzles.
"""

import json
import logging
import sys
import time
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import yaml

# Add the scripts directory to path to import PythonVectorLoader
sys.path.append(str(Path(__file__).parent.parent.parent / "scripts"))

try:
    from python_vector_loader import PythonVectorLoader
except ImportError as e:
    logging.error(f"Could not import PythonVectorLoader: {e}")
    logging.error("Make sure the scripts directory is accessible")
    sys.exit(1)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PuzzleGenerator:
    """Generates puzzles using semantic search on themes."""
    
    def __init__(self, config_path: str = "params.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.puzzle_config = self.config['puzzle_generation']
        self.vector_config = self.config['vector_search']
        self.output_config = self.config['output']
        
        # Initialize vector loader
        self.vector_loader = None
        self._initialize_vector_loader()
        
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
    
    def _initialize_vector_loader(self):
        """Initialize the vector loader with themes index data."""
        data_source = Path(self.vector_config['data_source'])
        
        if not data_source.exists():
            raise FileNotFoundError(f"Vector data source not found: {data_source}")
        
        try:
            logger.info(f"Initializing vector loader from {data_source}")
            self.vector_loader = PythonVectorLoader(str(data_source))
            result = self.vector_loader.initialize()
            if not result.get('success'):
                raise Exception(f"Failed to initialize vector loader: {result.get('message', 'Unknown error')}")
            logger.info(f"Loaded {len(self.vector_loader.vocabulary)} words with {self.vector_loader.vectors.shape[1]}D vectors")
            
        except Exception as e:
            logger.error(f"Error initializing vector loader: {e}")
            sys.exit(1)
    
    def load_selected_themes(self, themes_path: str = "data/selected_themes.json") -> List[str]:
        """Load the selected themes from JSON file."""
        themes_path = Path(themes_path)
        
        if not themes_path.exists():
            raise FileNotFoundError(f"Selected themes file not found: {themes_path}")
        
        try:
            with open(themes_path, 'r', encoding='utf-8') as f:
                theme_data = json.load(f)
            
            themes = theme_data['themes']
            logger.info(f"Loaded {len(themes)} themes for puzzle generation")
            return themes
            
        except Exception as e:
            logger.error(f"Error loading selected themes: {e}")
            sys.exit(1)
    
    def find_theme_words(self, theme: str) -> Tuple[List[str], List[float]]:
        """Find exactly 4 words for a theme using semantic search."""
        words_per_theme = 4
        max_candidates = self.vector_config.get('max_search_candidates', 20)
        min_similarity = self.puzzle_config['min_similarity_threshold']
        
        # Get nearest neighbors for the theme
        neighbors = self.vector_loader.find_nearest_neighbors(theme, k=max_candidates)
        
        if not neighbors:
            raise ValueError(f"No similar words found for theme: {theme}")
        
        # Filter by minimum similarity threshold
        valid_neighbors = [(word, score) for word, score in neighbors if score >= min_similarity]
        
        if len(valid_neighbors) < words_per_theme:
            raise ValueError(f"Only {len(valid_neighbors)} words found above threshold {min_similarity} for theme: {theme}. Need exactly {words_per_theme}.")
        
        # Take exactly the top 4 words
        selected_neighbors = valid_neighbors[:words_per_theme]
        
        words = [word for word, score in selected_neighbors]
        scores = [score for word, score in selected_neighbors]
        
        return words, scores
    
    def generate_puzzle(self, themes: List[str], puzzle_id: int) -> Dict:
        """Generate a single 4x4 puzzle using exactly 4 themes."""
        if len(themes) != 4:
            raise ValueError(f"Expected exactly 4 themes for puzzle {puzzle_id}, got {len(themes)}")
        
        logger.debug(f"Generating puzzle {puzzle_id} for themes: {themes}")
        
        categories = []
        all_words = []
        all_scores = []
        
        for i, theme in enumerate(themes):
            words, scores = self.find_theme_words(theme)
            
            if len(words) != 4:
                raise ValueError(f"Theme '{theme}' produced {len(words)} words, expected exactly 4")
            
            categories.append({
                "id": i,
                "theme": theme,
                "words": words,
                "similarity_scores": scores,
                "average_similarity": sum(scores) / len(scores)
            })
            
            all_words.extend(words)
            all_scores.extend(scores)
        
        puzzle = {
            "id": puzzle_id,
            "categories": categories,
            "words": all_words,
            "word_count": len(all_words)
        }
        
        # Add overall similarity scores if requested
        if self.output_config.get('include_similarity_scores', False):
            puzzle["overall_similarity_scores"] = all_scores
            puzzle["average_similarity"] = sum(all_scores) / len(all_scores)
        
        return puzzle
    
    def generate_all_puzzles(self, themes: List[str]) -> Tuple[List[Dict], Dict]:
        """Generate 4x4 puzzles using groups of 4 themes each."""
        target_puzzle_count = self.puzzle_config['total_puzzle_count']
        themes_needed = target_puzzle_count * 4
        
        if len(themes) < 4:
            raise ValueError(f"Need at least 4 themes to generate puzzles, but only {len(themes)} themes available")
        
        # Extend themes by cycling if we don't have enough unique ones
        if len(themes) < themes_needed:
            logger.warning(f"Only {len(themes)} themes available, need {themes_needed}. Will reuse themes.")
            extended_themes = []
            for i in range(themes_needed):
                extended_themes.append(themes[i % len(themes)])
            themes_to_use = extended_themes
        else:
            themes_to_use = themes[:themes_needed]
        
        puzzles = []
        metadata = {
            "total_themes_needed": themes_needed,
            "total_themes_available": len(themes),
            "themes_reused": len(themes) < themes_needed,
            "successful_puzzles": 0,
            "failed_puzzles": [],
            "generation_time": 0,
            "config": {
                "themes_per_puzzle": 4,
                "words_per_theme": 4,
                "min_similarity_threshold": self.puzzle_config['min_similarity_threshold'],
                "vector_source": self.vector_config['data_source']
            }
        }
        
        start_time = time.time()
        
        # Group themes into sets of 4 for each puzzle
        for puzzle_id in range(1, target_puzzle_count + 1):
            start_idx = (puzzle_id - 1) * 4
            puzzle_themes = themes_to_use[start_idx:start_idx + 4]
            
            try:
                puzzle = self.generate_puzzle(puzzle_themes, puzzle_id)
                puzzles.append(puzzle)
                metadata["successful_puzzles"] += 1
                
                if puzzle_id % 10 == 0:
                    logger.info(f"Generated {puzzle_id}/{target_puzzle_count} puzzles...")
                    
            except Exception as e:
                logger.error(f"Error generating puzzle {puzzle_id} with themes {puzzle_themes}: {e}")
                metadata["failed_puzzles"].append({
                    "puzzle_id": puzzle_id,
                    "themes": puzzle_themes,
                    "error": str(e)
                })
        
        end_time = time.time()
        metadata["generation_time"] = end_time - start_time
        
        logger.info(f"Generated {metadata['successful_puzzles']} puzzles successfully")
        if metadata["failed_puzzles"]:
            logger.warning(f"Failed to generate {len(metadata['failed_puzzles'])} puzzles")
        
        return puzzles, metadata
    
    def save_puzzles(self, puzzles: List[Dict], output_path: str = None):
        """Save generated puzzles to JSON file."""
        if output_path is None:
            output_path = self.output_config['puzzle_file']
        
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        puzzle_output = {
            "puzzles": puzzles,
            "total_count": len(puzzles),
            "format_version": "1.0",
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        
        # Add metadata if requested
        if self.output_config.get('include_metadata', False):
            puzzle_output["generation_config"] = {
                "themes_per_puzzle": 4,
                "words_per_theme": 4,
                "min_similarity_threshold": self.puzzle_config['min_similarity_threshold'],
                "theme_selection_method": self.puzzle_config.get('theme_selection_method'),
                "vector_source": self.vector_config['data_source']
            }
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(puzzle_output, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved {len(puzzles)} puzzles to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving puzzles: {e}")
            sys.exit(1)
    
    def save_metadata(self, metadata: Dict, output_path: str = None):
        """Save generation metadata to JSON file."""
        if output_path is None:
            output_path = self.output_config['metadata_file']
        
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved generation metadata to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving metadata: {e}")
            sys.exit(1)

def main():
    """Main execution function."""
    logger.info("Starting puzzle generation for wiki puzzle pipeline")
    
    generator = PuzzleGenerator()
    
    # Load selected themes
    themes = generator.load_selected_themes()
    
    if not themes:
        logger.error("No themes available for puzzle generation")
        sys.exit(1)
    
    # Generate all puzzles
    puzzles, metadata = generator.generate_all_puzzles(themes)
    
    if not puzzles:
        logger.error("No puzzles were generated successfully")
        sys.exit(1)
    
    # Save results
    generator.save_puzzles(puzzles)
    generator.save_metadata(metadata)
    
    logger.info(f"Puzzle generation completed: {len(puzzles)} puzzles generated in {metadata['generation_time']:.2f} seconds")

if __name__ == "__main__":
    main()