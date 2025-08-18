#!/usr/bin/env python3
"""
Filter Valid Categories Script

Creates a filtered version of wiki_categories that only contains categories
which exist in the vector index vocabulary. This ensures higher success rates
for puzzle generation.
"""

import json
import logging
import sys
from pathlib import Path
from typing import List, Set
import time

# Add the scripts directory to path to import PythonVectorLoader
sys.path.append(str(Path(__file__).parent.parent.parent / "scripts"))

try:
    from python_vector_loader import PythonVectorLoader
except ImportError as e:
    logging.error(f"Could not import PythonVectorLoader: {e}")
    logging.error("Make sure the scripts directory is accessible")
    sys.exit(1)

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)

class CategoryFilter:
    """Filters wiki categories to only include ones that exist in vector vocabulary."""
    
    def __init__(self, vector_data_path: str = "../../themes_index"):
        """Initialize with vector data path."""
        self.vector_data_path = Path(vector_data_path)
        self.vector_loader = None
        self.vocabulary_set = None
        
        self._initialize_vector_loader()
    
    def _initialize_vector_loader(self):
        """Initialize the vector loader and create vocabulary set."""
        if not self.vector_data_path.exists():
            raise FileNotFoundError(f"Vector data source not found: {self.vector_data_path}")
        
        try:
            logger.info(f"Initializing vector loader from {self.vector_data_path}")
            self.vector_loader = PythonVectorLoader(str(self.vector_data_path))
            result = self.vector_loader.initialize()
            
            if not result.get('success'):
                raise Exception(f"Failed to initialize vector loader: {result.get('message', 'Unknown error')}")
            
            # Create a set for fast lookup
            self.vocabulary_set = set(word.lower() for word in self.vector_loader.vocabulary)
            logger.info(f"Loaded vocabulary with {len(self.vocabulary_set)} words")
            
        except Exception as e:
            logger.error(f"Error initializing vector loader: {e}")
            sys.exit(1)
    
    def load_wiki_categories(self, categories_path: str = "../data/categories/wiki_categories") -> List[str]:
        """Load all wiki categories from file."""
        categories_path = Path(categories_path)
        
        if not categories_path.exists():
            raise FileNotFoundError(f"Wiki categories file not found: {categories_path}")
        
        try:
            with open(categories_path, 'r', encoding='utf-8') as f:
                categories = [line.strip() for line in f if line.strip()]
            
            logger.info(f"Loaded {len(categories)} categories from {categories_path}")
            return categories
            
        except Exception as e:
            logger.error(f"Error reading wiki categories file: {e}")
            sys.exit(1)
    
    def check_category_exists(self, category: str) -> bool:
        """Check if a category exists directly in the vector index vocabulary."""
        # Only check for exact matches - no special cases or fallbacks
        category_lower = category.lower()
        return category_lower in self.vocabulary_set
    
    def filter_categories(self, categories: List[str]) -> tuple[List[str], List[str]]:
        """Filter categories, returning valid and invalid lists."""
        valid_categories = []
        invalid_categories = []
        
        logger.info("Checking category existence in vocabulary...")
        
        for i, category in enumerate(categories):
            if i % 50 == 0 and i > 0:
                logger.info(f"Processed {i}/{len(categories)} categories...")
            
            if self.check_category_exists(category):
                valid_categories.append(category)
            else:
                invalid_categories.append(category)
        
        logger.info(f"Found {len(valid_categories)} valid categories out of {len(categories)} total")
        logger.info(f"Success rate: {len(valid_categories) / len(categories) * 100:.1f}%")
        
        return valid_categories, invalid_categories
    
    def save_filtered_categories(self, valid_categories: List[str], 
                               output_path: str = "../data/categories/wiki_categories_filtered"):
        """Save filtered categories to output file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                for category in valid_categories:
                    f.write(f"{category}\n")
            
            logger.info(f"Saved {len(valid_categories)} filtered categories to {output_path}")
            
        except Exception as e:
            logger.error(f"Error saving filtered categories: {e}")
            sys.exit(1)
    
    def save_report(self, valid_categories: List[str], invalid_categories: List[str],
                   report_path: str = "../data/categories/filter_report.json"):
        """Save filtering report with statistics."""
        report_path = Path(report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        
        report = {
            "total_categories": len(valid_categories) + len(invalid_categories),
            "valid_categories": len(valid_categories),
            "invalid_categories": len(invalid_categories),
            "success_rate": len(valid_categories) / (len(valid_categories) + len(invalid_categories)),
            "filtered_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "vector_source": str(self.vector_data_path),
            "vocabulary_size": len(self.vocabulary_set),
            "sample_invalid_categories": invalid_categories[:20],  # First 20 for debugging
            "sample_valid_categories": valid_categories[:20]      # First 20 for verification
        }
        
        try:
            with open(report_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved filtering report to {report_path}")
            
        except Exception as e:
            logger.error(f"Error saving report: {e}")
            sys.exit(1)

def main():
    """Main execution function."""
    logger.info("Starting wiki categories filtering process")
    
    # Initialize filter
    filter_tool = CategoryFilter()
    
    # Load all categories
    all_categories = filter_tool.load_wiki_categories()
    
    if not all_categories:
        logger.error("No categories loaded")
        sys.exit(1)
    
    # Filter categories
    valid_categories, invalid_categories = filter_tool.filter_categories(all_categories)
    
    if not valid_categories:
        logger.error("No valid categories found")
        sys.exit(1)
    
    # Save results
    filter_tool.save_filtered_categories(valid_categories)
    filter_tool.save_report(valid_categories, invalid_categories)
    
    # Print summary
    logger.info("="*50)
    logger.info("FILTERING SUMMARY")
    logger.info("="*50)
    logger.info(f"Total categories processed: {len(all_categories)}")
    logger.info(f"Valid categories found: {len(valid_categories)}")
    logger.info(f"Invalid categories: {len(invalid_categories)}")
    logger.info(f"Success rate: {len(valid_categories) / len(all_categories) * 100:.1f}%")
    logger.info("="*50)
    
    if len(valid_categories) >= 100:
        logger.info(f"✅ Success! Found {len(valid_categories)} valid categories - enough for puzzle generation")
    else:
        logger.warning(f"⚠️  Only found {len(valid_categories)} valid categories - may need to adjust filtering criteria")

if __name__ == "__main__":
    main()