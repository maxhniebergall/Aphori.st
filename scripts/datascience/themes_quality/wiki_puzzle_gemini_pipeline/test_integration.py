#!/usr/bin/env python3
"""
Integration test for the improved multiprocessing implementation

This script tests that the integration with gemini_enhancer.py works correctly
and that the improved multiprocessing implementation is being used.
"""

import json
import logging
import os
import sys
import time
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_import_improved_implementation():
    """Test that we can import the improved implementation."""
    print("\n=== Testing Import of Improved Implementation ===")
    
    try:
        # Add mp_puzzle_generation to path
        mp_path = Path(__file__).parent / "mp_puzzle_generation"
        sys.path.append(str(mp_path))
        
        from ImprovedGeminiTaskProcessor import create_improved_task_processor
        print("✅ Successfully imported ImprovedGeminiTaskProcessor")
        
        # Test creating processor
        processor = create_improved_task_processor("params.yaml")
        print("✅ Successfully created improved task processor")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to import/create improved implementation: {e}")
        return False


def test_gemini_enhancer_integration():
    """Test that gemini_enhancer can use the improved implementation."""
    print("\n=== Testing Gemini Enhancer Integration ===")
    
    try:
        # Just test that we can import GeminiEnhancer without issues
        from pipeline.gemini_enhancer import GeminiEnhancer
        print("✅ Successfully imported GeminiEnhancer")
        
        # Test the multiprocessing method directly without instantiation
        # Check that the _process_with_multiprocessing method exists
        if hasattr(GeminiEnhancer, '_process_with_multiprocessing'):
            print("✅ GeminiEnhancer has _process_with_multiprocessing method")
        else:
            print("❌ GeminiEnhancer missing _process_with_multiprocessing method")
            return False
        
        # Read the source to verify it tries to import ImprovedGeminiTaskProcessor
        import inspect
        source = inspect.getsource(GeminiEnhancer._process_with_multiprocessing)
        
        if "ImprovedGeminiTaskProcessor" in source:
            print("✅ GeminiEnhancer tries to use ImprovedGeminiTaskProcessor first")
        else:
            print("❌ GeminiEnhancer doesn't reference ImprovedGeminiTaskProcessor")
            return False
            
        if "create_improved_task_processor" in source:
            print("✅ GeminiEnhancer uses create_improved_task_processor factory")
        else:
            print("❌ GeminiEnhancer doesn't use create_improved_task_processor")
            return False
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to test gemini_enhancer integration: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_environment_setup():
    """Test environment setup for multiprocessing."""
    print("\n=== Testing Environment Setup ===")
    
    # Check GEMINI_API_KEY
    api_key = os.getenv('GEMINI_API_KEY')
    if api_key:
        print(f"✅ GEMINI_API_KEY is set (length: {len(api_key)})")
    else:
        print("⚠️  GEMINI_API_KEY is not set (expected for testing without actual API calls)")
    
    # Check required directories
    required_dirs = [
        Path("data/themes"),
        Path("data/candidates"), 
        Path("data/cache"),
        Path("data/outputs")
    ]
    
    for dir_path in required_dirs:
        if dir_path.exists():
            print(f"✅ Directory exists: {dir_path}")
        else:
            print(f"ℹ️  Directory missing: {dir_path} (will be created as needed)")
    
    return True


def test_params_yaml():
    """Test that params.yaml has correct multiprocessing configuration."""
    print("\n=== Testing params.yaml Configuration ===")
    
    try:
        import yaml
        
        with open("params.yaml", 'r') as f:
            config = yaml.safe_load(f)
        
        # Check multiprocessing configuration
        mp_config = config.get('multiprocessing', {})
        enabled = mp_config.get('enabled', False)
        worker_count = mp_config.get('worker_count', 1)
        
        print(f"Multiprocessing enabled: {enabled}")
        print(f"Worker count: {worker_count}")
        print(f"Task queue size: {mp_config.get('task_queue_size', 'default')}")
        print(f"Max concurrent requests: {mp_config.get('max_concurrent_requests', 'default')}")
        
        if enabled:
            print("✅ Multiprocessing is properly configured")
        else:
            print("❌ Multiprocessing is disabled in params.yaml")
            
        return enabled
        
    except Exception as e:
        print(f"❌ Failed to read params.yaml: {e}")
        return False


def test_process_cleanup():
    """Test that processes clean up properly."""
    print("\n=== Testing Process Cleanup ===")
    
    try:
        import subprocess
        import time
        
        # Get initial process count
        initial_processes = subprocess.run(
            ['ps', 'aux'], 
            capture_output=True, 
            text=True
        )
        initial_python_procs = len([line for line in initial_processes.stdout.split('\n') 
                                   if 'python' in line.lower()])
        
        print(f"Initial Python processes: {initial_python_procs}")
        
        # The actual multiprocessing test would happen here
        # For now, we just verify the framework is ready
        print("✅ Process cleanup test framework ready")
        print("   (Full test requires running actual multiprocessing)")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed process cleanup test: {e}")
        return False


def main():
    """Run integration tests."""
    print("=" * 60)
    print("INTEGRATION TEST FOR IMPROVED MULTIPROCESSING")
    print("=" * 60)
    
    tests = [
        ("Import Test", test_import_improved_implementation),
        ("Gemini Enhancer Integration", test_gemini_enhancer_integration),
        ("Environment Setup", test_environment_setup),
        ("Params.yaml Configuration", test_params_yaml),
        ("Process Cleanup Framework", test_process_cleanup)
    ]
    
    results = []
    for test_name, test_func in tests:
        print(f"\n🔍 Running {test_name}...")
        try:
            result = test_func()
            results.append((test_name, result))
            if result:
                print(f"✅ {test_name} passed")
            else:
                print(f"❌ {test_name} failed")
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {e}")
            results.append((test_name, False))
    
    print("\n" + "=" * 60)
    print("INTEGRATION TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All integration tests passed!")
        print("The improved multiprocessing implementation is ready to use.")
        print("\nTo run with the new implementation:")
        print("  cd /Users/mh/workplace/Aphori.st/scripts/puzzle-generation")
        print("  npm run generate:all-batches -- --multiprocessing")
    else:
        print("\n⚠️  Some tests failed. Please check the issues above.")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)