#!/usr/bin/env python3
"""
Script to remove vectors corresponding to filtered-out vocabulary words.
This script reads the filtered_out.json file and removes the corresponding
vectors from the word_vectors.npy file, keeping only vectors for valid words.
"""

import json
import numpy as np
import sys
from pathlib import Path

def filter_vectors(vectors_file, filtered_out_file, output_file=None):
    """
    Remove vectors corresponding to filtered-out vocabulary indices.
    
    Args:
        vectors_file (str): Path to the word_vectors.npy file
        filtered_out_file (str): Path to the word_vocab_filtered_out.json file
        output_file (str, optional): Output file path. If None, overwrites original.
    """
    try:
        print(f"Loading vectors from: {vectors_file}")
        vectors = np.load(vectors_file)
        print(f"Original vectors shape: {vectors.shape}")
        
        print(f"Loading filtered-out indices from: {filtered_out_file}")
        with open(filtered_out_file, 'r', encoding='utf-8') as f:
            filtered_out_data = json.load(f)
        
        # Extract indices to remove
        indices_to_remove = [item['index'] for item in filtered_out_data]
        indices_to_remove = sorted(set(indices_to_remove))  # Remove duplicates and sort
        
        print(f"Found {len(indices_to_remove)} indices to remove")
        print(f"Index range: {min(indices_to_remove)} to {max(indices_to_remove)}")
        
        # Create boolean mask for indices to keep
        total_vectors = vectors.shape[0]
        keep_mask = np.ones(total_vectors, dtype=bool)
        keep_mask[indices_to_remove] = False
        
        # Filter vectors
        print("Filtering vectors...")
        filtered_vectors = vectors[keep_mask]
        
        print(f"Filtered vectors shape: {filtered_vectors.shape}")
        print(f"Removed {total_vectors - filtered_vectors.shape[0]} vectors")
        
        # Save filtered vectors
        if output_file is None:
            # Create backup of original
            backup_file = vectors_file + '.backup'
            print(f"Creating backup at: {backup_file}")
            np.save(backup_file, vectors)
            output_file = vectors_file
        
        print(f"Saving filtered vectors to: {output_file}")
        np.save(output_file, filtered_vectors)
        
        print("✅ Vector filtering completed successfully!")
        
        # Verification
        expected_size = total_vectors - len(indices_to_remove)
        if filtered_vectors.shape[0] == expected_size:
            print(f"✅ Verification passed: {filtered_vectors.shape[0]} == {expected_size}")
        else:
            print(f"❌ Verification failed: {filtered_vectors.shape[0]} != {expected_size}")
            return False
        
        return True
        
    except FileNotFoundError as e:
        print(f"Error: File not found: {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    """Main function to filter the vector file."""
    if len(sys.argv) >= 3:
        vectors_file = sys.argv[1]
        filtered_out_file = sys.argv[2]
        output_file = sys.argv[3] if len(sys.argv) > 3 else None
    else:
        # Default paths
        base_dir = "/Users/mh/workplace/Aphori.st"
        vectors_file = f"{base_dir}/word_vectors.npy"
        filtered_out_file = f"{base_dir}/scripts/datascience/word_vocab_filtered_out.json"
        output_file = None
    
    print(f"Filtering vectors based on vocabulary filtering results")
    print("=" * 60)
    print(f"Vectors file: {vectors_file}")
    print(f"Filtered-out file: {filtered_out_file}")
    print(f"Output file: {output_file if output_file else vectors_file + ' (overwrite)'}")
    print("=" * 60)
    
    success = filter_vectors(vectors_file, filtered_out_file, output_file)
    
    print("=" * 60)
    if success:
        print("✅ Vector filtering completed successfully!")
        sys.exit(0)
    else:
        print("❌ Vector filtering failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()