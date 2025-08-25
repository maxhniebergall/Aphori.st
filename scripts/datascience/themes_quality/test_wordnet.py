#!/usr/bin/env python3
"""
Test script to verify NLTK WordNet integration works correctly.
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from pipeline.word_categorizer import WordCategorizer

def test_wordnet():
    """Test WordNet dictionary functionality."""
    print("Testing WordNet dictionary functionality...")
    
    # Initialize categorizer
    categorizer = WordCategorizer()
    
    # Test common creature words
    test_words = [
        "dog", "cat", "bird", "fish", "elephant", "tiger",  # Should be in WordNet
        "ourselves", "himself", "after", "the", "and", "it"  # Should NOT be creature words
    ]
    
    print("\nTesting dictionary lookup:")
    for word in test_words:
        has_definition = categorizer.check_dictionary_definition(word)
        dict_score = categorizer.compute_dictionary_score(word)
        print(f"  {word:12} -> definition: {has_definition:5} | score: {dict_score}")
    
    # Test categorization of a few creature words
    print("\nTesting creature categorization:")
    creature_test_words = ["dog", "cat", "bird", "fish"]
    for word in creature_test_words:
        result = categorizer.categorize_word(word)
        creature_assigned = any(cat['category'] == 'creature' for cat in result['assigned_categories'])
        creature_score = result['category_scores'].get('creature', {})
        print(f"  {word:8} -> assigned to creature: {creature_assigned:5} | "
              f"combined: {creature_score.get('combined_score', 0):.3f} | "
              f"embedding: {creature_score.get('embedding_score', 0):.3f} | "
              f"dictionary: {creature_score.get('dictionary_score', 0):.3f}")

if __name__ == "__main__":
    test_wordnet()