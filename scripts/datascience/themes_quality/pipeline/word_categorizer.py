#!/usr/bin/env python3
"""
Word Categorizer for NLP Pipeline

Categorizes words using spaCy embeddings and dictionary cross-reference.
This is the second stage of the NLP categorization pipeline.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import List, Dict, Set, Tuple, Optional
from multiprocessing import Pool
from functools import partial
import yaml
import numpy as np

import spacy
from spacy.tokens import Doc

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables for multiprocessing worker initialization
_global_nlp = None
_global_categories_config = None
_global_scoring_config = None
_global_category_embeddings = None
_global_dvc_params = None

def _init_worker(model_name: str, categories_config: Dict, scoring_config: Dict, dvc_params: Dict = None):
    """Initialize spaCy model and configuration in worker process."""
    global _global_nlp, _global_categories_config, _global_scoring_config, _global_category_embeddings, _global_dvc_params
    
    # Load spaCy model in each worker
    _global_nlp = spacy.load(model_name)
    _global_categories_config = categories_config
    _global_scoring_config = scoring_config
    _global_dvc_params = dvc_params
    
    # Compute category embeddings in each worker
    _global_category_embeddings = {}
    aggregation_method = scoring_config['embeddings']['prototype_aggregation']
    
    for category_name, category_config in categories_config.items():
        prototype_words = category_config['prototype_words']
        embeddings = []
        
        for word in prototype_words:
            doc = _global_nlp(word)
            if doc.has_vector:
                embeddings.append(doc.vector)
        
        if embeddings:
            embeddings_array = np.array(embeddings)
            if aggregation_method == "mean":
                _global_category_embeddings[category_name] = np.mean(embeddings_array, axis=0)

def _process_word_batch(word_batch: List[str]) -> List[Dict]:
    """Process a batch of words in a worker process."""
    global _global_nlp, _global_categories_config, _global_scoring_config, _global_category_embeddings
    
    results = []
    for word in word_batch:
        try:
            word_result = _categorize_single_word(word)
            results.append(word_result)
        except Exception as e:
            logger.error(f"Error processing word '{word}': {e}")
            continue
    return results

def _categorize_single_word(word: str) -> Dict:
    """Categorize a single word using global variables."""
    global _global_nlp, _global_categories_config, _global_scoring_config, _global_category_embeddings
    
    word_results = {
        'word': word,
        'category_scores': {},
        'assigned_categories': [],
        'top_category': None,
        'max_score': 0.0
    }
    
    # Get word embedding
    doc = _global_nlp(word)
    word_embedding = doc.vector if doc.has_vector else None
    
    # Check dictionary definition
    token = doc[0]
    has_definition = (
        token.is_alpha and 
        not token.is_stop and 
        not token.is_space and 
        not token.is_punct and
        len(word) >= 2  # min_word_length
    )
    dictionary_score = 1.0 if has_definition else 0.0
    
    # Compute scores for each category
    for category_name, category_config in _global_categories_config.items():
        # Compute embedding similarity
        embedding_score = 0.0
        if word_embedding is not None and category_name in _global_category_embeddings:
            category_embedding = _global_category_embeddings[category_name]
            norm_word = np.linalg.norm(word_embedding)
            norm_category = np.linalg.norm(category_embedding)
            
            if norm_word > 0 and norm_category > 0:
                embedding_score = np.dot(word_embedding, category_embedding) / (norm_word * norm_category)
                embedding_score = float(embedding_score)
        
        # Combine scores
        embedding_weight = _global_scoring_config['embeddings']['weight']
        dictionary_weight = _global_scoring_config['dictionary']['weight']
        combined_score = embedding_score * embedding_weight + dictionary_score * dictionary_weight
        
        scores = {
            'combined_score': combined_score,
            'embedding_score': embedding_score,
            'dictionary_score': dictionary_score
        }
        
        word_results['category_scores'][category_name] = scores
        
        # Check if word meets thresholds for this category
        confidence_threshold = category_config['confidence_threshold']
        
        # Check embedding threshold if available from DVC params
        embedding_threshold = 0.0  # Default
        if _global_dvc_params and 'categories' in _global_dvc_params:
            embedding_thresholds = _global_dvc_params['categories'].get('embedding_thresholds', {})
            embedding_threshold = embedding_thresholds.get(category_name, 0.0)
        
        meets_combined_threshold = combined_score >= confidence_threshold
        meets_embedding_threshold = embedding_score >= embedding_threshold
        
        if meets_combined_threshold and meets_embedding_threshold:
            word_results['assigned_categories'].append({
                'category': category_name,
                'confidence': combined_score
            })
        
        # Track highest scoring category
        if combined_score > word_results['max_score']:
            word_results['max_score'] = combined_score
            word_results['top_category'] = category_name
    
    # Sort assigned categories by confidence
    word_results['assigned_categories'].sort(key=lambda x: x['confidence'], reverse=True)
    
    # Limit to max categories per word
    max_categories = _global_scoring_config['max_categories_per_word']
    word_results['assigned_categories'] = word_results['assigned_categories'][:max_categories]
    
    return word_results

class WordCategorizer:
    """Categorizes words using spaCy embeddings and dictionary cross-reference."""
    
    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.categories_config = self.config['categories']
        self.scoring_config = self.config['scoring']
        self.processing_config = self.config['processing']
        
        # Load DVC params for threshold overrides
        self.dvc_params = self._load_dvc_params()
        
        # Override confidence thresholds from DVC params if available
        if self.dvc_params and 'categories' in self.dvc_params:
            dvc_confidence_thresholds = self.dvc_params['categories'].get('confidence_thresholds', {})
            for category_name, threshold in dvc_confidence_thresholds.items():
                if category_name in self.categories_config:
                    self.categories_config[category_name]['confidence_threshold'] = threshold
        
        # Override processing config from DVC params if available  
        if self.dvc_params and 'processing' in self.dvc_params:
            self.processing_config.update(self.dvc_params['processing'])
        
        # Override scoring config from DVC params if available
        if self.dvc_params and 'scoring' in self.dvc_params:
            self.scoring_config.update(self.dvc_params['scoring'])
        
        # Load spaCy model
        self.nlp = self._load_spacy_model()
        
        # Precompute category prototype embeddings
        self.category_embeddings = self._compute_category_embeddings()
        
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
    
    def _load_dvc_params(self) -> Dict:
        """Load DVC parameters for threshold overrides."""
        try:
            with open("params.yaml", 'r') as f:
                return yaml.safe_load(f)
        except FileNotFoundError:
            logger.warning("DVC params.yaml not found, using default thresholds")
            return {}
        except yaml.YAMLError as e:
            logger.warning(f"Error parsing params.yaml: {e}, using default thresholds")
            return {}
    
    def _load_spacy_model(self):
        """Load spaCy model with embeddings."""
        model_name = self.scoring_config['embeddings']['model']
        logger.info(f"Loading spaCy model: {model_name}")
        
        try:
            nlp = spacy.load(model_name)
            
            # Verify model has word vectors
            if not nlp.vocab.vectors.size:
                logger.error(f"spaCy model {model_name} does not have word vectors")
                sys.exit(1)
                
            logger.info(f"Successfully loaded {model_name} with {nlp.vocab.vectors.size} vectors")
            return nlp
            
        except IOError:
            logger.error(f"spaCy model {model_name} not found. Please install with: python -m spacy download {model_name}")
            sys.exit(1)
        except Exception as e:
            logger.error(f"Error loading spaCy model: {e}")
            sys.exit(1)
    
    def _compute_category_embeddings(self) -> Dict[str, np.ndarray]:
        """Precompute averaged embeddings for each category based on prototype words."""
        logger.info("Computing category prototype embeddings...")
        
        category_embeddings = {}
        aggregation_method = self.scoring_config['embeddings']['prototype_aggregation']
        
        for category_name, category_config in self.categories_config.items():
            prototype_words = category_config['prototype_words']
            
            # Get embeddings for prototype words
            embeddings = []
            valid_words = []
            
            for word in prototype_words:
                doc = self.nlp(word)
                if doc.has_vector:
                    embeddings.append(doc.vector)
                    valid_words.append(word)
                else:
                    logger.warning(f"No vector found for prototype word '{word}' in category '{category_name}'")
            
            if not embeddings:
                logger.error(f"No valid prototype embeddings found for category '{category_name}'")
                sys.exit(1)
            
            # Aggregate embeddings
            embeddings_array = np.array(embeddings)
            if aggregation_method == "mean":
                category_embedding = np.mean(embeddings_array, axis=0)
            else:
                logger.error(f"Unknown aggregation method: {aggregation_method}")
                sys.exit(1)
            
            category_embeddings[category_name] = category_embedding
            logger.info(f"Category '{category_name}': {len(valid_words)}/{len(prototype_words)} prototype words have embeddings")
        
        return category_embeddings
    
    def get_word_embedding(self, word: str) -> Optional[np.ndarray]:
        """Get embedding for a single word."""
        doc = self.nlp(word)
        if doc.has_vector:
            return doc.vector
        return None
    
    def compute_embedding_similarity(self, word: str, category_name: str) -> float:
        """Compute similarity between word and category prototype embeddings."""
        word_embedding = self.get_word_embedding(word)
        if word_embedding is None:
            return 0.0
        
        category_embedding = self.category_embeddings[category_name]
        
        # Compute cosine similarity
        similarity_method = self.scoring_config['embeddings']['similarity_method']
        if similarity_method == "cosine":
            norm_word = np.linalg.norm(word_embedding)
            norm_category = np.linalg.norm(category_embedding)
            
            if norm_word == 0 or norm_category == 0:
                return 0.0
                
            similarity = np.dot(word_embedding, category_embedding) / (norm_word * norm_category)
            return float(similarity)
        else:
            logger.error(f"Unknown similarity method: {similarity_method}")
            sys.exit(1)
    
    def check_dictionary_definition(self, word: str) -> bool:
        """
        Check if word has a valid dictionary definition.
        Uses spaCy's lexical attributes as a proxy for dictionary validity.
        """
        doc = self.nlp(word)
        token = doc[0]
        
        # Word should be in vocabulary and not be a stop word, space, or punctuation
        has_definition = (
            token.is_alpha and 
            not token.is_stop and 
            not token.is_space and 
            not token.is_punct and
            len(word) >= self.config['vocabulary']['min_word_length']
        )
        
        return has_definition
    
    def compute_dictionary_score(self, word: str) -> float:
        """Compute dictionary-based score for the word."""
        if not self.scoring_config['dictionary']['require_definition']:
            return 1.0
            
        if self.check_dictionary_definition(word):
            return 1.0
        else:
            return 0.0
    
    def compute_category_score(self, word: str, category_name: str) -> Dict[str, float]:
        """Compute combined score for word-category pair."""
        # Get individual scores
        embedding_score = self.compute_embedding_similarity(word, category_name)
        dictionary_score = self.compute_dictionary_score(word)
        
        # Combine scores using weights
        embedding_weight = self.scoring_config['embeddings']['weight']
        dictionary_weight = self.scoring_config['dictionary']['weight']
        
        combined_score = (
            embedding_score * embedding_weight + 
            dictionary_score * dictionary_weight
        )
        
        return {
            'combined_score': combined_score,
            'embedding_score': embedding_score,
            'dictionary_score': dictionary_score
        }
    
    def categorize_word(self, word: str) -> Dict[str, any]:
        """Categorize a single word across all categories."""
        word_results = {
            'word': word,
            'category_scores': {},
            'assigned_categories': [],
            'top_category': None,
            'max_score': 0.0
        }
        
        # Compute scores for each category
        for category_name, category_config in self.categories_config.items():
            scores = self.compute_category_score(word, category_name)
            confidence_threshold = category_config['confidence_threshold']
            
            word_results['category_scores'][category_name] = scores
            
            # Check if word meets thresholds for this category
            # Get embedding threshold from DVC params if available
            embedding_threshold = 0.0  # Default
            if self.dvc_params and 'categories' in self.dvc_params:
                embedding_thresholds = self.dvc_params['categories'].get('embedding_thresholds', {})
                embedding_threshold = embedding_thresholds.get(category_name, 0.0)
            
            meets_combined_threshold = scores['combined_score'] >= confidence_threshold
            meets_embedding_threshold = scores['embedding_score'] >= embedding_threshold
            
            if meets_combined_threshold and meets_embedding_threshold:
                word_results['assigned_categories'].append({
                    'category': category_name,
                    'confidence': scores['combined_score']
                })
            
            # Track highest scoring category
            if scores['combined_score'] > word_results['max_score']:
                word_results['max_score'] = scores['combined_score']
                word_results['top_category'] = category_name
        
        # Sort assigned categories by confidence
        word_results['assigned_categories'].sort(key=lambda x: x['confidence'], reverse=True)
        
        # Limit to max categories per word
        max_categories = self.scoring_config['max_categories_per_word']
        word_results['assigned_categories'] = word_results['assigned_categories'][:max_categories]
        
        return word_results
    
    def categorize_words_batch(self, words: List[str]) -> List[Dict]:
        """Categorize a batch of words."""
        results = []
        for word in words:
            try:
                result = self.categorize_word(word)
                results.append(result)
            except Exception as e:
                logger.error(f"Error categorizing word '{word}': {e}")
                continue
        return results
    
    def categorize_vocabulary(self, vocabulary_file: str) -> Dict[str, List[Dict]]:
        """Categorize entire vocabulary using parallel processing."""
        logger.info(f"Loading vocabulary from {vocabulary_file}")
        
        # Load vocabulary
        try:
            with open(vocabulary_file, 'r') as f:
                vocab_data = json.load(f)
            vocabulary = vocab_data['vocabulary']
        except Exception as e:
            logger.error(f"Error loading vocabulary file: {e}")
            sys.exit(1)
        
        logger.info(f"Categorizing {len(vocabulary)} words...")
        
        # Split vocabulary into batches for parallel processing
        num_workers = self.processing_config['parallel_workers']
        batch_size = len(vocabulary) // num_workers + 1
        
        word_batches = [
            vocabulary[i:i + batch_size] 
            for i in range(0, len(vocabulary), batch_size)
        ]
        
        # Process batches in parallel
        logger.info(f"Processing with {num_workers} workers...")
        all_results = []
        
        # Use actual multiprocessing for parallel execution
        model_name = self.scoring_config['embeddings']['model']
        
        with Pool(processes=num_workers, 
                 initializer=_init_worker, 
                 initargs=(model_name, self.categories_config, self.scoring_config, self.dvc_params)) as pool:
            batch_results_list = pool.map(_process_word_batch, word_batches)
            
        # Flatten results from all batches
        for batch_results in batch_results_list:
            all_results.extend(batch_results)
        
        # Organize results by category
        categorized_words = {category_name: [] for category_name in self.categories_config.keys()}
        
        for word_result in all_results:
            for assignment in word_result['assigned_categories']:
                category_name = assignment['category']
                
                categorized_words[category_name].append({
                    'word': word_result['word'],
                    'confidence_score': assignment['confidence'],
                    'embedding_score': word_result['category_scores'][category_name]['embedding_score'],
                    'dictionary_score': word_result['category_scores'][category_name]['dictionary_score'],
                    'alternative_categories': [
                        cat['category'] for cat in word_result['assigned_categories'] 
                        if cat['category'] != category_name
                    ]
                })
        
        # Sort words within each category by confidence
        for category_name in categorized_words:
            categorized_words[category_name].sort(
                key=lambda x: x['confidence_score'], 
                reverse=True
            )
        
        logger.info("Word categorization completed")
        return categorized_words
    
    def export_categorized_words(self, categorized_words: Dict[str, List[Dict]], output_path: str = None):
        """Export categorized words to JSON file."""
        if output_path is None:
            output_path = "data/categorized_words.json"
        
        # Create output directory
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create output directory: {e}")
            sys.exit(1)
        
        # Add metadata
        export_data = {
            'categorized_words': categorized_words,
            'metadata': {
                'total_categories': len(categorized_words),
                'category_word_counts': {
                    cat: len(words) for cat, words in categorized_words.items()
                },
                'configuration': self.config,
                'spacy_model': self.scoring_config['embeddings']['model']
            }
        }
        
        # Export to JSON
        logger.info(f"Exporting categorized words to {output_path}")
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to write categorized words file: {e}")
            sys.exit(1)
        
        logger.info(f"Successfully exported categorized words to {output_path}")
        return output_path


def main():
    """Main execution function."""
    # Set up paths relative to script location
    script_dir = Path(__file__).parent.parent
    os.chdir(script_dir)
    
    # Input file (from vocabulary generation stage)
    input_file = "data/filtered_vocabulary.json"
    
    if not os.path.exists(input_file):
        logger.error(f"Input vocabulary file not found: {input_file}")
        logger.error("Please run vocabulary_generator.py first")
        sys.exit(1)
    
    try:
        # Initialize categorizer
        categorizer = WordCategorizer()
        
        # Categorize vocabulary
        categorized_words = categorizer.categorize_vocabulary(input_file)
        
        # Export results
        output_path = categorizer.export_categorized_words(categorized_words)
        
        # Print summary
        print(f"✅ Successfully categorized vocabulary")
        print(f"📁 Output saved to: {output_path}")
        for category, words in categorized_words.items():
            print(f"📊 {category}: {len(words)} words")
        
    except Exception as e:
        logger.error(f"Word categorization failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()