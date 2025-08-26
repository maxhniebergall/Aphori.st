#!/usr/bin/env python3
"""
Test script for the improved multiprocessing implementation

This script tests the new ProcessPoolExecutor-based implementation
to verify it works correctly and doesn't have the issues of the old version.
"""

import json
import logging
import sys
import time
from pathlib import Path

# Add the pipeline directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from ImprovedGeminiTaskProcessor import create_improved_task_processor
from SharedEmbeddingCache import SharedEmbeddingCache
from SharedRateLimiter import SharedRateLimiter


def test_shared_cache():
    """Test the shared embedding cache functionality."""
    print("\n=== Testing SharedEmbeddingCache ===")
    
    cache_file = "test_cache.csv"
    cache = SharedEmbeddingCache(cache_file, backup_interval=10)
    
    # Test basic operations
    test_word = "test"
    test_embedding = [1.0, 2.0, 3.0, 4.0]
    
    print(f"Storing embedding for '{test_word}'")
    cache.put(test_word, test_embedding, theme="example", word_type="test")
    
    print(f"Retrieving embedding for '{test_word}'")
    retrieved = cache.get(test_word)
    
    if retrieved == test_embedding:
        print("✓ Cache store/retrieve works correctly")
    else:
        print("✗ Cache store/retrieve failed")
        print(f"  Expected: {test_embedding}")
        print(f"  Got: {retrieved}")
    
    # Test batch operations
    batch_words = ["word1", "word2", "word3"]
    batch_embeddings = [
        ("word1", [1.0, 0.0, 0.0]),
        ("word2", [0.0, 1.0, 0.0]), 
        ("word3", [0.0, 0.0, 1.0])
    ]
    
    print(f"Storing batch of {len(batch_embeddings)} embeddings")
    cache.put_batch(batch_embeddings, theme="batch_test")
    
    print(f"Retrieving batch of {len(batch_words)} embeddings")
    batch_results = cache.get_batch(batch_words)
    
    all_correct = True
    for i, (word, expected_embedding) in enumerate(batch_embeddings):
        if batch_results[i] != expected_embedding:
            all_correct = False
            break
    
    if all_correct:
        print("✓ Batch operations work correctly")
    else:
        print("✗ Batch operations failed")
    
    # Test CSV backup
    print("Testing CSV backup")
    cache.backup_to_csv()
    
    # Load cache again to test persistence
    cache2 = SharedEmbeddingCache(cache_file, backup_interval=10)
    retrieved2 = cache2.get(test_word)
    
    if retrieved2 == test_embedding:
        print("✓ CSV backup and restore works correctly")
    else:
        print("✗ CSV backup and restore failed")
    
    print(f"Cache stats: {cache.get_stats()}")
    
    # Clean up
    cache_path = Path(cache_file)
    if cache_path.exists():
        cache_path.unlink()


def test_shared_rate_limiter():
    """Test the shared rate limiter functionality."""
    print("\n=== Testing SharedRateLimiter ===")
    
    rate_limiter = SharedRateLimiter(
        requests_per_minute=120,  # 2 requests per second
        min_request_interval=0.5,  # 500ms minimum interval
        max_concurrent_requests=2
    )
    
    print("Testing rate limiting with 5 rapid requests")
    start_time = time.time()
    
    for i in range(5):
        request_start = time.time()
        with rate_limiter.acquire_request_slot():
            print(f"Request {i+1} executed at {time.time() - start_time:.2f}s")
            time.sleep(0.1)  # Simulate API call
        request_end = time.time()
        print(f"  Request {i+1} completed in {request_end - request_start:.2f}s")
    
    total_time = time.time() - start_time
    print(f"Total time for 5 requests: {total_time:.2f}s")
    
    if total_time >= 2.0:  # Should take at least 2 seconds due to rate limiting
        print("✓ Rate limiting is working correctly")
    else:
        print("✗ Rate limiting may not be working properly")
    
    print(f"Rate limiter stats: {rate_limiter.get_stats()}")


def test_improved_processor():
    """Test the improved task processor with a small dataset."""
    print("\n=== Testing ImprovedGeminiTaskProcessor ===")
    
    # Check if test data files exist
    themes_file = Path("../data/themes/selected_themes.json")
    candidates_file = Path("../data/candidates/candidate_words.json")
    
    if not themes_file.exists():
        print(f"✗ Test themes file not found: {themes_file}")
        print("Skipping processor test")
        return
    
    if not candidates_file.exists():
        print(f"✗ Test candidates file not found: {candidates_file}")
        print("Skipping processor test")
        return
    
    try:
        # Load small test dataset
        with open(themes_file) as f:
            themes_data = json.load(f)
            themes = themes_data['themes'][:2]  # Just 2 themes for testing
        
        with open(candidates_file) as f:
            candidates_data = json.load(f)
            candidates_dict = candidates_data['candidates']
        
        print(f"Testing with {len(themes)} themes")
        print(f"Themes: {themes}")
        
        # Create and run improved processor
        processor = create_improved_task_processor("../params.yaml")
        
        start_time = time.time()
        results, embeddings = processor.process_themes(themes, candidates_dict)
        processing_time = time.time() - start_time
        
        print(f"Processing completed in {processing_time:.2f}s")
        print(f"Generated {len(results.get('puzzles', {}))} puzzles")
        
        # Check results structure
        if 'puzzles' in results and 'metadata' in results:
            print("✓ Results have expected structure")
            
            metadata = results['metadata']
            if 'multiprocessing_stats' in metadata:
                stats = metadata['multiprocessing_stats']
                print(f"  Total tasks: {stats.get('total_tasks', 0)}")
                print(f"  Completed: {stats.get('completed_tasks', 0)}")
                print(f"  Failed: {stats.get('failed_tasks', 0)}")
                print(f"  Success rate: {stats.get('success_rate', 0):.1%}")
                print(f"  Tasks per second: {stats.get('tasks_per_second', 0):.2f}")
                
                if stats.get('completed_tasks', 0) > 0:
                    print("✓ Task processor works correctly")
                else:
                    print("✗ No tasks were completed successfully")
            else:
                print("✗ Missing multiprocessing stats in metadata")
        else:
            print("✗ Results missing expected keys")
            print(f"Result keys: {list(results.keys())}")
        
    except Exception as e:
        print(f"✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()


def main():
    """Run all tests."""
    print("=== Testing Improved Multiprocessing Implementation ===")
    
    # Set up logging
    logging.basicConfig(
        level=logging.WARNING,  # Reduce noise during testing
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Test individual components
    test_shared_cache()
    test_shared_rate_limiter()
    
    # Test the full processor (if test data is available)
    test_improved_processor()
    
    print("\n=== Test Summary ===")
    print("✓ = Test passed")
    print("✗ = Test failed")
    print("\nIf all tests pass, the improved multiprocessing implementation is ready to use!")


if __name__ == "__main__":
    main()