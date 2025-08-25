#!/usr/bin/env python3
"""
TypeScript Bridge: Python interface to real TypeScript puzzle generation

Enables the Python investigation code to use the actual ConfigurablePuzzleGenerator
with real vector data instead of mock implementations.
"""

import subprocess
import json
import os
import atexit
import signal
from typing import Dict, Any

class TypeScriptPuzzleGenerator:
    """Python wrapper for TypeScript puzzle generation via persistent Node.js bridge"""
    
    def __init__(self):
        self.initialized = False
        self.bridge_path = os.environ.get('TYPESCRIPT_BRIDGE_PATH', '/Users/mh/workplace/Aphori.st/scripts/puzzle-generation')
        self.bridge_script = 'puzzle_generation_bridge.js'
        self.persistent_process = None
        self._setup_cleanup()
    
    def _setup_cleanup(self):
        """Setup cleanup handlers for persistent process"""
        atexit.register(self._cleanup)
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle system signals by cleaning up"""
        self._cleanup()
        
    def _cleanup(self):
        """Cleanup persistent process"""
        if self.persistent_process and self.persistent_process.poll() is None:
            try:
                # Send quit command
                self.persistent_process.stdin.write('quit\n')
                self.persistent_process.stdin.flush()
                self.persistent_process.wait(timeout=5)
            except:
                try:
                    self.persistent_process.terminate()
                    self.persistent_process.wait(timeout=5)
                except:
                    try:
                        self.persistent_process.kill()
                    except:
                        pass
            finally:
                self.persistent_process = None
                
    def initialize(self) -> Dict[str, Any]:
        """Initialize TypeScript puzzle generation system with persistent server"""
        if self.initialized and self.persistent_process and self.persistent_process.poll() is None:
            return {'success': True, 'message': 'Already initialized'}
            
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
            
            # Start persistent server process
            self.persistent_process = subprocess.Popen(
                ['node', self.bridge_script, 'server'],
                cwd=self.bridge_path,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1  # Line buffered
            )
            
            # Wait for server to be ready by reading stderr until we see "Bridge server ready"
            server_ready = False
            init_words = None
            while True:
                line = self.persistent_process.stderr.readline()
                if not line:
                    break
                if "Bridge server ready:" in line:
                    # Extract word count from the line
                    import re
                    match = re.search(r'(\d+) words loaded', line)
                    if match:
                        init_words = int(match.group(1))
                    server_ready = True
                    break
                elif "initialization failed" in line.lower():
                    self._cleanup()
                    return {'success': False, 'error': f'Server initialization failed: {line.strip()}'}
            
            if not server_ready:
                self._cleanup()
                return {'success': False, 'error': 'Server did not start properly'}
            
            self.initialized = True
            return {
                'success': True,
                'loadedWords': init_words or 0,
                'message': 'Persistent server initialized'
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
        """Generate a puzzle using persistent TypeScript server"""
        # Only reinitialize if the bridge was never initialized or process has definitely died
        if not self.initialized:
            print("🔄 TypeScript bridge not initialized, initializing...")
            init_result = self.initialize()
            if not init_result.get('success'):
                return {'success': False, 'error': 'Bridge initialization failed'}
        elif self.persistent_process and self.persistent_process.poll() is not None:
            print("⚠️ TypeScript bridge process died, reinitializing...")
            self._cleanup()
            self.initialized = False
            init_result = self.initialize()
            if not init_result.get('success'):
                return {'success': False, 'error': 'Bridge reinitialization failed'}
        
        try:
            # Send config as JSON to persistent server via stdin
            config_json = json.dumps(config)
            self.persistent_process.stdin.write(config_json + '\n')
            self.persistent_process.stdin.flush()
            
            # Read response from stdout - may need to skip non-JSON lines
            max_lines_to_read = 200  # Increased limit for puzzle generation verbosity
            lines_read = 0
            
            json_buffer = ""
            collecting_json = False
            
            while lines_read < max_lines_to_read:
                response_line = self.persistent_process.stdout.readline()
                if not response_line:
                    break
                
                response_line = response_line.strip()
                lines_read += 1
                
                # Skip empty lines
                if not response_line:
                    continue
                
                # Start collecting JSON if line starts with {
                if response_line.startswith('{') and not collecting_json:
                    collecting_json = True
                    json_buffer = response_line
                    
                    # Check if it's a complete JSON object
                    if response_line.endswith('}'):
                        try:
                            return json.loads(json_buffer)
                        except json.JSONDecodeError:
                            collecting_json = False
                            json_buffer = ""
                    continue
                
                # Continue collecting JSON if we're in the middle
                if collecting_json:
                    json_buffer += response_line
                    
                    # Check if we've completed the JSON object
                    if response_line.endswith('}'):
                        try:
                            return json.loads(json_buffer)
                        except json.JSONDecodeError:
                            collecting_json = False
                            json_buffer = ""
                    continue
                
                # Skip non-JSON lines if we're not collecting
                if not collecting_json:
                    continue
            
            return {'success': False, 'error': f'No valid JSON response found in {max_lines_to_read} lines'}
                
        except Exception as e:
            # Server communication failed - don't immediately reinitialize, just return error
            print(f"⚠️ TypeScript bridge communication error (server may be busy): {e}")
            return {'success': False, 'error': f'Server communication failed: {e}'}
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics from TypeScript components"""
        try:
            result = subprocess.run(
                ['node', self.bridge_script, 'stats'],
                cwd=self.bridge_path,
                capture_output=True,
                text=True,
                timeout=30
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