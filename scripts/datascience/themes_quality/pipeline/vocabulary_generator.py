#!/usr/bin/env python3
"""
Vocabulary Generator for NLP Pipeline

Generates vocabulary from NLTK words dataset, filtering to top N words by frequency
from unigram frequency data. This is the first stage of the NLP categorization pipeline.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import List, Dict, Set, Tuple
import yaml

import nltk
import pandas as pd
from nltk.corpus import words
from collections import Counter

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VocabularyGenerator:
    """Generates filtered vocabulary from NLTK words dataset."""
    
    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.vocab_config = self.config['vocabulary']
        self.output_config = self.config['output']
        
        # Ensure NLTK data is downloaded
        self._download_nltk_data()
        
        # Set up path to unigram frequency data
        self.unigram_freq_path = self.config.get('paths', {}).get('unigram_freq', 'data/unigram_freq.csv')
        
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
    
    def _download_nltk_data(self):
        """Download required NLTK datasets."""
        logger.info("Downloading NLTK data...")
        try:
            nltk.download('words', quiet=False)
        except Exception as e:
            logger.error(f"Failed to download NLTK data: {e}")
            sys.exit(1)
    
    def load_nltk_words(self) -> Set[str]:
        """Load words from NLTK words corpus."""
        logger.info("Loading NLTK words corpus...")
        try:
            word_list = set(words.words())
            if not word_list:
                logger.error("NLTK words corpus is empty")
                sys.exit(1)
            logger.info(f"Loaded {len(word_list)} words from NLTK corpus")
            return word_list
        except Exception as e:
            logger.error(f"Error loading NLTK words: {e}")
            sys.exit(1)
    
    def get_word_frequencies(self) -> Dict[str, int]:
        """Load word frequencies from unigram frequency CSV file."""
        logger.info(f"Loading word frequencies from {self.unigram_freq_path}...")
        try:
            # Load the CSV file
            if not os.path.exists(self.unigram_freq_path):
                logger.error(f"Unigram frequency file not found: {self.unigram_freq_path}")
                sys.exit(1)
                
            df = pd.read_csv(self.unigram_freq_path)
            
            # Validate CSV structure
            required_columns = ['word', 'count']
            if not all(col in df.columns for col in required_columns):
                logger.error(f"CSV file must contain columns: {required_columns}. Found: {list(df.columns)}")
                sys.exit(1)
            
            if df.empty:
                logger.error("Unigram frequency file is empty")
                sys.exit(1)
            
            # Convert to dictionary (lowercase words)
            word_freq = {}
            for _, row in df.iterrows():
                word = str(row['word']).lower().strip()
                count = int(row['count'])
                if word and count > 0:  # Skip empty words and zero counts
                    word_freq[word] = count
            
            logger.info(f"Loaded frequencies for {len(word_freq)} unique words")
            return word_freq
        
        except Exception as e:
            logger.error(f"Error loading frequencies from unigram frequency data: {e}")
            sys.exit(1)
    
    def filter_top_words(self, word_frequencies: Dict[str, int], n: int = None) -> List[str]:
        """Filter to top N words by frequency."""
        if n is None:
            n = self.vocab_config.get('frequency_threshold', 5000)
            
        logger.info(f"Filtering to top {n} words by frequency...")
        
        # Filter by length constraints
        min_length = self.vocab_config.get('min_word_length', 2)
        max_length = self.vocab_config.get('max_word_length', 15)
        
        # Only include words that exist in NLTK words corpus
        nltk_words = self.load_nltk_words()
        nltk_words_lower = {word.lower() for word in nltk_words}
        
        filtered_words = {
            word: freq for word, freq in word_frequencies.items()
            if (min_length <= len(word) <= max_length and 
                word in nltk_words_lower)
        }
        
        if not filtered_words:
            logger.error("No words found matching filter criteria")
            sys.exit(1)
        
        # Sort by frequency and take top N
        sorted_words = sorted(filtered_words.items(), key=lambda x: x[1], reverse=True)
        top_words = [word for word, freq in sorted_words[:n]]
        
        if len(top_words) < n:
            logger.warning(f"Only found {len(top_words)} words, requested {n}")
        
        logger.info(f"Selected {len(top_words)} words for categorization")
        return top_words
    
    def create_vocabulary_metadata(self, vocabulary: List[str], frequencies: Dict[str, int]) -> Dict:
        """Create metadata about the generated vocabulary."""
        vocab_frequencies = {word: frequencies.get(word, 0) for word in vocabulary}
        
        metadata = {
            'total_words': len(vocabulary),
            'min_frequency': min(vocab_frequencies.values()),
            'max_frequency': max(vocab_frequencies.values()),
            'avg_frequency': sum(vocab_frequencies.values()) / len(vocab_frequencies),
            'min_word_length': min(len(word) for word in vocabulary),
            'max_word_length': max(len(word) for word in vocabulary),
            'avg_word_length': sum(len(word) for word in vocabulary) / len(vocabulary),
            'generation_config': self.vocab_config,
            'source_corpus': 'nltk_words_with_unigram_frequencies'
        }
        
        return metadata
    
    def export_vocabulary(self, vocabulary: List[str], frequencies: Dict[str, int], output_path: str = None):
        """Export filtered vocabulary to JSON file."""
        if output_path is None:
            output_path = self.config['paths']['input_vocab']
        
        # Create output directory if it doesn't exist
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create output directory: {e}")
            sys.exit(1)
        
        # Prepare vocabulary data
        vocab_data = {
            'vocabulary': vocabulary,
            'frequencies': {word: frequencies.get(word, 0) for word in vocabulary},
            'metadata': self.create_vocabulary_metadata(vocabulary, frequencies)
        }
        
        # Export to JSON
        logger.info(f"Exporting vocabulary to {output_path}")
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(vocab_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to write vocabulary file: {e}")
            sys.exit(1)
        
        logger.info(f"Successfully exported {len(vocabulary)} words to {output_path}")
        return output_path
    
    def generate_vocabulary(self) -> Tuple[List[str], str]:
        """
        Main method to generate filtered vocabulary.
        Returns (vocabulary_list, output_file_path)
        """
        logger.info("Starting vocabulary generation...")
        
        # Load NLTK words
        nltk_words = self.load_nltk_words()
        
        # Get word frequencies
        frequencies = self.get_word_frequencies()
        
        # Filter to top words
        vocabulary = self.filter_top_words(frequencies)
        
        # Export vocabulary
        output_path = self.export_vocabulary(vocabulary, frequencies)
        
        logger.info("Vocabulary generation completed successfully")
        return vocabulary, output_path


def main():
    """Main execution function."""
    # Set up paths relative to script location
    script_dir = Path(__file__).parent.parent
    os.chdir(script_dir)
    
    try:
        # Initialize generator
        generator = VocabularyGenerator()
        
        # Generate vocabulary
        vocabulary, output_path = generator.generate_vocabulary()
        
        print(f"✅ Successfully generated vocabulary with {len(vocabulary)} words")
        print(f"📁 Output saved to: {output_path}")
        print(f"🔍 Preview: {vocabulary[:10]}...")
        
    except Exception as e:
        logger.error(f"Vocabulary generation failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()