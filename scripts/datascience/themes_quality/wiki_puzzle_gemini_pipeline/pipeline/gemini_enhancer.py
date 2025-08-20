#!/usr/bin/env python3
"""
Gemini Enhancer for Enhanced Wiki Puzzle Pipeline

Uses Gemini embeddings to enhance word selection by:
1. Generating embeddings for theme + candidate words
2. Computing pairwise similarities using cosine distance 
3. Ranking and selecting final 4 words per theme
4. Outputting comprehensive CSV with all embeddings for analysis
"""

import csv
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import yaml
import numpy as np
from dataclasses import dataclass

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class EmbeddingResult:
    """Container for embedding results."""
    word: str
    embedding: List[float]
    similarity_to_theme: float = 0.0

class GeminiEmbeddingProvider:
    """Embedding provider using Gemini API with caching support."""
    
    def __init__(self, model_id: str, dimension: int, api_key: str, cache_file: str = None):
        """Initialize Gemini embedding provider."""
        self.model_id = model_id
        self.dimension = dimension
        self.api_key = api_key
        self.cache_file = cache_file
        self.embedding_cache = {}
        
        # Load existing cache if available
        if cache_file:
            self._load_cache()
        
        # Import and initialize Google GenAI
        try:
            from google import genai
            self.client = genai.Client(api_key=api_key)
            logger.info(f"Gemini client initialized with model: {model_id}, dimension: {dimension}")
            if cache_file:
                logger.info(f"Cache loaded: {len(self.embedding_cache)} existing embeddings")
        except ImportError:
            logger.error("google-genai library not found. Please install: pip install google-genai")
            sys.exit(1)
        except Exception as e:
            logger.error(f"Failed to initialize Gemini client: {e}")
            sys.exit(1)
    
    def _load_cache(self):
        """Load embeddings from cache file."""
        if not self.cache_file:
            return
        
        try:
            import pandas as pd
            cache_path = Path(self.cache_file)
            
            if cache_path.exists():
                df = pd.read_csv(cache_path)
                for _, row in df.iterrows():
                    word = row['word']
                    # Extract embedding from dimension columns
                    embedding_cols = [col for col in df.columns if col.startswith('embedding_dim_')]
                    if embedding_cols:
                        embedding = [float(row[col]) for col in embedding_cols]
                        self.embedding_cache[word] = embedding
                    else:
                        logger.warning(f"No embedding dimensions found in cache for word: {word}")
                logger.info(f"Loaded {len(self.embedding_cache)} cached embeddings")
            else:
                logger.info("No existing cache file found, starting with empty cache")
        except Exception as e:
            logger.warning(f"Failed to load cache: {e}")
            self.embedding_cache = {}
    
    def _save_to_cache(self, text: str, embedding: List[float]):
        """Save new embedding to cache."""
        if self.cache_file:
            self.embedding_cache[text] = embedding
    
    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding for text using Gemini API with caching and exponential backoff retry."""
        if not text or not text.strip():
            logger.warning("Empty text provided for embedding")
            return None
        
        # Check cache first
        if text in self.embedding_cache:
            logger.debug(f"Cache hit for: {text}")
            return self.embedding_cache[text]
        
        logger.debug(f"Cache miss, generating embedding for: {text}")
        max_retries = 5
        base_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                response = self.client.models.embed_content(
                    model=self.model_id,
                    contents=[text],
                    config={
                        "task_type": "SEMANTIC_SIMILARITY",
                        "output_dimensionality": self.dimension,
                    }
                )
                
                if response and response.embeddings and len(response.embeddings) > 0:
                    embedding_obj = response.embeddings[0]
                    if embedding_obj and hasattr(embedding_obj, 'values'):
                        values = embedding_obj.values
                        if len(values) != self.dimension:
                            logger.error(f"Embedding dimension mismatch: got {len(values)}, expected {self.dimension}")
                            sys.exit(1)
                        return values
                
                logger.error(f"Unexpected embedding response structure for text: {text[:50]}...")
                logger.error("API returned invalid response structure")
                sys.exit(1)
                
            except (ConnectionError, TimeoutError, OSError) as e:
                # Network-related errors - retry with exponential backoff
                delay = base_delay * (2 ** attempt)
                logger.warning(f"Network error on attempt {attempt + 1}/{max_retries} for '{text[:30]}...': {e}")
                
                if attempt == max_retries - 1:
                    logger.error(f"Max retries ({max_retries}) exceeded for network connectivity. Terminating process.")
                    sys.exit(1)
                
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)
                
            except Exception as e:
                # Non-network errors (auth, quota, etc.) - fail immediately
                logger.error(f"Gemini API failed for '{text[:30]}...': {e}")
                logger.error("API failure detected - terminating process")
                sys.exit(1)
        
        return None

class GeminiEnhancer:
    """Enhances word selection using Gemini embeddings."""
    
    def __init__(self, config_path: str = "params.yaml"):
        """Initialize with configuration."""
        self.config = self._load_config(config_path)
        self.puzzle_config = self.config['puzzle_generation']
        self.gemini_config = self.config['gemini']
        self.output_config = self.config['output']
        self.paths_config = self.config['paths']
        
        # Initialize Gemini embedding provider
        self.embedding_provider = self._initialize_gemini_provider()
        
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
    
    def _initialize_gemini_provider(self) -> GeminiEmbeddingProvider:
        """Initialize Gemini embedding provider."""
        api_key_env = self.gemini_config['api_key_env']
        api_key = os.getenv(api_key_env)
        
        if not api_key:
            logger.error(f"Environment variable {api_key_env} not set")
            sys.exit(1)
        
        # Get cache file path
        cache_file = self.output_config.get('embedding_cache_file', 'data/cache/all_embeddings.csv')
        
        # Try to restore cache from DVC if it exists
        self._try_restore_dvc_cache()
        
        provider = GeminiEmbeddingProvider(
            model_id=self.gemini_config['model_id'],
            dimension=self.gemini_config['embedding_dimension'],
            api_key=api_key,
            cache_file=cache_file
        )
        
        logger.info(f"Gemini API mode enabled - using model: {self.gemini_config['model_id']} with {self.gemini_config['embedding_dimension']} dimensions")
        
        return provider
    
    def _try_restore_dvc_cache(self):
        """Try to restore embeddings cache from DVC if available."""
        cache_file = self.output_config.get('embedding_cache_file', 'data/cache/all_embeddings.csv')
        cache_path = Path(cache_file)
        
        # If cache doesn't exist, try to restore from DVC cache
        if not cache_path.exists():
            try:
                import subprocess
                # Try to checkout just this file from DVC cache
                result = subprocess.run(['dvc', 'checkout', cache_file], 
                                      capture_output=True, text=True, cwd='.')
                if result.returncode == 0:
                    logger.info(f"Restored cache file from DVC: {cache_file}")
                else:
                    logger.info(f"No DVC cache available for {cache_file}, starting fresh")
            except Exception as e:
                logger.debug(f"Could not restore from DVC cache: {e}")
        else:
            logger.info(f"Cache file already exists: {cache_file}")
    
    def load_data(self) -> Tuple[List[str], Dict]:
        """Load themes and candidate words from previous pipeline stages."""
        # Load themes
        themes_path = Path(self.paths_config['themes']) / "selected_themes.json"
        if not themes_path.exists():
            logger.error(f"Selected themes file not found: {themes_path}")
            sys.exit(1)
        
        # Load candidates
        candidates_path = Path(self.paths_config['candidates']) / "candidate_words.json"
        if not candidates_path.exists():
            logger.error(f"Candidate words file not found: {candidates_path}")
            sys.exit(1)
        
        try:
            with open(themes_path, 'r') as f:
                themes_data = json.load(f)
            with open(candidates_path, 'r') as f:
                candidates_data = json.load(f)
            
            themes = themes_data['themes']
            candidates = candidates_data['candidates']
            
            logger.info(f"Loaded {len(themes)} themes and candidates for {len(candidates)} themes")
            return themes, candidates
            
        except Exception as e:
            logger.error(f"Error loading data: {e}")
            sys.exit(1)
    
    def cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        try:
            a_np = np.array(a)
            b_np = np.array(b)
            
            dot_product = np.dot(a_np, b_np)
            norm_a = np.linalg.norm(a_np)
            norm_b = np.linalg.norm(b_np)
            
            if norm_a == 0 or norm_b == 0:
                return 0.0
            
            return float(dot_product / (norm_a * norm_b))
        except Exception as e:
            logger.error(f"Error calculating cosine similarity: {e}")
            return 0.0
    
    def process_theme_with_gemini(self, theme: str, candidate_words: List[str]) -> Tuple[List[EmbeddingResult], Optional[List[float]]]:
        """Process a theme and its candidates with Gemini embeddings."""
        logger.info(f"Processing theme '{theme}' with {len(candidate_words)} candidates")
        
        # Generate embedding for theme
        theme_embedding = self.embedding_provider.generate_embedding(theme)
        if not theme_embedding:
            logger.error(f"Failed to generate embedding for theme: {theme}")
            return [], None
        
        # Generate embeddings for candidate words
        word_results = []
        
        for word in candidate_words:
            word_embedding = self.embedding_provider.generate_embedding(word)
            if word_embedding:
                # Calculate similarity to theme
                similarity = self.cosine_similarity(theme_embedding, word_embedding)
                word_results.append(EmbeddingResult(
                    word=word,
                    embedding=word_embedding,
                    similarity_to_theme=similarity
                ))
                logger.debug(f"  {word}: similarity = {similarity:.4f}")
            else:
                logger.warning(f"Failed to generate embedding for word: {word}")
        
        # Sort by similarity (highest first)
        word_results.sort(key=lambda x: x.similarity_to_theme, reverse=True)
        
        return word_results, theme_embedding
    
    def select_final_words(self, word_results: List[EmbeddingResult]) -> List[str]:
        """Select final words from ranked candidates."""
        words_per_theme = self.puzzle_config.get('words_per_theme', 4)  # Use new config
        
        # Take top N words per theme
        final_words = [result.word for result in word_results[:words_per_theme]]
        
        logger.debug(f"Selected final words: {final_words}")
        return final_words
    
    def process_all_themes(self, themes: List[str], candidates_dict: Dict) -> Tuple[Dict, List[Dict]]:
        """Process themes to create 4x4 puzzles with Gemini enhancement."""
        target_puzzle_count = self.puzzle_config['total_puzzle_count']
        themes_per_puzzle = self.puzzle_config.get('themes_per_puzzle', 4)
        themes_needed = target_puzzle_count * themes_per_puzzle
        
        # Extend themes by cycling if we don't have enough unique ones
        if len(themes) < themes_needed:
            logger.warning(f"Only {len(themes)} themes available, need {themes_needed}. Will reuse themes.")
            extended_themes = []
            for i in range(themes_needed):
                extended_themes.append(themes[i % len(themes)])
            themes_to_use = extended_themes
        else:
            themes_to_use = themes[:themes_needed]
        
        results = {
            "puzzles": {},
            "metadata": {
                "total_themes_needed": themes_needed,
                "total_themes_available": len(themes),
                "themes_reused": len(themes) < themes_needed,
                "successful_puzzles": 0,
                "failed_puzzles": [],
                "processing_time": 0,
                "gemini_config": {
                    "model_id": self.gemini_config['model_id'],
                    "embedding_dimension": self.gemini_config['embedding_dimension'],
                    "words_per_theme": self.puzzle_config.get('words_per_theme', 4),
                    "themes_per_puzzle": themes_per_puzzle
                }
            }
        }
        
        # For CSV output - collect all embeddings
        all_embeddings = []
        
        start_time = time.time()
        successful_puzzles = 0
        
        # Group themes into puzzles of 4 themes each
        for puzzle_id in range(1, target_puzzle_count + 1):
            start_idx = (puzzle_id - 1) * themes_per_puzzle
            puzzle_themes = themes_to_use[start_idx:start_idx + themes_per_puzzle]
            
            logger.info(f"Processing puzzle {puzzle_id}/{target_puzzle_count} with themes: {puzzle_themes}")
            
            try:
                puzzle_words = []
                puzzle_similarities = []
                puzzle_failed = False
                
                # Process each theme in this puzzle
                for theme in puzzle_themes:
                    if theme not in candidates_dict:
                        logger.error(f"No candidates found for theme: {theme}")
                        results["metadata"]["failed_puzzles"].append({
                            "puzzle_id": puzzle_id,
                            "themes": puzzle_themes,
                            "error": f"No candidates for theme: {theme}"
                        })
                        puzzle_failed = True
                        break
                    
                    candidate_words = candidates_dict[theme]['words']
                    
                    # Process with Gemini
                    word_results, theme_embedding = self.process_theme_with_gemini(theme, candidate_words)
                    
                    if not word_results or not theme_embedding:
                        logger.error(f"Failed to process theme with Gemini: {theme}")
                        results["metadata"]["failed_puzzles"].append({
                            "puzzle_id": puzzle_id,
                            "themes": puzzle_themes,
                            "error": f"Gemini processing failed for theme: {theme}"
                        })
                        puzzle_failed = True
                        break
                    
                    # Select final words for this theme
                    final_words = self.select_final_words(word_results)
                    
                    if len(final_words) != 4:
                        logger.error(f"Theme '{theme}' produced {len(final_words)} words, expected exactly 4")
                        results["metadata"]["failed_puzzles"].append({
                            "puzzle_id": puzzle_id,
                            "themes": puzzle_themes,
                            "error": f"Theme '{theme}' produced {len(final_words)} words, expected 4"
                        })
                        puzzle_failed = True
                        break
                    
                    puzzle_words.extend(final_words)
                    puzzle_similarities.extend([r.similarity_to_theme for r in word_results[:4]])
                    
                    # Add embeddings for tracking
                    theme_embedding_data = {
                        "theme": theme,
                        "word": theme,
                        "word_type": "theme",
                        "embedding": theme_embedding,
                        "similarity_to_theme": 1.0,
                        "rank": 0
                    }
                    all_embeddings.append({**theme_embedding_data, "dataset": "cache"})
                    
                    for rank, result in enumerate(word_results, 1):
                        all_embeddings.append({
                            "theme": theme,
                            "word": result.word,
                            "word_type": "candidate" if rank > 4 else "selected_word",
                            "embedding": result.embedding,
                            "similarity_to_theme": result.similarity_to_theme,
                            "rank": rank,
                            "dataset": "cache" if rank > 4 else "puzzle"
                        })
                
                if puzzle_failed:
                    continue
                
                # Validate we have exactly 16 words
                if len(puzzle_words) != 16:
                    logger.error(f"Puzzle {puzzle_id} has {len(puzzle_words)} words, expected exactly 16")
                    results["metadata"]["failed_puzzles"].append({
                        "puzzle_id": puzzle_id,
                        "themes": puzzle_themes,
                        "error": f"Generated {len(puzzle_words)} words instead of 16"
                    })
                    continue
                
                # Store successful puzzle
                puzzle_key = f"puzzle_{puzzle_id}"
                results["puzzles"][puzzle_key] = {
                    "words": puzzle_words,
                    "theme_similarity_scores": puzzle_similarities,
                    "themes": puzzle_themes,
                    "all_candidates": [],  # Not tracking individual candidates in this format
                    "all_similarities": puzzle_similarities
                }
                
                successful_puzzles += 1
                logger.info(f"  → Successfully created puzzle with 16 words from 4 themes")
                
            except Exception as e:
                error_msg = f"Error processing puzzle {puzzle_id}: {e}"
                results["metadata"]["failed_puzzles"].append({
                    "puzzle_id": puzzle_id,
                    "themes": puzzle_themes,
                    "error": error_msg
                })
                logger.error(f"  → {error_msg}")
        
        # Update metadata
        processing_time = time.time() - start_time
        results["metadata"]["successful_puzzles"] = successful_puzzles
        results["metadata"]["processing_time"] = processing_time
        
        logger.info(f"Gemini enhancement completed: {successful_puzzles}/{target_puzzle_count} puzzles successful")
        logger.info(f"Processing time: {processing_time:.2f} seconds")
        
        return results, all_embeddings
    
    def save_csv_embeddings(self, all_embeddings: List[Dict]):
        """Save embeddings to two separate CSV files."""
        if not all_embeddings:
            logger.warning("No embeddings to save to CSV")
            return
        
        # Separate cache and puzzle embeddings
        cache_embeddings = [item for item in all_embeddings if item.get('dataset') == 'cache']
        puzzle_embeddings = [item for item in all_embeddings if item.get('dataset') == 'puzzle']
        
        # Save cache embeddings (all generated embeddings)
        self._save_csv_file(
            cache_embeddings, 
            self.output_config['embedding_cache_file'],
            "cache embeddings"
        )
        
        # Save puzzle embeddings (final selected words only)
        self._save_csv_file(
            puzzle_embeddings,
            self.output_config['puzzle_embeddings_file'], 
            "puzzle embeddings"
        )
    
    def _save_csv_file(self, embeddings: List[Dict], file_path: str, description: str):
        """Save embeddings to a specific CSV file."""
        if not embeddings:
            logger.warning(f"No {description} to save")
            return
        
        csv_path = Path(file_path)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            embedding_dim = len(embeddings[0]['embedding'])
            precision = self.output_config.get('csv_precision', 6)
            
            # Create header
            header = ['theme', 'word', 'word_type', 'similarity_to_theme', 'rank']
            header.extend([f'embedding_dim_{i+1}' for i in range(embedding_dim)])
            
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(header)
                
                for item in embeddings:
                    row = [
                        item['theme'],
                        item['word'],
                        item['word_type'],
                        round(item['similarity_to_theme'], precision),
                        item['rank']
                    ]
                    # Add embedding dimensions with specified precision
                    row.extend([round(val, precision) for val in item['embedding']])
                    writer.writerow(row)
            
            logger.info(f"Saved {len(embeddings)} {description} to {csv_path}")
            logger.info(f"  → {embedding_dim}-dimensional embeddings with precision {precision}")
            
        except Exception as e:
            logger.error(f"Error saving {description}: {e}")
            sys.exit(1)
    
    def save_results(self, results: Dict, all_embeddings: List[Dict]):
        """Save all results to hierarchical output structure."""
        # Create output directories
        outputs_dir = Path(self.paths_config['outputs'])
        reports_dir = Path(self.paths_config['reports'])
        outputs_dir.mkdir(parents=True, exist_ok=True)
        reports_dir.mkdir(parents=True, exist_ok=True)
        
        # Save final puzzles
        puzzles_path = outputs_dir / "final_puzzles.json"
        with open(puzzles_path, 'w', encoding='utf-8') as f:
            json.dump(results["puzzles"], f, indent=2, ensure_ascii=False)
        
        # Save puzzle metadata
        metadata_path = outputs_dir / "puzzle_metadata.json"
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(results["metadata"], f, indent=2, ensure_ascii=False)
        
        # Save embedding analysis report
        embedding_analysis = {
            "pipeline_info": {
                "gemini_model": self.gemini_config['model_id'],
                "embedding_dimension": len(all_embeddings[0]['embedding']) if all_embeddings else 0,
                "total_embeddings": len(all_embeddings),
                "themes_processed": len(set(item['theme'] for item in all_embeddings)),
                "successful_puzzles": results["metadata"]["successful_puzzles"],
                "processing_time": results["metadata"]["processing_time"]
            },
            "similarity_stats": self._calculate_similarity_stats(all_embeddings),
            "embedding_quality": self._calculate_embedding_quality(all_embeddings),
            "performance_metrics": {
                "avg_time_per_puzzle": results["metadata"]["processing_time"] / max(1, results["metadata"]["successful_puzzles"]),
                "memory_estimate_mb": len(all_embeddings) * len(all_embeddings[0]['embedding']) * 8 / (1024*1024) if all_embeddings else 0
            }
        }
        
        analysis_path = reports_dir / "embedding_analysis.json"
        with open(analysis_path, 'w', encoding='utf-8') as f:
            json.dump(embedding_analysis, f, indent=2, ensure_ascii=False)
        
        # Save CSV embeddings
        self.save_csv_embeddings(all_embeddings)
        
        successful = results["metadata"]["successful_puzzles"]
        total_themes_needed = results["metadata"]["total_themes_needed"]
        logger.info(f"Saved results for {successful} successful puzzles (needed {total_themes_needed} total themes)")
        logger.info(f"Final puzzles: {puzzles_path}")
        logger.info(f"Cache embeddings: {self.output_config['embedding_cache_file']}")
        logger.info(f"Puzzle embeddings: {self.output_config['puzzle_embeddings_file']}")
    
    def _calculate_similarity_stats(self, all_embeddings: List[Dict]) -> Dict:
        """Calculate statistics for similarity scores."""
        candidates = [item for item in all_embeddings if item['word_type'] == 'candidate']
        if not candidates:
            return {}
        
        similarities = [item['similarity_to_theme'] for item in candidates]
        
        return {
            "min_similarity": min(similarities),
            "max_similarity": max(similarities),
            "mean_similarity": sum(similarities) / len(similarities),
            "std_similarity": self._calculate_std(similarities),
            "candidate_count": len(candidates)
        }
    
    def _calculate_embedding_quality(self, all_embeddings: List[Dict]) -> Dict:
        """Calculate quality metrics for embeddings."""
        if not all_embeddings:
            return {}
        
        # Calculate embedding statistics
        all_vectors = [item['embedding'] for item in all_embeddings]
        if not all_vectors:
            return {}
        
        # Calculate mean embedding dimension variance
        dim_variances = []
        embedding_dim = len(all_vectors[0])
        
        for dim_idx in range(embedding_dim):
            dim_values = [vec[dim_idx] for vec in all_vectors]
            variance = self._calculate_variance(dim_values)
            dim_variances.append(variance)
        
        return {
            "embedding_dimension": embedding_dim,
            "mean_dimension_variance": sum(dim_variances) / len(dim_variances),
            "min_dimension_variance": min(dim_variances),
            "max_dimension_variance": max(dim_variances),
            "total_vectors": len(all_vectors)
        }
    
    def _calculate_std(self, values: List[float]) -> float:
        """Calculate standard deviation."""
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
        return variance ** 0.5
    
    def _calculate_variance(self, values: List[float]) -> float:
        """Calculate variance."""
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        return sum((x - mean) ** 2 for x in values) / (len(values) - 1)

def main():
    """Main execution function."""
    logger.info("Starting Gemini enhancement for wiki puzzle pipeline")
    
    enhancer = GeminiEnhancer()
    
    # Load data from previous stages
    themes, candidates_dict = enhancer.load_data()
    
    # Process all themes with Gemini enhancement
    results, all_embeddings = enhancer.process_all_themes(themes, candidates_dict)
    
    # Save all results to hierarchical structure
    enhancer.save_results(results, all_embeddings)
    
    logger.info("Gemini enhancement completed successfully")

if __name__ == "__main__":
    main()