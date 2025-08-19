#!/usr/bin/env python3
"""
Word Selector for Enhanced Wiki Puzzle Pipeline

Uses semantic search on the themes_index to find the top 10 candidate words for each
selected theme. This is the first stage of word selection before Gemini enhancement.
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

class WordSelector:
    """Selects candidate words using semantic search on themes index."""
    
    def __init__(self, config_path: str = "params.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.puzzle_config = self.config['puzzle_generation']
        self.vector_config = self.config['vector_search']
        self.paths_config = self.config['paths']
        
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
        
        try:
            self.vector_loader = PythonVectorLoader(data_dir=str(data_source))
            
            result = self.vector_loader.initialize()
            if not result.get('success'):
                raise Exception(f"Failed to initialize vector loader: {result.get('message', 'Unknown error')}")
            
            logger.info("Vector loader initialized successfully")
            logger.info(f"Vocabulary size: {len(self.vector_loader.vocabulary)}")
            
        except Exception as e:
            logger.error(f"Error initializing vector loader: {e}")
            sys.exit(1)
    
    def load_themes(self) -> List[str]:
        """Load selected themes from previous pipeline stage."""
        themes_path = Path(self.paths_config['themes']) / "selected_themes.json"
        
        if not themes_path.exists():
            logger.error(f"Selected themes file not found: {themes_path}")
            sys.exit(1)
        
        try:
            with open(themes_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            themes = data.get('themes', [])
            logger.info(f"Loaded {len(themes)} themes from {themes_path}")
            return themes
            
        except Exception as e:
            logger.error(f"Error loading themes: {e}")
            sys.exit(1)
    
    def find_candidate_words(self, theme: str) -> Tuple[List[str], List[float]]:
        """Find the top candidate words for a theme using semantic search."""
        candidate_count = self.puzzle_config['candidate_words_per_theme']
        max_candidates = self.vector_config.get('max_search_candidates', 20)
        min_similarity = self.puzzle_config['min_similarity_threshold']
        
        # Get nearest neighbors for the theme
        neighbors = self.vector_loader.find_nearest_neighbors(theme, k=max_candidates)
        
        if not neighbors:
            logger.warning(f"No similar words found for theme: {theme}")
            return [], []
        
        # Filter by minimum similarity threshold
        valid_neighbors = [(word, score) for word, score in neighbors if score >= min_similarity]
        
        if not valid_neighbors:
            logger.warning(f"No words above similarity threshold ({min_similarity}) for theme: {theme}")
            return [], []
        
        # Take top candidates up to desired count
        top_candidates = valid_neighbors[:candidate_count]
        
        words = [word for word, _ in top_candidates]
        scores = [score for _, score in top_candidates]
        
        logger.debug(f"Found {len(words)} candidate words for theme '{theme}' (scores: {min(scores):.3f}-{max(scores):.3f})")
        
        return words, scores
    
    def process_all_themes(self, themes: List[str]) -> Dict:
        """Process all themes to find candidate words."""
        results = {
            "candidates": {},
            "metadata": {
                "total_themes": len(themes),
                "successful_themes": 0,
                "failed_themes": [],
                "processing_time": 0,
                "config": {
                    "candidate_words_per_theme": self.puzzle_config['candidate_words_per_theme'],
                    "min_similarity_threshold": self.puzzle_config['min_similarity_threshold'],
                    "vector_source": self.vector_config['data_source']
                }
            }
        }
        
        start_time = time.time()
        successful = 0
        
        for i, theme in enumerate(themes, 1):
            logger.info(f"Processing theme {i}/{len(themes)}: {theme}")
            
            try:
                words, scores = self.find_candidate_words(theme)
                
                if words:
                    results["candidates"][theme] = {
                        "words": words,
                        "similarity_scores": scores,
                        "word_count": len(words)
                    }
                    successful += 1
                    logger.info(f"  → Found {len(words)} candidates")
                else:
                    results["metadata"]["failed_themes"].append({
                        "theme": theme,
                        "reason": "No candidates found above similarity threshold"
                    })
                    logger.warning(f"  → No candidates found for {theme}")
                    
            except Exception as e:
                error_msg = f"Error processing theme: {e}"
                results["metadata"]["failed_themes"].append({
                    "theme": theme,
                    "reason": error_msg
                })
                logger.error(f"  → {error_msg}")
        
        # Update metadata
        processing_time = time.time() - start_time
        results["metadata"]["successful_themes"] = successful
        results["metadata"]["processing_time"] = processing_time
        
        logger.info(f"Candidate selection completed: {successful}/{len(themes)} themes successful")
        logger.info(f"Processing time: {processing_time:.2f} seconds")
        
        return results
    
    def save_candidates(self, results: Dict):
        """Save candidate words to hierarchical output structure."""
        # Create output directory if it doesn't exist
        candidates_dir = Path(self.paths_config['candidates'])
        candidates_dir.mkdir(parents=True, exist_ok=True)
        
        # Save to hierarchical path
        output_path = candidates_dir / "candidate_words.json"
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            
            successful = results["metadata"]["successful_themes"]
            total = results["metadata"]["total_themes"]
            logger.info(f"Saved candidate words for {successful}/{total} themes to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving candidate words: {e}")
            sys.exit(1)

def main():
    """Main execution function."""
    logger.info("Starting candidate word selection for enhanced wiki puzzle pipeline")
    
    selector = WordSelector()
    
    # Load themes from previous stage
    themes = selector.load_themes()
    
    # Process all themes to find candidate words
    results = selector.process_all_themes(themes)
    
    # Save results to hierarchical structure
    selector.save_candidates(results)
    
    logger.info("Candidate word selection completed successfully")

if __name__ == "__main__":
    main()