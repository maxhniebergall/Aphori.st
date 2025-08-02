#!/usr/bin/env python3
"""
Script to filter word_vocab.json to contain only individual words.
A word is considered valid if it:
1. Contains only alphabetic characters, numbers, hyphens, apostrophes, periods, or underscores
2. Is not just punctuation or special characters
3. Is not empty or just whitespace

This script will overwrite the original file with only valid words.
"""

import json
import re
import sys
from pathlib import Path

def is_valid_word(token):
    """
    Check if a token is a valid individual word.
    
    Args:
        token (str): The token to validate
        
    Returns:
        bool: True if token is a valid word, False otherwise
    """
    if not token or not token.strip():
        return False
    
    # Remove common word boundaries and check if remaining content is word-like
    clean_token = token.strip()
    
    # Allow tokens with letters, numbers, hyphens, apostrophes, periods, underscores
    # This covers most legitimate words including contractions, abbreviations, etc.
    word_pattern = re.compile(r'^[a-zA-Z0-9._\-\'\/]+$')
    
    # Must contain at least one letter or number
    has_alphanumeric = re.search(r'[a-zA-Z0-9]', clean_token)
    
    # Check if it matches word pattern and has alphanumeric content
    return bool(word_pattern.match(clean_token) and has_alphanumeric)

def filter_vocab_file(file_path):
    """
    Filter the vocabulary file to contain only valid words and overwrite the original.
    
    Args:
        file_path (str): Path to the word_vocab.json file
    """
    try:
        print(f"Loading vocabulary file: {file_path}")
        with open(file_path, 'r', encoding='utf-8') as f:
            vocab_data = json.load(f)
        
        if not isinstance(vocab_data, list):
            print(f"Error: Expected a list, got {type(vocab_data)}")
            return False
        
        print(f"Original tokens in vocabulary: {len(vocab_data)}")
        
        # Filter to keep only valid words and track invalid ones
        valid_words = []
        invalid_tokens = []
        
        for i, token in enumerate(vocab_data):
            if is_valid_word(token):
                valid_words.append(token)
            else:
                invalid_tokens.append({
                    "index": i,
                    "token": token
                })
        
        print(f"Valid words found: {len(valid_words)}")
        print(f"Invalid tokens removed: {len(invalid_tokens)}")
        print(f"Reduction: {len(invalid_tokens) / len(vocab_data) * 100:.2f}%")
        
        # Create backup of original file
        backup_path = file_path + '.backup'
        print(f"Creating backup at: {backup_path}")
        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(vocab_data, f)
        
        # Save list of filtered out tokens with their original indices
        filtered_out_path = file_path.replace('.json', '_filtered_out.json')
        print(f"Saving filtered out tokens to: {filtered_out_path}")
        with open(filtered_out_path, 'w', encoding='utf-8') as f:
            json.dump(invalid_tokens, f, indent=2)
        
        # Overwrite original file with filtered words
        print(f"Overwriting original file with {len(valid_words)} valid words...")
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(valid_words, f)
        
        print("✅ File successfully filtered and overwritten!")
        return True
        
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}")
        return False
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in file: {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    """Main function to filter the vocabulary file."""
    if len(sys.argv) > 1:
        vocab_file = sys.argv[1]
    else:
        # Default to the expected location
        vocab_file = "/Users/mh/workplace/Aphori.st/scripts/datascience/word_vocab.json"
    
    print(f"Filtering vocabulary file: {vocab_file}")
    print("=" * 60)
    
    success = filter_vocab_file(vocab_file)
    
    print("=" * 60)
    if success:
        print("✅ Vocabulary file successfully filtered!")
        sys.exit(0)
    else:
        print("❌ Failed to filter vocabulary file.")
        sys.exit(1)

if __name__ == "__main__":
    main()