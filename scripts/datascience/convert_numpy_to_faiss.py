#!/usr/bin/env python3
"""
Convert numpy vectors and vocabulary to FAISS index format
This script creates a binary format that can be easily loaded by the Node.js backend
"""

import numpy as np
import json
import struct
import os
from pathlib import Path

def filter_vocabulary(vocabulary, vectors):
    """Filter vocabulary to only include suitable words for themes game"""
    filtered_words = []
    filtered_indices = []
    
    for i, word in enumerate(vocabulary):
        if is_word_suitable_for_themes(word):
            filtered_words.append(word)
            filtered_indices.append(i)
    
    filtered_vectors = vectors[filtered_indices]
    return filtered_words, filtered_vectors

def is_word_suitable_for_themes(word):
    """Check if a word is suitable for themes game (basic filtering only)"""
    if not word or not isinstance(word, str):
        return False
    
    cleaned = word.lower().strip()
    
    # Length requirements
    if len(cleaned) < 3 or len(cleaned) > 15:
        return False
    
    # Only letters (no numbers, punctuation, or special characters)
    return cleaned.isalpha()
    

def save_binary_index(words, vectors, output_dir):
    """Save words and vectors in a simple binary format for Node.js"""
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Save vocabulary as JSON
    vocab_path = os.path.join(output_dir, 'themes_vocabulary.json')
    with open(vocab_path, 'w') as f:
        json.dump(words, f)
    
    # Save vectors in binary format
    # Format: [num_vectors (4 bytes)] [dimension (4 bytes)] [vector_data]
    vectors_path = os.path.join(output_dir, 'themes_vectors.bin')
    with open(vectors_path, 'wb') as f:
        # Write header with explicit little-endian format for cross-platform compatibility
        f.write(struct.pack('<I', len(vectors)))  # number of vectors (little-endian)
        f.write(struct.pack('<I', vectors.shape[1]))  # dimension (little-endian)
        
        # Write vector data as float32 in little-endian format
        vectors_float32 = vectors.astype(np.float32)
        # Ensure little-endian byte order for cross-platform reproducibility
        if vectors_float32.dtype.byteorder not in ('=', '<'):  # if not native little-endian or already little-endian
            vectors_float32 = vectors_float32.astype('<f4')  # force little-endian float32
        f.write(vectors_float32.tobytes())
    
    # Save metadata
    metadata = {
        'num_vectors': len(vectors),
        'dimension': int(vectors.shape[1]),
        'vector_dtype': 'float32',
        'format_version': '1.0',
        'created_by': 'convert_numpy_to_faiss.py'
    }
    
    metadata_path = os.path.join(output_dir, 'themes_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    return vocab_path, vectors_path, metadata_path

def main():
    script_dir = Path(__file__).parent
    
    # Input paths
    vocab_path = script_dir / 'word_vocab.json'
    vectors_path = script_dir / 'word_vectors.npy'
    
    # Output directory
    output_dir = script_dir / 'themes_index'
    
    print("Loading vocabulary and vectors...")
    
    # Load vocabulary
    if not vocab_path.exists():
        print(f"Error: Vocabulary file not found: {vocab_path}")
        return 1
    
    with open(vocab_path, 'r') as f:
        vocabulary = json.load(f)
    
    # Load vectors
    if not vectors_path.exists():
        print(f"Error: Vectors file not found: {vectors_path}")
        return 1
    
    vectors = np.load(vectors_path)
    
    # Validate loaded arrays
    if vectors is None or vectors.size == 0:
        print("Error: Loaded vectors array is empty or invalid")
        return 1
    
    if len(vectors.shape) != 2:
        print(f"Error: Expected 2D vectors array, got shape {vectors.shape}")
        return 1
    
    if not np.isfinite(vectors).all():
        print("Error: Vectors contain non-finite values (NaN or inf)")
        return 1
    
    if not isinstance(vocabulary, list) or len(vocabulary) == 0:
        print("Error: Vocabulary must be a non-empty list")
        return 1
    
    print(f"Loaded {len(vocabulary)} words with {vectors.shape[1]} dimensional vectors")
    
    # Verify vocabulary and vectors match
    if len(vocabulary) != vectors.shape[0]:
        print(f"Error: Vocabulary size ({len(vocabulary)}) doesn't match vectors ({vectors.shape[0]})")
        return 1
    
    # Filter vocabulary for themes game
    print("Filtering vocabulary for themes game...")
    filtered_words, filtered_vectors = filter_vocabulary(vocabulary, vectors)
    
    print(f"Filtered to {len(filtered_words)} suitable words ({len(filtered_words)/len(vocabulary)*100:.1f}%)")
    
    # Save in binary format
    print("Saving binary index...")
    vocab_file, vectors_file, metadata_file = save_binary_index(
        filtered_words, filtered_vectors, output_dir
    )
    
    print("Binary index created successfully:")
    print(f"  Vocabulary: {vocab_file}")
    print(f"  Vectors: {vectors_file}")
    print(f"  Metadata: {metadata_file}")
    print(f"  Total words: {len(filtered_words)}")
    print(f"  Vector dimension: {filtered_vectors.shape[1]}")
    
    return 0

if __name__ == '__main__':
    exit(main())