#!/usr/bin/env python3
"""
Debug script to see what the bridge is actually outputting
"""

import subprocess
import time
import os

def debug_bridge_output():
    """Debug what the bridge server outputs"""
    print("🔍 Starting debug of bridge output...")
    
    bridge_path = '/Users/mh/workplace/Aphori.st/scripts/puzzle-generation'
    
    # Start the server
    process = subprocess.Popen(
        ['node', 'puzzle_generation_bridge.js', 'server'],
        cwd=bridge_path,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    print("📡 Waiting for server to start...")
    time.sleep(3)
    
    # Send a request
    test_config = '{"algorithm":"N=K","puzzleSize":4,"maxAttempts":2}'
    print(f"📤 Sending: {test_config}")
    
    process.stdin.write(test_config + '\n')
    process.stdin.flush()
    
    print("📥 Reading response lines...")
    for i in range(100):  # Read up to 100 lines
        try:
            line = process.stdout.readline()
            if not line:
                print(f"   Line {i}: <EOF>")
                break
            
            line = line.strip()
            print(f"   Line {i}: {line[:100]}{'...' if len(line) > 100 else ''}")
            
            # Stop if we get a JSON response
            if line.startswith('{') and line.endswith('}'):
                print(f"   🎯 Found JSON response on line {i}!")
                try:
                    import json
                    result = json.loads(line)
                    print(f"   ✅ Valid JSON with keys: {list(result.keys())}")
                    break
                except json.JSONDecodeError as e:
                    print(f"   ❌ JSON decode error: {e}")
        except Exception as e:
            print(f"   Error reading line {i}: {e}")
            break
    
    # Cleanup
    try:
        process.stdin.write('quit\n')
        process.stdin.flush()
        process.wait(timeout=5)
    except:
        process.terminate()
    
    print("🏁 Debug complete!")

if __name__ == "__main__":
    debug_bridge_output()