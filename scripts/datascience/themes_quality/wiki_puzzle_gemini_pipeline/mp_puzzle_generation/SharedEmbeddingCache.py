#!/usr/bin/env python3
"""
SharedEmbeddingCache - Manager-based embedding cache for multiprocessing

This module provides an embedding cache using multiprocessing.Manager for
safe concurrent access across multiple processes, with periodic CSV backups.
"""

import csv
import json
import logging
import multiprocessing as mp
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingEntry:
    """Single entry in the embedding cache."""
    word: str
    embedding: List[float]
    timestamp: float
    theme: Optional[str] = None
    word_type: Optional[str] = None  # 'theme', 'selected_word', 'candidate'
    similarity_to_theme: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EmbeddingEntry':
        """Create from dictionary."""
        return cls(**data)


class SharedEmbeddingCache:
    """
    Shared embedding cache using multiprocessing.Manager for safe concurrent access.
    
    This cache provides:
    1. Thread-safe and process-safe access using Manager.dict()
    2. Periodic CSV backups for persistence
    3. Fast in-memory lookups without file locking
    4. Automatic cache loading from existing CSV files
    """
    
    def __init__(self, cache_file: str, backup_interval: int = 60):
        """
        Initialize shared embedding cache.
        
        Args:
            cache_file: Path to CSV file for persistence
            backup_interval: Seconds between CSV backups
        """
        self.cache_file = Path(cache_file)
        self.backup_interval = backup_interval
        
        # Create cache directory
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize multiprocessing manager and shared cache
        self.manager = mp.Manager()
        self.shared_cache: mp.managers.DictProxy = self.manager.dict()
        
        # Statistics
        self.stats = self.manager.dict({
            'hits': 0,
            'misses': 0,
            'writes': 0,
            'backups': 0,
            'last_backup': 0,
            'cache_size': 0
        })
        
        # Protect composite RMW operations on stats
        self.stats_lock = self.manager.Lock()
        
        # Load existing cache from CSV
        self._load_from_csv()
        
        logger.info(f"SharedEmbeddingCache initialized with {len(self.shared_cache)} entries")
    
    def _normalize_key(self, word: str) -> str:
        """Normalize word for consistent cache keys."""
        return word.lower().strip()
    
    def _load_from_csv(self):
        """Load existing cache entries from CSV file."""
        if not self.cache_file.exists():
            logger.info("No existing cache file found, starting with empty cache")
            return
        
        try:
            loaded_count = 0
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                
                for row in reader:
                    try:
                        word = row['word']
                        
                        # Extract embedding dimensions
                        embedding = []
                        for key, value in row.items():
                            if key.startswith('embedding_dim_'):
                                embedding.append(float(value))
                        
                        if not embedding:
                            logger.warning(f"No embedding found for word: {word}")
                            continue
                        
                        # Create cache entry
                        entry = EmbeddingEntry(
                            word=word,
                            embedding=embedding,
                            timestamp=float(row.get('timestamp', time.time())),
                            theme=row.get('theme') if row.get('theme') else None,
                            word_type=row.get('word_type') if row.get('word_type') else None,
                            similarity_to_theme=float(row['similarity_to_theme']) if row.get('similarity_to_theme') else None
                        )
                        
                        # Store in shared cache with normalized key
                        cache_key = self._normalize_key(word)
                        self.shared_cache[cache_key] = entry.to_dict()
                        loaded_count += 1
                        
                    except Exception as e:
                        logger.warning(f"Error loading cache entry for word '{row.get('word', 'unknown')}': {e}")
                        continue
            
            with self.stats_lock:
                self.stats['cache_size'] = loaded_count
            logger.info(f"Loaded {loaded_count} embeddings from cache file")
            
        except Exception as e:
            logger.error(f"Error loading cache from CSV: {e}")
    
    def backup_to_csv(self):
        """Save current cache contents to CSV file."""
        if len(self.shared_cache) == 0:
            logger.debug("Empty cache, skipping backup")
            return
        
        try:
            # Create a snapshot of the cache
            cache_snapshot = dict(self.shared_cache)
            
            if not cache_snapshot:
                return
            
            # Write to temporary file first, then move (atomic operation)
            temp_file = self.cache_file.with_suffix('.tmp')
            
            with open(temp_file, 'w', newline='', encoding='utf-8') as f:
                # Determine embedding dimension from first entry
                first_entry_dict = next(iter(cache_snapshot.values()))
                embedding_dim = len(first_entry_dict['embedding'])
                
                # Create CSV header
                fieldnames = ['word', 'theme', 'word_type', 'similarity_to_theme', 'timestamp']
                fieldnames.extend([f'embedding_dim_{i+1}' for i in range(embedding_dim)])
                
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                
                # Write all cache entries
                for entry_dict in cache_snapshot.values():
                    row = {
                        'word': entry_dict['word'],
                        'theme': entry_dict.get('theme') or '',
                        'word_type': entry_dict.get('word_type') or '',
                        'similarity_to_theme': entry_dict.get('similarity_to_theme') or '',
                        'timestamp': entry_dict['timestamp']
                    }
                    
                    # Add embedding dimensions
                    for i, value in enumerate(entry_dict['embedding']):
                        row[f'embedding_dim_{i+1}'] = value
                    
                    writer.writerow(row)
            
            # Move temp file to actual cache file (atomic operation)
            temp_file.replace(self.cache_file)
            
            # Update statistics (atomic section)
            with self.stats_lock:
                self.stats['backups'] = self.stats.get('backups', 0) + 1
                self.stats['last_backup'] = time.time()
            
            logger.debug(f"Backed up {len(cache_snapshot)} embeddings to CSV")
            
        except Exception as e:
            logger.error(f"Error backing up cache to CSV: {e}")
            # Clean up temp file if it exists
            temp_file = self.cache_file.with_suffix('.tmp')
            if temp_file.exists():
                temp_file.unlink()
    
    def get(self, word: str) -> Optional[List[float]]:
        """
        Get embedding for a word from cache.
        
        Args:
            word: The word to look up
        
        Returns:
            Embedding vector if found, None otherwise
        """
        cache_key = self._normalize_key(word)
        
        entry_dict = self.shared_cache.get(cache_key)
        if entry_dict:
            with self.stats_lock:
                self.stats['hits'] = self.stats.get('hits', 0) + 1
            logger.debug(f"Cache hit for: {word}")
            return entry_dict['embedding']
        else:
            with self.stats_lock:
                self.stats['misses'] = self.stats.get('misses', 0) + 1
            logger.debug(f"Cache miss for: {word}")
            return None
    
    def put(self, word: str, embedding: List[float], theme: Optional[str] = None,
            word_type: Optional[str] = None, similarity_to_theme: Optional[float] = None):
        """
        Store an embedding in the cache.
        
        Args:
            word: The word
            embedding: The embedding vector
            theme: Optional theme this word belongs to
            word_type: Optional type ('theme', 'selected_word', 'candidate')
            similarity_to_theme: Optional similarity score to theme
        """
        cache_key = self._normalize_key(word)
        
        entry = EmbeddingEntry(
            word=word,
            embedding=embedding,
            timestamp=time.time(),
            theme=theme,
            word_type=word_type,
            similarity_to_theme=similarity_to_theme
        )
        
        self.shared_cache[cache_key] = entry.to_dict()
        
        # Update statistics (atomic section)
        with self.stats_lock:
            self.stats['writes'] = self.stats.get('writes', 0) + 1
            self.stats['cache_size'] = len(self.shared_cache)
        
        logger.debug(f"Cached embedding for: {word}")
    
    def get_batch(self, words: List[str]) -> List[Optional[List[float]]]:
        """
        Get embeddings for multiple words efficiently.
        
        Args:
            words: List of words to look up
        
        Returns:
            List of embeddings (None for cache misses)
        """
        results = []
        hits = 0
        misses = 0
        
        for word in words:
            cache_key = self._normalize_key(word)
            entry_dict = self.shared_cache.get(cache_key)
            if entry_dict:
                results.append(entry_dict['embedding'])
                hits += 1
            else:
                results.append(None)
                misses += 1
        
        # Update statistics atomically
        with self.stats_lock:
            self.stats['hits'] = self.stats.get('hits', 0) + hits
            self.stats['misses'] = self.stats.get('misses', 0) + misses
        
        hit_count = len([r for r in results if r is not None])
        logger.debug(f"Batch cache lookup: {hit_count}/{len(words)} hits")
        
        return results
    
    def put_batch(self, embeddings: List[Tuple[str, List[float]]], theme: Optional[str] = None,
                  word_types: Optional[List[str]] = None, similarities: Optional[List[float]] = None):
        """
        Store multiple embeddings efficiently.
        
        Args:
            embeddings: List of (word, embedding) tuples
            theme: Optional theme for all words
            word_types: Optional list of word types (same length as embeddings)
            similarities: Optional list of similarity scores (same length as embeddings)
        """
        for i, (word, embedding) in enumerate(embeddings):
            cache_key = self._normalize_key(word)
            
            word_type = word_types[i] if word_types and i < len(word_types) else None
            similarity = similarities[i] if similarities and i < len(similarities) else None
            
            entry = EmbeddingEntry(
                word=word,
                embedding=embedding,
                timestamp=time.time(),
                theme=theme,
                word_type=word_type,
                similarity_to_theme=similarity
            )
            
            self.shared_cache[cache_key] = entry.to_dict()
        
        # Update statistics (atomic section)
        with self.stats_lock:
            self.stats['writes'] = self.stats.get('writes', 0) + len(embeddings)
            self.stats['cache_size'] = len(self.shared_cache)
        
        logger.debug(f"Batch cached {len(embeddings)} embeddings")
    
    def contains(self, word: str) -> bool:
        """Check if word is in cache."""
        cache_key = self._normalize_key(word)
        return cache_key in self.shared_cache
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        # Create a copy to avoid issues with shared dict
        stats = dict(self.stats)
        # Remove stale cache_size to prevent override of computed value
        stats.pop('cache_size', None)
        total_requests = stats.get('hits', 0) + stats.get('misses', 0)
        hit_rate = (stats.get('hits', 0) / total_requests) if total_requests > 0 else 0.0
        
        return {
            'cache_size': len(self.shared_cache),
            'hit_rate': hit_rate,
            'total_requests': total_requests,
            'cache_file': str(self.cache_file),
            **stats
        }
    
    def get_shared_data(self) -> Dict[str, Any]:
        """
        Get data needed by worker processes.
        
        Returns:
            Dictionary containing shared cache and stats references
        """
        return {
            'shared_cache': self.shared_cache,
            'stats': self.stats,
            'stats_lock': self.stats_lock
        }
    
    def clear(self):
        """Clear all cached embeddings."""
        self.shared_cache.clear()
        with self.stats_lock:
            self.stats['cache_size'] = 0
        logger.info("Cache cleared")


if __name__ == "__main__":
    # Test the shared cache
    logging.basicConfig(level=logging.INFO)
    
    cache = SharedEmbeddingCache("test_cache.csv")
    
    # Test basic operations
    cache.put("test", [1.0, 2.0, 3.0], theme="example", word_type="test")
    embedding = cache.get("test")
    print(f"Retrieved embedding: {embedding}")
    
    # Test batch operations
    batch_words = ["word1", "word2", "word3"]
    batch_embeddings = [([1.0, 0.0], [0.0, 1.0], [0.5, 0.5])]
    
    # Test backup
    cache.backup_to_csv()
    
    print(f"Cache stats: {cache.get_stats()}")