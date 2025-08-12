#!/usr/bin/env python3
"""
Vocabulary Exporter for NLP Pipeline

Exports categorized words to separate vocabulary files for each category.
This is the final stage of the NLP categorization pipeline.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import List, Dict, Set
from datetime import datetime
import yaml

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VocabularyExporter:
    """Exports categorized words to separate vocabulary files."""
    
    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.categories_config = self.config['categories']
        self.output_config = self.config['output']
        self.paths_config = self.config['paths']
        
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
    
    def load_categorized_words(self, input_file: str) -> Dict:
        """Load categorized words from JSON file."""
        logger.info(f"Loading categorized words from {input_file}")
        
        try:
            with open(input_file, 'r') as f:
                data = json.load(f)
            
            if 'categorized_words' not in data:
                logger.error("Input file does not contain 'categorized_words' key")
                sys.exit(1)
                
            categorized_words = data['categorized_words']
            metadata = data.get('metadata', {})
            
            logger.info(f"Loaded categorized words for {len(categorized_words)} categories")
            return categorized_words, metadata
            
        except Exception as e:
            logger.error(f"Error loading categorized words: {e}")
            sys.exit(1)
    
    def validate_category_data(self, categorized_words: Dict[str, List[Dict]]) -> bool:
        """Validate categorized words data structure."""
        logger.info("Validating categorized words data...")
        
        validation_config = self.config.get('validation', {})
        min_words = validation_config.get('min_words_per_category', 10)
        max_words = validation_config.get('max_words_per_category', 2000)
        
        issues_found = False
        
        for category_name, words in categorized_words.items():
            # Check if category exists in configuration
            if category_name not in self.categories_config:
                logger.error(f"Unknown category: {category_name}")
                issues_found = True
                continue
            
            # Check word count bounds
            word_count = len(words)
            if word_count < min_words:
                logger.warning(f"Category '{category_name}' has only {word_count} words (minimum: {min_words})")
            elif word_count > max_words:
                logger.warning(f"Category '{category_name}' has {word_count} words (maximum: {max_words})")
            
            # Validate word structure
            for i, word_data in enumerate(words[:5]):  # Check first 5 words
                required_fields = ['word', 'confidence_score', 'embedding_score', 'dictionary_score']
                for field in required_fields:
                    if field not in word_data:
                        logger.error(f"Missing field '{field}' in word data for category '{category_name}'")
                        issues_found = True
        
        if issues_found:
            logger.error("Validation failed")
            sys.exit(1)
        
        logger.info("Validation passed")
        return True
    
    def create_category_vocabulary_file(self, category_name: str, words: List[Dict], metadata: Dict) -> Dict:
        """Create vocabulary file data for a single category."""
        category_config = self.categories_config[category_name]
        
        # Calculate statistics
        if words:
            confidence_scores = [word['confidence_score'] for word in words]
            avg_confidence = sum(confidence_scores) / len(confidence_scores)
            high_confidence_count = sum(1 for score in confidence_scores if score >= 0.7)
            multi_category_count = sum(1 for word in words if word.get('alternative_categories', []))
        else:
            avg_confidence = 0.0
            high_confidence_count = 0
            multi_category_count = 0
        
        # Create vocabulary file structure
        vocab_file_data = {
            'category': category_name,
            'description': category_config['description'],
            'generation_timestamp': datetime.now().isoformat() + 'Z',
            'word_count': len(words),
            'confidence_threshold': category_config['confidence_threshold'],
            'words': words if self.output_config.get('sort_by_confidence', True) else sorted(words, key=lambda x: x['word']),
            'metadata': {
                'avg_confidence': round(avg_confidence, 3),
                'high_confidence_count': high_confidence_count,
                'multi_category_count': multi_category_count,
                'prototype_words': category_config['prototype_words']
            }
        }
        
        return vocab_file_data
    
    def export_category_vocabularies(self, categorized_words: Dict[str, List[Dict]], source_metadata: Dict) -> Dict[str, str]:
        """Export vocabulary files for all categories."""
        output_dir = self.paths_config['output_dir']
        
        # Create output directory
        try:
            os.makedirs(output_dir, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create output directory: {e}")
            sys.exit(1)
        
        logger.info(f"Exporting category vocabularies to {output_dir}")
        
        exported_files = {}
        export_summary = {
            'total_categories': 0,
            'total_words': 0,
            'files_created': [],
            'category_stats': {}
        }
        
        # Export each category
        for category_name, words in categorized_words.items():
            # Create vocabulary file data
            vocab_file_data = self.create_category_vocabulary_file(category_name, words, source_metadata)
            
            # Determine output filename
            filename = f"{category_name}.json"
            output_path = os.path.join(output_dir, filename)
            
            # Write vocabulary file
            try:
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(vocab_file_data, f, indent=2, ensure_ascii=False)
                
                exported_files[category_name] = output_path
                export_summary['files_created'].append(output_path)
                export_summary['category_stats'][category_name] = {
                    'word_count': len(words),
                    'avg_confidence': vocab_file_data['metadata']['avg_confidence']
                }
                export_summary['total_words'] += len(words)
                
                logger.info(f"Exported {len(words)} words for category '{category_name}' to {filename}")
                
            except Exception as e:
                logger.error(f"Failed to write vocabulary file for category '{category_name}': {e}")
                sys.exit(1)
        
        export_summary['total_categories'] = len(exported_files)
        return exported_files, export_summary
    
    def create_export_metadata(self, export_summary: Dict, source_metadata: Dict) -> str:
        """Create export metadata file."""
        metadata_path = "data/export_metadata.json"
        
        export_metadata = {
            'export_timestamp': datetime.now().isoformat() + 'Z',
            'export_summary': export_summary,
            'source_metadata': source_metadata,
            'configuration': {
                'categories': self.categories_config,
                'output_format': self.output_config,
                'paths': self.paths_config
            },
            'pipeline_stage': 'vocabulary_export'
        }
        
        try:
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(export_metadata, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Created export metadata at {metadata_path}")
            return metadata_path
            
        except Exception as e:
            logger.error(f"Failed to create export metadata: {e}")
            sys.exit(1)
    
    def run_integrity_checks(self, exported_files: Dict[str, str]) -> bool:
        """Run integrity checks on exported files."""
        logger.info("Running integrity checks on exported files...")
        
        checks_passed = True
        
        for category_name, file_path in exported_files.items():
            try:
                # Check file exists and is readable
                if not os.path.exists(file_path):
                    logger.error(f"Exported file not found: {file_path}")
                    checks_passed = False
                    continue
                
                # Check file can be loaded as JSON
                with open(file_path, 'r') as f:
                    data = json.load(f)
                
                # Check required fields
                required_fields = ['category', 'description', 'word_count', 'words', 'metadata']
                for field in required_fields:
                    if field not in data:
                        logger.error(f"Missing field '{field}' in {file_path}")
                        checks_passed = False
                
                # Check word count consistency
                if len(data.get('words', [])) != data.get('word_count', 0):
                    logger.error(f"Word count mismatch in {file_path}")
                    checks_passed = False
                
                logger.info(f"✅ Integrity check passed for {category_name}")
                
            except Exception as e:
                logger.error(f"Integrity check failed for {file_path}: {e}")
                checks_passed = False
        
        if checks_passed:
            logger.info("All integrity checks passed")
        else:
            logger.error("Some integrity checks failed")
            sys.exit(1)
        
        return checks_passed
    
    def export_vocabularies(self, input_file: str = None) -> Dict[str, str]:
        """
        Main method to export vocabularies.
        Returns dictionary of category_name -> exported_file_path
        """
        if input_file is None:
            input_file = "data/categorized_words.json"
        
        logger.info("Starting vocabulary export...")
        
        # Load categorized words
        categorized_words, source_metadata = self.load_categorized_words(input_file)
        
        # Validate data
        self.validate_category_data(categorized_words)
        
        # Export category vocabularies
        exported_files, export_summary = self.export_category_vocabularies(categorized_words, source_metadata)
        
        # Create export metadata
        metadata_path = self.create_export_metadata(export_summary, source_metadata)
        
        # Run integrity checks
        self.run_integrity_checks(exported_files)
        
        logger.info("Vocabulary export completed successfully")
        return exported_files


def main():
    """Main execution function."""
    # Set up paths relative to script location
    script_dir = Path(__file__).parent.parent
    os.chdir(script_dir)
    
    # Input file (from word categorization stage)
    input_file = "data/categorized_words.json"
    
    if not os.path.exists(input_file):
        logger.error(f"Input categorized words file not found: {input_file}")
        logger.error("Please run word_categorizer.py first")
        sys.exit(1)
    
    try:
        # Initialize exporter
        exporter = VocabularyExporter()
        
        # Export vocabularies
        exported_files = exporter.export_vocabularies(input_file)
        
        # Print summary
        print(f"✅ Successfully exported vocabularies to {len(exported_files)} files")
        print(f"📁 Output directory: {exporter.paths_config['output_dir']}")
        for category, file_path in exported_files.items():
            print(f"📝 {category}: {os.path.basename(file_path)}")
        
    except Exception as e:
        logger.error(f"Vocabulary export failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()