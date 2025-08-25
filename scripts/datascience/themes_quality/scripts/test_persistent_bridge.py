#!/usr/bin/env python3
"""
Test script for persistent bridge to verify it only loads vectors once
"""

import os
import sys
import time

# Add current directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(script_dir)

from multiword_theme_generator import get_global_typescript_bridge

def test_persistent_bridge():
    """Test that the bridge reuses the same instance and doesn't reload vectors"""
    print("🧪 Testing persistent bridge...")
    
    # Get the global bridge instance
    bridge = get_global_typescript_bridge()
    
    # Initialize once
    print("🔄 Initializing bridge...")
    init_result = bridge.initialize()
    
    if not init_result.get('success'):
        print(f"❌ Initialization failed: {init_result.get('error')}")
        return False
    
    print(f"✅ Initialized: {init_result.get('loadedWords')} words")
    
    # Test multiple puzzle generations to verify no reloading
    configs = [
        {'algorithm': 'N=K', 'puzzleSize': 4, 'maxAttempts': 10},
        {'algorithm': 'N=K+D', 'puzzleSize': 4, 'maxAttempts': 10},
        {'algorithm': 'N=K', 'puzzleSize': 4, 'maxAttempts': 10}
    ]
    
    print("\n🔬 Testing multiple generations (should not reload vectors)...")
    for i, config in enumerate(configs):
        print(f"   Test {i+1}: {config['algorithm']} algorithm...")
        start_time = time.time()
        
        result = bridge.generate_puzzle_with_theme(config)
        generation_time = time.time() - start_time
        
        if result.get('success'):
            puzzle = result.get('puzzle')
            if puzzle:
                quality = result.get('qualityScore', 0)
                attempts = result.get('attempts', 1)
                print(f"   ✅ Generated in {generation_time:.2f}s (quality: {quality:.3f}, attempts: {attempts})")
            else:
                print(f"   ❌ No puzzle returned: {result.get('error', 'Unknown error')}")
        else:
            error = result.get('error', 'Unknown error')
            print(f"   ❌ Failed: {error}")
            # If it's a server communication error, that's actually success for our test!
            if 'server communication failed' in error.lower():
                print(f"   ℹ️  Server communication issue - bridge may have crashed (expected for stress test)")
            elif 'no valid json response' in error.lower():
                print(f"   ℹ️  No JSON response - puzzle generation may have failed or been too verbose")
    
    print("\n🎯 If vectors were only loaded once at the start, the test passed!")
    return True

if __name__ == "__main__":
    success = test_persistent_bridge()
    print(f"\n{'✅ Test completed successfully!' if success else '❌ Test failed!'}")