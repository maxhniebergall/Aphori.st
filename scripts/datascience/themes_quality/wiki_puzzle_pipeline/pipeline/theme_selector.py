#!/usr/bin/env python3
"""
Theme Selector for Wiki Puzzle Pipeline

Randomly selects Wikipedia categories from the wiki_categories file to use as
puzzle themes. Filters out excluded categories and ensures minimum theme length.
"""

import json
import logging
import random
import sys
from pathlib import Path
from typing import List, Dict
import yaml

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ThemeSelector:
    """Selects random themes from Wikipedia categories."""
    
    def __init__(self, config_path: str = "params.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.puzzle_config = self.config['puzzle_generation']
        self.theme_config = self.config['themes']
        
        # Set random seed for reproducible selection
        if 'random_seed' in self.puzzle_config:
            random.seed(self.puzzle_config['random_seed'])
        
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
    
    def load_wiki_categories(self) -> List[str]:
        """Load all available Wikipedia categories."""
        source_path = Path(self.theme_config['source'])
        
        if not source_path.exists():
            raise FileNotFoundError(f"Wiki categories file not found: {source_path}")
        
        try:
            with open(source_path, 'r', encoding='utf-8') as f:
                categories = [line.strip() for line in f if line.strip()]
            
            logger.info(f"Loaded {len(categories)} categories from {source_path}")
            return categories
            
        except Exception as e:
            logger.error(f"Error reading wiki categories file: {e}")
            sys.exit(1)
    
    def filter_categories(self, categories: List[str]) -> List[str]:
        """Filter categories based on exclusion list and minimum length."""
        exclude_list = self.theme_config.get('exclude_categories', [])
        min_length = self.theme_config.get('min_theme_length', 3)
        
        filtered = []
        for category in categories:
            # Skip excluded categories
            if category in exclude_list:
                continue
                
            # Skip categories that are too short
            if len(category) < min_length:
                continue
                
            filtered.append(category)
        
        logger.info(f"Filtered to {len(filtered)} valid categories (excluded {len(categories) - len(filtered)})")
        return filtered
    
    def select_themes(self, categories: List[str]) -> List[str]:
        """Randomly select themes for puzzle generation."""
        puzzle_count = self.puzzle_config['total_puzzle_count']
        
        if len(categories) < puzzle_count:
            logger.warning(f"Only {len(categories)} categories available, but {puzzle_count} puzzles requested")
            puzzle_count = len(categories)
        
        # Sample without replacement to ensure unique themes
        selected = random.sample(categories, puzzle_count)
        
        logger.info(f"Selected {len(selected)} themes for puzzle generation")
        return selected
    
    def save_selected_themes(self, themes: List[str], output_path: str = "data/selected_themes.json"):
        """Save selected themes to JSON file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        theme_data = {
            "themes": themes,
            "total_count": len(themes),
            "selection_method": self.puzzle_config['theme_selection_method'],
            "random_seed": self.puzzle_config.get('random_seed'),
            "excluded_categories": self.theme_config.get('exclude_categories', []),
            "min_theme_length": self.theme_config.get('min_theme_length', 3)
        }
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(theme_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved {len(themes)} selected themes to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving selected themes: {e}")
            sys.exit(1)

def main():
    """Main execution function."""
    logger.info("Starting theme selection for wiki puzzle pipeline")
    
    selector = ThemeSelector()
    
    # Load and filter categories
    all_categories = selector.load_wiki_categories()
    filtered_categories = selector.filter_categories(all_categories)
    
    if not filtered_categories:
        logger.error("No valid categories available after filtering")
        sys.exit(1)
    
    # Select themes for puzzles
    selected_themes = selector.select_themes(filtered_categories)
    
    # Save results
    selector.save_selected_themes(selected_themes)
    
    logger.info("Theme selection completed successfully")

if __name__ == "__main__":
    main()