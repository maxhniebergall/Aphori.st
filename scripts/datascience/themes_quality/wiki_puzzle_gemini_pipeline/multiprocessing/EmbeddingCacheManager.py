#!/usr/bin/env python3
"""
EmbeddingCacheManager - Thread and process-safe embedding cache

This module provides a file-based embedding cache that can be safely accessed
by multiple processes and threads simultaneously. It handles reading, writing,
and persistence of embedding data with proper locking mechanisms.
"""

import csv
import json
import logging
import os
import time
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import fcntl
import tempfile
import shutil
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingCacheEntry:
    """Single entry in the embedding cache."""
    word: str
    embedding: List[float]
    timestamp: float
    theme: Optional[str] = None
    word_type: Optional[str] = None  # 'theme', 'selected_word', 'candidate'
    similarity_to_theme: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'word': self.word,
            'embedding': self.embedding,
            'timestamp': self.timestamp,
            'theme': self.theme,
            'word_type': self.word_type,
            'similarity_to_theme': self.similarity_to_theme
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EmbeddingCacheEntry':
        """Create from dictionary."""
        return cls(
            word=data['word'],
            embedding=data['embedding'],
            timestamp=data.get('timestamp', time.time()),
            theme=data.get('theme'),
            word_type=data.get('word_type'),
            similarity_to_theme=data.get('similarity_to_theme')
        )


class EmbeddingCacheManager:
    """
    Thread and process-safe embedding cache manager.
    
    This cache manager stores embeddings in CSV format for compatibility with
    the existing pipeline, while providing efficient in-memory access patterns
    and safe concurrent access from multiple processes.
    """
    
    def __init__(self, 
                 cache_file: str,
                 lock_timeout: float = 30.0,
                 sync_interval: int = 60,
                 backup_count: int = 3):
        """
        Initialize cache manager.
        
        Args:
            cache_file: Path to the CSV cache file
            lock_timeout: Maximum time to wait for file locks (seconds)
            sync_interval: How often to sync in-memory cache to disk (seconds)
            backup_count: Number of backup files to keep
        """
        self.cache_file = Path(cache_file)
        self.lock_file = Path(str(cache_file) + ".lock")
        self.lock_timeout = lock_timeout
        self.sync_interval = sync_interval
        self.backup_count = backup_count
        
        # In-memory cache for fast access
        self._cache: Dict[str, EmbeddingCacheEntry] = {}
        self._cache_lock = threading.RLock()
        self._dirty = False  # Track if cache needs syncing
        self._last_sync = time.time()
        
        # Statistics
        self.stats = {
            'hits': 0,
            'misses': 0,
            'writes': 0,
            'loads': 0,
            'syncs': 0,
            'lock_timeouts': 0,
            'errors': 0
        }
        
        # Create cache directory
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Load existing cache
        self._load_from_disk()
        
        logger.info(f"EmbeddingCacheManager initialized: {cache_file}")
        logger.info(f"Loaded {len(self._cache)} cached embeddings")
    
    def _normalize_key(self, word: str) -> str:
        """Normalize word for consistent cache keys."""
        return word.lower().strip()
    
    @contextmanager
    def _file_lock(self, mode: str = 'r'):
        """
        Context manager for file locking.
        
        Args:
            mode: File open mode ('r' for read, 'w' for write)
        """
        lock_acquired = False
        lock_fd = None
        file_fd = None
        
        try:
            # Create lock file if it doesn't exist
            self.lock_file.touch(exist_ok=True)
            
            # Open lock file
            lock_fd = open(self.lock_file, 'w')
            
            # Try to acquire lock with timeout
            start_time = time.time()
            while time.time() - start_time < self.lock_timeout:
                try:
                    fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    lock_acquired = True
                    break
                except OSError:
                    time.sleep(0.1)
            
            if not lock_acquired:
                self.stats['lock_timeouts'] += 1
                raise TimeoutError(f"Could not acquire file lock within {self.lock_timeout}s")
            
            # Open the actual cache file
            if mode == 'w' or not self.cache_file.exists():
                file_fd = open(self.cache_file, mode, newline='', encoding='utf-8')
            else:
                file_fd = open(self.cache_file, mode, encoding='utf-8')
            
            yield file_fd
            
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"File lock error: {e}")
            raise
        finally:
            # Clean up file handles
            if file_fd:
                file_fd.close()
            
            # Release lock
            if lock_acquired and lock_fd:
                fcntl.flock(lock_fd.fileno(), fcntl.LOCK_UN)
            
            if lock_fd:
                lock_fd.close()
    
    def _load_from_disk(self):
        """Load cache from disk file."""
        if not self.cache_file.exists():
            logger.info("No existing cache file found, starting with empty cache")
            return
        
        try:
            with self._file_lock('r') as f:
                reader = csv.DictReader(f)
                loaded_count = 0
                
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
                        entry = EmbeddingCacheEntry(
                            word=word,
                            embedding=embedding,
                            timestamp=float(row.get('timestamp', time.time())),
                            theme=row.get('theme'),
                            word_type=row.get('word_type'),
                            similarity_to_theme=float(row['similarity_to_theme']) if row.get('similarity_to_theme') else None
                        )
                        
                        # Store in cache with normalized key
                        cache_key = self._normalize_key(word)
                        self._cache[cache_key] = entry
                        loaded_count += 1
                        
                    except Exception as e:
                        logger.warning(f"Error loading cache entry for word '{row.get('word', 'unknown')}': {e}")
                        continue
                
                self.stats['loads'] += 1
                logger.info(f"Loaded {loaded_count} embeddings from cache file")
                
        except FileNotFoundError:
            logger.info("Cache file not found, starting with empty cache")
        except Exception as e:
            logger.error(f"Error loading cache from disk: {e}")
            self.stats['errors'] += 1
    
    def _save_to_disk(self, backup: bool = True):
        """Save cache to disk file with optional backup."""
        if not self._cache:
            logger.debug("Empty cache, skipping save")
            return
        
        try:
            # Create backup if requested
            if backup and self.cache_file.exists():
                self._create_backup()
            
            # Write to temporary file first, then move (atomic operation)
            temp_file = self.cache_file.with_suffix('.tmp')
            
            with self._file_lock('w') as f:
                # Determine embedding dimension from first entry
                first_entry = next(iter(self._cache.values()))
                embedding_dim = len(first_entry.embedding)
                
                # Create CSV header
                fieldnames = ['word', 'theme', 'word_type', 'similarity_to_theme', 'timestamp']
                fieldnames.extend([f'embedding_dim_{i+1}' for i in range(embedding_dim)])
                
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                
                # Write all cache entries
                for entry in self._cache.values():
                    row = {
                        'word': entry.word,
                        'theme': entry.theme or '',
                        'word_type': entry.word_type or '',
                        'similarity_to_theme': entry.similarity_to_theme or '',
                        'timestamp': entry.timestamp
                    }
                    
                    # Add embedding dimensions
                    for i, value in enumerate(entry.embedding):
                        row[f'embedding_dim_{i+1}'] = value
                    
                    writer.writerow(row)
            
            # Move temp file to actual cache file (atomic operation)
            shutil.move(str(temp_file), str(self.cache_file))
            
            self._dirty = False
            self._last_sync = time.time()
            self.stats['syncs'] += 1
            
            logger.debug(f"Saved {len(self._cache)} embeddings to cache file")
            
        except Exception as e:
            logger.error(f"Error saving cache to disk: {e}")
            self.stats['errors'] += 1
            # Clean up temp file if it exists
            temp_file = self.cache_file.with_suffix('.tmp')
            if temp_file.exists():
                temp_file.unlink()
    
    def _create_backup(self):
        """Create a backup of the current cache file."""
        try:
            timestamp = int(time.time())
            backup_file = self.cache_file.with_suffix(f'.backup.{timestamp}')
            shutil.copy2(self.cache_file, backup_file)
            
            # Clean up old backups
            self._cleanup_old_backups()
            
            logger.debug(f"Created cache backup: {backup_file}")
            
        except Exception as e:
            logger.warning(f"Error creating cache backup: {e}")
    
    def _cleanup_old_backups(self):
        """Remove old backup files, keeping only the most recent ones."""
        try:
            backup_pattern = f"{self.cache_file.name}.backup.*"
            backup_files = list(self.cache_file.parent.glob(backup_pattern))
            
            # Sort by modification time (newest first)
            backup_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            
            # Remove excess backups
            for old_backup in backup_files[self.backup_count:]:
                old_backup.unlink()
                logger.debug(f"Removed old backup: {old_backup}")
                
        except Exception as e:
            logger.warning(f"Error cleaning up old backups: {e}")
    
    def get(self, word: str) -> Optional[List[float]]:
        """
        Get embedding for a word from cache.
        
        Args:
            word: The word to look up
        
        Returns:
            Embedding vector if found, None otherwise
        """
        cache_key = self._normalize_key(word)
        
        with self._cache_lock:
            entry = self._cache.get(cache_key)
            if entry:
                self.stats['hits'] += 1
                logger.debug(f"Cache hit for: {word}")
                return entry.embedding
            else:
                self.stats['misses'] += 1
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
        
        entry = EmbeddingCacheEntry(
            word=word,
            embedding=embedding,
            timestamp=time.time(),
            theme=theme,
            word_type=word_type,
            similarity_to_theme=similarity_to_theme
        )
        
        with self._cache_lock:
            self._cache[cache_key] = entry
            self._dirty = True
            self.stats['writes'] += 1
            
            # Sync to disk periodically
            if (time.time() - self._last_sync) > self.sync_interval:
                self._save_to_disk()
        
        logger.debug(f"Cached embedding for: {word}")
    
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
        with self._cache_lock:
            for i, (word, embedding) in enumerate(embeddings):
                cache_key = self._normalize_key(word)
                
                word_type = word_types[i] if word_types and i < len(word_types) else None
                similarity = similarities[i] if similarities and i < len(similarities) else None
                
                entry = EmbeddingCacheEntry(
                    word=word,
                    embedding=embedding,
                    timestamp=time.time(),
                    theme=theme,
                    word_type=word_type,
                    similarity_to_theme=similarity
                )
                
                self._cache[cache_key] = entry
                self.stats['writes'] += 1
            
            self._dirty = True
            
            # Sync to disk if it's been a while
            if (time.time() - self._last_sync) > self.sync_interval:
                self._save_to_disk()
        
        logger.debug(f"Batch cached {len(embeddings)} embeddings")
    
    def contains(self, word: str) -> bool:
        """Check if word is in cache."""
        cache_key = self._normalize_key(word)
        with self._cache_lock:
            return cache_key in self._cache
    
    def get_batch(self, words: List[str]) -> List[Optional[List[float]]]:
        """
        Get embeddings for multiple words efficiently.
        
        Args:
            words: List of words to look up
        
        Returns:
            List of embeddings (None for cache misses)
        """
        results = []
        
        with self._cache_lock:
            for word in words:
                cache_key = self._normalize_key(word)
                entry = self._cache.get(cache_key)
                if entry:
                    results.append(entry.embedding)
                    self.stats['hits'] += 1
                else:
                    results.append(None)
                    self.stats['misses'] += 1
        
        hit_count = len([r for r in results if r is not None])
        logger.debug(f"Batch cache lookup: {hit_count}/{len(words)} hits")
        
        return results
    
    def sync(self):
        """Force sync of in-memory cache to disk."""
        if self._dirty:
            self._save_to_disk()
            logger.info("Cache synced to disk")
    
    def clear(self):
        """Clear all cached embeddings."""
        with self._cache_lock:
            self._cache.clear()
            self._dirty = True
        logger.info("Cache cleared")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        with self._cache_lock:
            total_requests = self.stats['hits'] + self.stats['misses']
            hit_rate = (self.stats['hits'] / total_requests) if total_requests > 0 else 0.0
            
            return {
                'cache_size': len(self._cache),
                'hit_rate': hit_rate,
                'total_requests': total_requests,
                'cache_file': str(self.cache_file),
                'dirty': self._dirty,
                'last_sync': self._last_sync,
                **self.stats
            }
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - sync cache to disk."""
        self.sync()