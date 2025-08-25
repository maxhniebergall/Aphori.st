#!/usr/bin/env python3
"""
Theme Selector for Enhanced Wiki Puzzle Pipeline

Selects random Wikipedia categories for puzzle generation with hierarchical output structure.
Adapted from the original wiki_puzzle_pipeline with enhanced path management.
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
    """Selects themes for puzzle generation with hierarchical output."""
    
    def __init__(self, config_path: str = "params.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.puzzle_config = self.config['puzzle_generation']
        self.themes_config = self.config['themes']
        self.paths_config = self.config['paths']
        
        # Set random seed for reproducibility
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
    
    def load_categories(self) -> List[str]:
        """Load and filter Wikipedia categories."""
        categories_path = Path(self.themes_config['source'])
        
        if not categories_path.exists():
            logger.error(f"Categories file not found: {categories_path}")
            sys.exit(1)
        
        try:
            with open(categories_path, 'r', encoding='utf-8') as f:
                categories = [line.strip() for line in f.readlines()]
            
            logger.info(f"Loaded {len(categories)} categories from {categories_path}")
            
            # Filter categories
            filtered_categories = self.filter_categories(categories)
            logger.info(f"After filtering: {len(filtered_categories)} categories")
            
            return filtered_categories
            
        except Exception as e:
            logger.error(f"Error loading categories: {e}")
            sys.exit(1)
    
    def filter_categories(self, categories: List[str]) -> List[str]:
        """Filter categories based on configuration rules."""
        exclude_categories = set(self.themes_config.get('exclude_categories', []))
        min_length = self.themes_config.get('min_theme_length', 3)
        
        filtered = []
        for category in categories:
            if category in exclude_categories:
                continue
            if len(category) < min_length:
                continue
            filtered.append(category)
        
        logger.info(f"Excluded {len(categories) - len(filtered)} categories based on filter rules")
        return filtered
    
    def select_themes(self, categories: List[str]) -> List[str]:
        """Randomly select themes for puzzle generation."""
        puzzle_count = self.puzzle_config['total_puzzle_count']
        themes_per_puzzle = self.puzzle_config.get('themes_per_puzzle', 4)
        themes_needed = puzzle_count * themes_per_puzzle
        
        if len(categories) < themes_needed:
            logger.warning(f"Only {len(categories)} categories available, but {themes_needed} themes needed ({puzzle_count} puzzles × {themes_per_puzzle} themes/puzzle)")
            themes_needed = len(categories)
        
        # Sample without replacement to ensure unique themes
        selected = random.sample(categories, themes_needed)
        
        logger.info(f"Selected {len(selected)} themes for {puzzle_count} puzzles ({themes_per_puzzle} themes per puzzle)")
        return selected
    
    def save_themes(self, themes: List[str]):
        """Save selected themes to hierarchical output structure."""
        output_data = {
            "themes": themes,
            "total_count": len(themes),
            "selection_method": self.puzzle_config['theme_selection_method'],
            "random_seed": self.puzzle_config['random_seed'],
            "excluded_categories": self.themes_config.get('exclude_categories', []),
            "min_theme_length": self.themes_config.get('min_theme_length', 3),
            "config": {
                "total_puzzle_count": self.puzzle_config['total_puzzle_count'],
                "source_file": self.themes_config['source']
            }
        }
        
        # Create output directory if it doesn't exist
        themes_dir = Path(self.paths_config['themes'])
        themes_dir.mkdir(parents=True, exist_ok=True)
        
        # Save to hierarchical path
        output_path = themes_dir / "selected_themes.json"
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved {len(themes)} selected themes to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving themes: {e}")
            sys.exit(1)

def main():
    """Main execution function."""
    logger.info("Starting theme selection for enhanced wiki puzzle pipeline")
    
    selector = ThemeSelector()
    
    # Load and filter categories
    categories = selector.load_categories()
    
    # Select themes
    selected_themes = selector.select_themes(categories)
    
    # Save to hierarchical structure
    selector.save_themes(selected_themes)
    
    logger.info("Theme selection completed successfully")

if __name__ == "__main__":
    main()