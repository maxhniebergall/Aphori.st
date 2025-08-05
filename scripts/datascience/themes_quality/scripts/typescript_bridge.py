#!/usr/bin/env python3
"""
TypeScript Bridge: Python interface to real TypeScript puzzle generation

Enables the Python investigation code to use the actual ConfigurablePuzzleGenerator
with real vector data instead of mock implementations.
"""

import subprocess
import json
import os
from typing import Dict, Any

class TypeScriptPuzzleGenerator:
    """Python wrapper for TypeScript puzzle generation via Node.js bridge"""
    
    def __init__(self):
        self.initialized = False
        self.bridge_path = os.environ.get('TYPESCRIPT_BRIDGE_PATH', '/Users/mh/workplace/Aphori.st/scripts/puzzle-generation')
        self.bridge_script = 'puzzle_generation_bridge.js'
        
    def initialize(self) -> Dict[str, Any]:
        """Initialize TypeScript puzzle generation system"""
        try:
            # First copy bridge script to puzzle-generation directory with corrected imports
            source_bridge = os.environ.get('TYPESCRIPT_BRIDGE_SOURCE', '/Users/mh/workplace/Aphori.st/scripts/datascience/themes_quality/scripts/puzzle_generation_bridge.js')
            target_bridge = os.path.join(self.bridge_path, self.bridge_script)
            
            if not os.path.exists(target_bridge):
                # Read source and fix import paths
                with open(source_bridge, 'r') as f:
                    bridge_content = f.read()
                
                # Fix import paths for when running from puzzle-generation directory
                fixed_content = bridge_content.replace(
                    "from '../../backend/dist/ConfigurablePuzzleGenerator.js'",
                    "from './dist/ConfigurablePuzzleGenerator.js'"
                ).replace(
                    "from '../../backend/dist/FullVectorLoader.js'",
                    "from './dist/FullVectorLoader.js'"
                )
                
                with open(target_bridge, 'w') as f:
                    f.write(fixed_content)
                print(f"📋 Created bridge script at {target_bridge}")
            
            # Initialize the bridge
            result = subprocess.run(
                ['node', self.bridge_script, 'init'],
                cwd=self.bridge_path,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode == 0:
                init_result = self._extract_json_from_output(result.stdout)
                
                if not init_result.get('success') and 'No valid JSON found' in init_result.get('error', ''):
                    return init_result
                
                if init_result.get('success'):
                    self.initialized = True
                    return init_result
                else:
                    return {'success': False, 'error': init_result.get('error', 'Unknown initialization error')}
            else:
                return {
                    'success': False, 
                    'error': f'Bridge initialization failed: {result.stderr}'
                }
                
        except Exception as e:
            return {'success': False, 'error': f'Failed to initialize TypeScript bridge: {e}'}
    
    def _extract_json_from_output(self, stdout: str) -> Dict[str, Any]:
        """Extract and parse JSON from command output, handling mixed output scenarios"""
        lines = stdout.strip().split('\n')
        json_line = lines[-1]  # Last line should be the JSON response
        
        try:
            return json.loads(json_line)
        except json.JSONDecodeError:
            # If that fails, try to find JSON in the output
            for line in reversed(lines):
                if line.startswith('{') and line.endswith('}'):
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue
            # No valid JSON found
            return {'success': False, 'error': f'No valid JSON found in output: {stdout}'}
    
    def generate_puzzle(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a puzzle using TypeScript components"""
        if not self.initialized:
            init_result = self.initialize()
            if not init_result.get('success'):
                return {'success': False, 'error': 'Bridge not initialized'}
        
        try:
            # Prepare config for Node.js
            config_json = json.dumps(config)
            
            # Call the bridge
            result = subprocess.run(
                ['node', self.bridge_script, 'generate', config_json],
                cwd=self.bridge_path,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return self._extract_json_from_output(result.stdout)
            else:
                return {
                    'success': False,
                    'error': f'Puzzle generation failed: {result.stderr}'
                }
                
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Puzzle generation timed out'}
        except Exception as e:
            return {'success': False, 'error': f'Failed to generate puzzle: {e}'}
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics from TypeScript components"""
        try:
            result = subprocess.run(
                ['node', self.bridge_script, 'stats'],
                cwd=self.bridge_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                try:
                    return json.loads(result.stdout.strip())
                except json.JSONDecodeError as e:
                    return {'initialized': False, 'error': f'Invalid JSON response: {e}'}
            else:
                return {'initialized': False, 'error': result.stderr}
                
        except Exception as e:
            return {'initialized': False, 'error': str(e)}

def test_typescript_bridge():
    """Test the TypeScript bridge functionality"""
    print("🧪 Testing TypeScript Puzzle Generation Bridge")
    print("=" * 50)
    
    bridge = TypeScriptPuzzleGenerator()
    
    # Test initialization
    print("📋 Testing initialization...")
    init_result = bridge.initialize()
    
    if not init_result.get('success'):
        print(f"❌ Initialization failed: {init_result.get('error')}")
        return False
    
    print(f"✅ Initialized: {init_result.get('loadedWords')} words loaded")
    
    # Test puzzle generation
    print("\n🔬 Testing puzzle generation...")
    test_configs = [
        {'algorithm': 'N=K', 'puzzleSize': 4, 'maxAttempts': 5},
        {'algorithm': 'N=K+D', 'puzzleSize': 4, 'maxAttempts': 5},
        {'algorithm': 'N=K', 'minSimilarityThreshold': 0.3, 'puzzleSize': 4, 'maxAttempts': 5}
    ]
    
    for i, config in enumerate(test_configs):
        print(f"   Test {i+1}: {config['algorithm']} algorithm...")
        result = bridge.generate_puzzle(config)
        
        if result.get('success'):
            puzzle = result.get('puzzle')
            quality = result.get('qualityScore', 0)
            attempts = result.get('attempts', 0)
            print(f"   ✅ Generated puzzle: quality={quality:.3f}, attempts={attempts}")
            
            # Show sample category
            if puzzle and 'categories' in puzzle:
                cat = puzzle['categories'][0]
                words = cat.get('words', [])
                theme = cat.get('themeWord', 'unknown')
                print(f"      Sample category: {theme} → [{', '.join(words)}]")
        else:
            print(f"   ❌ Failed: {result.get('error')}")
    
    # Test stats
    print("\n📊 Testing stats...")
    stats = bridge.get_stats()
    if stats.get('initialized'):
        print(f"   Total vocabulary: {stats.get('totalVocabulary', 'unknown')}")
        print(f"   Memory usage: {stats.get('memoryUsage', 'unknown')}")
    
    print("\n✅ TypeScript bridge test completed!")
    return True

if __name__ == "__main__":
    success = test_typescript_bridge()
    exit(0 if success else 1)