#!/usr/bin/env python3
"""
Python Vector Loader - Direct access to the same vector data used by puzzle generation

Loads the 856,670 word vectors from the binary files to enable real semantic similarity
calculations in our Python investigation code.
"""

import json
import numpy as np
import struct
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import time

class PythonVectorLoader:
    """Loads and provides access to word vectors from binary files"""
    
    def __init__(self, themes_index_dir: str = None):
        if themes_index_dir is None:
            # Default path relative to this script
            themes_index_dir = Path(__file__).parent.parent.parent.parent / "datascience" / "themes_index"
        
        self.themes_index_dir = Path(themes_index_dir)
        self.vectors = None
        self.vocabulary = []
        self.word_to_index = {}
        self.metadata = {}
        self.initialized = False
        
    def initialize(self) -> Dict:
        """Initialize the vector loader"""
        if self.initialized:
            return {
                'success': True,
                'message': 'Already initialized',
                'loadedWords': len(self.vocabulary),
                'totalWords': len(self.vocabulary),
                'dimension': self.metadata.get('dimension', 0)
            }
        
        print("🚀 Loading word vectors from themes index...")
        start_time = time.time()
        
        try:
            # Load metadata
            metadata_path = self.themes_index_dir / "themes_metadata.json"
            if not metadata_path.exists():
                return {'success': False, 'error': f'Metadata file not found: {metadata_path}'}
            
            with open(metadata_path, 'r') as f:
                self.metadata = json.load(f)
            
            print(f"📊 Loading {self.metadata['num_vectors']} vectors, dimension {self.metadata['dimension']}")
            
            # Load vocabulary
            vocab_path = self.themes_index_dir / "themes_vocabulary.json"
            if not vocab_path.exists():
                return {'success': False, 'error': f'Vocabulary file not found: {vocab_path}'}
            
            with open(vocab_path, 'r') as f:
                self.vocabulary = json.load(f)
            
            # Create word to index mapping
            self.word_to_index = {word.lower(): i for i, word in enumerate(self.vocabulary)}
            
            print(f"📝 Loaded vocabulary: {len(self.vocabulary)} words")
            
            # Load vectors from binary file
            vectors_path = self.themes_index_dir / "themes_vectors.bin"
            if not vectors_path.exists():
                return {'success': False, 'error': f'Vectors file not found: {vectors_path}'}
            
            # Read binary vector data
            with open(vectors_path, 'rb') as f:
                # Read header (num_vectors, dimension)
                header = f.read(8)  # 2 * 4 bytes
                num_vectors, dimension = struct.unpack('<II', header)
                
                print(f"📁 Binary file: {num_vectors} vectors, dimension {dimension}")
                
                # Verify consistency
                if num_vectors != len(self.vocabulary):
                    return {'success': False, 'error': f'Vector count mismatch: vocab={len(self.vocabulary)}, binary={num_vectors}'}
                
                # Read all vector data
                vector_data_size = num_vectors * dimension * 4  # 4 bytes per float32
                vector_bytes = f.read(vector_data_size)
                
                if len(vector_bytes) != vector_data_size:
                    return {'success': False, 'error': f'Incomplete vector data: expected {vector_data_size}, got {len(vector_bytes)}'}
                
                # Convert to numpy array and reshape
                vectors_flat = np.frombuffer(vector_bytes, dtype=np.float32)
                self.vectors = vectors_flat.reshape(num_vectors, dimension)
                
                print(f"🔢 Loaded vectors shape: {self.vectors.shape}")
            
            self.initialized = True
            load_time = time.time() - start_time
            
            print(f"✅ Vector loader initialized in {load_time:.2f}s: {len(self.vocabulary)} words")
            print(f"💾 Memory usage: ~{self.vectors.nbytes / 1024 / 1024:.0f}MB")
            
            return {
                'success': True,
                'loadedWords': len(self.vocabulary),
                'totalWords': len(self.vocabulary),
                'dimension': dimension,
                'loadTime': load_time
            }
            
        except Exception as e:
            print(f"❌ Failed to initialize vector loader: {e}")
            return {'success': False, 'error': str(e)}
    
    def cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors"""
        # Normalize vectors
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        # Calculate cosine similarity
        dot_product = np.dot(vec1, vec2)
        cosine_sim = dot_product / (norm1 * norm2)
        
        return float(np.clip(cosine_sim, -1.0, 1.0))
    
    def get_word_vector(self, word: str) -> Optional[np.ndarray]:
        """Get vector for a word"""
        if not self.initialized:
            raise RuntimeError("Vector loader not initialized")
        
        word_lower = word.lower()
        if word_lower not in self.word_to_index:
            return None
        
        index = self.word_to_index[word_lower]
        return self.vectors[index]
    
    def get_similarity(self, word1: str, word2: str) -> float:
        """Get cosine similarity between two words"""
        vec1 = self.get_word_vector(word1)
        vec2 = self.get_word_vector(word2)
        
        if vec1 is None or vec2 is None:
            return 0.0
        
        return self.cosine_similarity(vec1, vec2)
    
    def find_nearest_neighbors(self, word: str, k: int = 10) -> List[Tuple[str, float]]:
        """Find k nearest neighbors to a word"""
        if not self.initialized:
            raise RuntimeError("Vector loader not initialized")
        
        query_vec = self.get_word_vector(word)
        if query_vec is None:
            return []
        
        # Calculate similarities to all words
        similarities = []
        query_norm = np.linalg.norm(query_vec)
        
        if query_norm == 0:
            return []
        
        # Vectorized similarity calculation for efficiency
        # Normalize query vector
        query_normalized = query_vec / query_norm
        
        # Normalize all vectors
        vector_norms = np.linalg.norm(self.vectors, axis=1)
        valid_indices = vector_norms > 0
        
        # Calculate cosine similarities for valid vectors
        similarities = np.zeros(len(self.vocabulary))
        if np.any(valid_indices):
            normalized_vectors = self.vectors[valid_indices] / vector_norms[valid_indices, np.newaxis]
            dot_products = np.dot(normalized_vectors, query_normalized)
            similarities[valid_indices] = dot_products
        
        # Get top k similar words (excluding the word itself)
        word_lower = word.lower()
        results = []
        
        # Sort by similarity (descending)
        sorted_indices = np.argsort(similarities)[::-1]
        
        count = 0
        for idx in sorted_indices:
            if count >= k:
                break
                
            candidate_word = self.vocabulary[idx]
            if candidate_word.lower() != word_lower:
                results.append((candidate_word, float(similarities[idx])))
                count += 1
        
        return results
    
    def has_word(self, word: str) -> bool:
        """Check if word exists in vocabulary"""
        return word.lower() in self.word_to_index
    
    def get_stats(self) -> Dict:
        """Get statistics about loaded vectors"""
        return {
            'initialized': self.initialized,
            'total_words': len(self.vocabulary),
            'dimension': self.metadata.get('dimension', 0),
            'memory_usage_mb': self.vectors.nbytes / 1024 / 1024 if self.vectors is not None else 0,
        }

def test_python_vector_loader():
    """Test the Python vector loader"""
    print("🧪 Testing Python Vector Loader")
    print("=" * 50)
    
    try:
        # Initialize loader
        loader = PythonVectorLoader()
        result = loader.initialize()
        
        if not result['success']:
            print(f"❌ Initialization failed: {result['error']}")
            return False
        
        print(f"✅ Loaded {result['loadedWords']} words")
        
        # Test similarity calculations
        test_pairs = [
            ('cat', 'dog'),
            ('car', 'vehicle'),
            ('house', 'home'),
            ('run', 'walk'),
            ('computer', 'laptop'),
            ('red', 'blue')
        ]
        
        print("\n🔍 Testing similarity calculations:")
        for word1, word2 in test_pairs:
            similarity = loader.get_similarity(word1, word2)
            print(f"   {word1} ↔ {word2}: {similarity:.3f}")
        
        # Test neighbor finding
        print("\n🔍 Testing nearest neighbors:")
        test_words = ['computer', 'animal', 'color']
        
        for word in test_words:
            neighbors = loader.find_nearest_neighbors(word, 5)
            neighbor_str = ', '.join([f"{w}({s:.2f})" for w, s in neighbors])
            print(f"   {word} → [{neighbor_str}]")
        
        # Test performance
        print("\n⚡ Performance test:")
        start = time.time()
        for _ in range(100):
            loader.get_similarity('cat', 'dog')
        duration = time.time() - start
        print(f"   100 similarity calculations: {duration:.3f}s ({duration*10:.1f}ms per calculation)")
        
        print("\n✅ All tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_python_vector_loader()
    exit(0 if success else 1)