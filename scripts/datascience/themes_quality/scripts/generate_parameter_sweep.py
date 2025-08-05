#!/usr/bin/env python3
"""
Parameter Sweep Generation Script

Generates puzzles across different parameter combinations to analyze their impact
on word quality and generation performance.
"""

import sys
import os
import json
import time
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
import pandas as pd

# Add puzzle generation to path
sys.path.append('../../puzzle-generation')

try:
    # Import Python-compatible components for fallback
    sys.path.append('../scripts')
    from configurable_generator import ConfigurablePuzzleGenerator as PythonGenerator, GenerationConfig
    
    # Try to use real TypeScript puzzle generation via Node.js bridge
    import subprocess
    import json
    
    # Test if Node.js bridge is available
    try:
        result = subprocess.run(
            ['node', 'puzzle_generation_bridge.js', 'stats', 'only'], 
            cwd='/Users/mh/workplace/Aphori.st/scripts/puzzle-generation',
            capture_output=True, 
            text=True, 
            timeout=5
        )
        if result.returncode == 0:
            typescript_available = True
            print("✅ TypeScript puzzle generation bridge available")
        else:
            typescript_available = False
            print("⚠️ TypeScript bridge test failed, using Python fallback")
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
        typescript_available = False
        print(f"⚠️ TypeScript components not available ({e}), using Python-only mode")
        
except ImportError as e:
    print(f"❌ Failed to import puzzle generation components: {e}")
    sys.exit(1)

class ParameterSweepGenerator:
    """Generates puzzles across parameter ranges for analysis"""
    
    def __init__(self, config_path: str = '../config/investigation_config.json'):
        self.config = self.load_config(config_path)
        self.vector_loader = None
        self.generator = None
        self.results = []
        
    def load_config(self, config_path: str) -> Dict:
        """Load investigation configuration"""
        with open(config_path, 'r') as f:
            return json.load(f)
    
    async def initialize(self):
        """Initialize puzzle generation components"""
        print("🚀 Initializing puzzle generation system...")
        
        if typescript_available:
            try:
                # Initialize TypeScript bridge for real puzzle generation
                from typescript_bridge import TypeScriptPuzzleGenerator
                self.ts_generator = TypeScriptPuzzleGenerator()
                
                init_result = self.ts_generator.initialize()
                if init_result.get('success'):
                    print(f"✅ TypeScript puzzle generator initialized: {init_result['loadedWords']} words loaded")
                    self.use_typescript = True
                else:
                    print(f"⚠️ TypeScript initialization failed: {init_result.get('error')}, using Python fallback")
                    self.use_typescript = False
            except Exception as e:
                print(f"⚠️ TypeScript bridge failed: {e}, using Python fallback")
                self.use_typescript = False
        else:
            print("⚠️ TypeScript components not available, using Python fallback")
            self.use_typescript = False
        
        # Initialize Python fallback generator
        if not self.use_typescript:
            self.generator = PythonGenerator(self.vector_loader)
            print("✅ Python puzzle generator initialized (mock mode)")
        
        print(f"📋 Using {'TypeScript' if self.use_typescript else 'Python'} puzzle generation")
    
    async def generate_puzzle_with_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Generate puzzle using appropriate generator (TypeScript or Python)"""
        if self.use_typescript:
            # Use TypeScript generator via bridge
            result = self.ts_generator.generate_puzzle(config)
            return result
        else:
            # Use Python fallback generator
            result = await self.generator.generateConfigurablePuzzle(
                date="2024-08-05", 
                puzzleNumber=1, 
                puzzleSize=config.get('puzzleSize', 4),
                overrideConfig=config
            )
            return result
    
    async def run_algorithm_comparison_sweep(self):
        """Test N=K vs N=K+D algorithm comparison"""
        print("📊 Running N=K vs N=K+D algorithm comparison sweep...")
        
        algorithms = self.config['parameter_sweeps']['algorithms']  # ["N=K", "N=K+D"]
        samples_per_config = self.config['parameter_sweeps']['samples_per_configuration']
        
        # Import quality metrics for enhanced analysis
        try:
            sys.path.append('../scripts')
            from quality_metrics import QualityMetrics
            quality_calculator = QualityMetrics(self.vector_loader)
            print("✅ Quality metrics initialized")
        except ImportError:
            quality_calculator = None
            print("⚠️ Could not import quality metrics, using basic metrics only")
        
        for algorithm in algorithms:
            print(f"\n🎯 Testing algorithm: {algorithm}")
            
            for sample in range(samples_per_config):
                try:
                    start_time = time.time()
                    
                    # Use configurable generator with specific algorithm
                    config = {
                        'algorithm': algorithm, 
                        'puzzleSize': 4,
                        'maxAttempts': 20
                    }
                    
                    result = await self.generate_puzzle_with_config(config)
                    
                    generation_time = time.time() - start_time
                    
                    # Record results
                    record = {
                        'sweep_type': 'algorithm_comparison',
                        'algorithm': algorithm,
                        'parameter_value': algorithm,
                        'sample_id': sample + 1,
                        'generation_time': generation_time,
                        'success': result.get('success', False) and result.get('puzzle') is not None,
                        'attempts': result.get('attempts', 0),
                        'quality_score': result.get('qualityScore', 0),
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    if result.get('success') and result.get('puzzle'):
                        puzzle = result.get('puzzle')
                        record.update({
                            'avg_similarity': puzzle['metadata']['avgSimilarity'],
                            'num_categories': len(puzzle['categories']),
                            'total_words': len(puzzle['words']),
                            'difficulty': puzzle['difficulty']
                        })
                        
                        # Add category-level metrics
                        for i, category in enumerate(puzzle['categories']):
                            record[f'cat_{i+1}_difficulty'] = category['difficulty']
                            record[f'cat_{i+1}_similarity'] = category['similarity']
                            record[f'cat_{i+1}_theme'] = category['themeWord']
                        
                        # Calculate refined quality metrics
                        if quality_calculator:
                            refined_metrics = quality_calculator.calculate_all_metrics(puzzle)
                            for metric_name, metric_value in refined_metrics.items():
                                record[f'refined_{metric_name}'] = metric_value
                        
                        # Add generation metrics from configurable generator
                        if hasattr(result, 'generationMetrics'):
                            for metric_name, metric_value in result.generationMetrics.items():
                                record[f'generation_{metric_name}'] = metric_value
                    
                    self.results.append(record)
                    
                    if result.get('success') and result.get('puzzle'):
                        refined_score = record.get('refined_overall_quality_score', 'N/A')
                        print(f"   ✅ Sample {sample+1}: Quality {result['qualityScore']:.3f}, "
                              f"Refined {refined_score if isinstance(refined_score, str) else f'{refined_score:.3f}'}, "
                              f"Time {generation_time:.2f}s")
                    else:
                        print(f"   ❌ Sample {sample+1}: Failed after {result['attempts']} attempts")
                        
                except Exception as e:
                    print(f"   ❌ Sample {sample+1}: Error - {e}")
                    self.results.append({
                        'sweep_type': 'algorithm_comparison',
                        'algorithm': algorithm,
                        'parameter_value': algorithm,
                        'sample_id': sample + 1,
                        'success': False,
                        'error': str(e),
                        'timestamp': datetime.now().isoformat()
                    })
    
    async def run_threshold_parameter_sweep(self):
        """Test different similarity and frequency thresholds with N=K algorithm"""
        print("📊 Running similarity and frequency threshold parameter sweep...")
        
        similarity_thresholds = self.config['parameter_sweeps']['similarity_thresholds']
        frequency_thresholds = self.config['parameter_sweeps']['frequency_thresholds']
        samples_per_config = min(10, self.config['parameter_sweeps']['samples_per_configuration'])  # Reduced for parameter sweep
        
        # Import quality metrics
        try:
            sys.path.append('../scripts')
            from quality_metrics import QualityMetrics
            quality_calculator = QualityMetrics(self.vector_loader)
            print("✅ Quality metrics initialized for threshold sweep")
        except ImportError:
            quality_calculator = None
            print("⚠️ Could not import quality metrics for threshold sweep")
        
        # Test similarity thresholds
        for sim_threshold in similarity_thresholds:
            print(f"\n🎯 Testing similarity threshold: {sim_threshold}")
            
            for sample in range(samples_per_config):
                try:
                    start_time = time.time()
                    
                    # Configure with custom similarity threshold
                    config = {
                        'algorithm': 'N=K',
                        'minSimilarityThreshold': sim_threshold
                    }
                    
                    result = await self.generator.generateConfigurablePuzzle(
                        date="2024-08-05", 
                        puzzleNumber=sample + 1, 
                        puzzleSize=4,
                        overrideConfig=config
                    )
                    
                    generation_time = time.time() - start_time
                    
                    # Record results
                    record = {
                        'sweep_type': 'similarity_threshold',
                        'parameter_name': 'similarity_threshold',
                        'parameter_value': sim_threshold,
                        'sample_id': sample + 1,
                        'generation_time': generation_time,
                        'success': result['puzzle'] is not None,
                        'attempts': result['attempts'],
                        'quality_score': result['qualityScore'],
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    if result.get('success') and result.get('puzzle'):
                        puzzle = result.get('puzzle')
                        record.update({
                            'avg_similarity': puzzle['metadata']['avgSimilarity'],
                            'num_categories': len(puzzle['categories']),
                            'total_words': len(puzzle['words']),
                            'difficulty': puzzle['difficulty']
                        })
                        
                        # Calculate refined quality metrics
                        if quality_calculator:
                            refined_metrics = quality_calculator.calculate_all_metrics(puzzle)
                            for metric_name, metric_value in refined_metrics.items():
                                record[f'refined_{metric_name}'] = metric_value
                    
                    self.results.append(record)
                    
                    if result.get('success') and result.get('puzzle'):
                        refined_score = record.get('refined_overall_quality_score', 'N/A')
                        print(f"   ✅ Sample {sample+1}: Quality {result['qualityScore']:.3f}, "
                              f"Refined {refined_score if isinstance(refined_score, str) else f'{refined_score:.3f}'}")
                    else:
                        print(f"   ❌ Sample {sample+1}: Failed after {result['attempts']} attempts")
                        
                except Exception as e:
                    print(f"   ❌ Sample {sample+1}: Error - {e}")
                    self.results.append({
                        'sweep_type': 'similarity_threshold',
                        'parameter_name': 'similarity_threshold',
                        'parameter_value': sim_threshold,
                        'sample_id': sample + 1,
                        'success': False,
                        'error': str(e),
                        'timestamp': datetime.now().isoformat()
                    })
    
    async def run_similarity_threshold_sweep(self):
        """Test different similarity thresholds"""
        print("📊 Running similarity threshold sweep...")
        
        thresholds = self.config['parameter_sweeps']['similarity_thresholds']
        samples_per_config = self.config['parameter_sweeps']['samples_per_configuration']
        
        for threshold in thresholds:
            print(f"\n🎯 Testing similarity threshold: {threshold}")
            
            # Similar to frequency sweep, would need generator modification
            # For baseline, generate with standard settings
            
            for sample in range(samples_per_config):
                try:
                    start_time = time.time()
                    
                    result = await self.generator.generateSinglePuzzle(
                        date="2024-08-05", 
                        puzzleNumber=sample + 1, 
                        puzzleSize=4
                    )
                    
                    generation_time = time.time() - start_time
                    
                    record = {
                        'sweep_type': 'similarity_threshold',
                        'parameter_value': threshold,
                        'sample_id': sample + 1,
                        'generation_time': generation_time,
                        'success': result['puzzle'] is not None,
                        'attempts': result['attempts'],
                        'quality_score': result['qualityScore'],
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    if result.get('success') and result.get('puzzle'):
                        puzzle = result.get('puzzle')
                        record.update({
                            'avg_similarity': puzzle['metadata']['avgSimilarity'],
                            'num_categories': len(puzzle['categories']),
                            'total_words': len(puzzle['words']),
                            'difficulty': puzzle['difficulty']
                        })
                    
                    self.results.append(record)
                    
                    if result.get('success') and result.get('puzzle'):
                        print(f"   ✅ Sample {sample+1}: Quality {result['qualityScore']:.3f}")
                    else:
                        print(f"   ❌ Sample {sample+1}: Failed")
                        
                except Exception as e:
                    print(f"   ❌ Sample {sample+1}: Error - {e}")
                    self.results.append({
                        'sweep_type': 'similarity_threshold',
                        'parameter_value': threshold,
                        'sample_id': sample + 1,
                        'success': False,
                        'error': str(e),
                        'timestamp': datetime.now().isoformat()
                    })
    
    async def run_puzzle_size_sweep(self):
        """Test different puzzle sizes"""
        print("📊 Running puzzle size sweep...")
        
        sizes = self.config['parameter_sweeps']['puzzle_sizes']
        samples_per_config = min(10, self.config['parameter_sweeps']['samples_per_configuration'])  # Fewer samples for larger puzzles
        
        for size in sizes:
            print(f"\n🎯 Testing puzzle size: {size}x{size}")
            
            for sample in range(samples_per_config):
                try:
                    start_time = time.time()
                    
                    result = await self.generator.generateSinglePuzzle(
                        date="2024-08-05", 
                        puzzleNumber=sample + 1, 
                        puzzleSize=size
                    )
                    
                    generation_time = time.time() - start_time
                    
                    record = {
                        'sweep_type': 'puzzle_size',
                        'parameter_value': size,
                        'sample_id': sample + 1,
                        'generation_time': generation_time,
                        'success': result['puzzle'] is not None,
                        'attempts': result['attempts'],
                        'quality_score': result['qualityScore'],
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    if result.get('success') and result.get('puzzle'):
                        puzzle = result.get('puzzle')
                        record.update({
                            'avg_similarity': puzzle['metadata']['avgSimilarity'],
                            'num_categories': len(puzzle['categories']),
                            'total_words': len(puzzle['words']),
                            'difficulty': puzzle['difficulty']
                        })
                    
                    self.results.append(record)
                    
                    if result.get('success') and result.get('puzzle'):
                        print(f"   ✅ Sample {sample+1}: Quality {result['qualityScore']:.3f}, Time {generation_time:.2f}s")
                    else:
                        print(f"   ❌ Sample {sample+1}: Failed")
                        
                except Exception as e:
                    print(f"   ❌ Sample {sample+1}: Error - {e}")
                    self.results.append({
                        'sweep_type': 'puzzle_size',
                        'parameter_value': size,
                        'sample_id': sample + 1,
                        'success': False,
                        'error': str(e),
                        'timestamp': datetime.now().isoformat()
                    })
    
    def save_results(self):
        """Save sweep results to files"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = Path('../data/raw')
        output_dir.mkdir(exist_ok=True)
        
        # Save as CSV
        df = pd.DataFrame(self.results)
        csv_path = output_dir / f'parameter_sweep_{timestamp}.csv'
        df.to_csv(csv_path, index=False)
        
        # Save as JSON
        json_path = output_dir / f'parameter_sweep_{timestamp}.json'
        with open(json_path, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print(f"✅ Results saved:")
        print(f"   - CSV: {csv_path}")
        print(f"   - JSON: {json_path}")
        print(f"   - Total records: {len(self.results)}")
        
        # Print summary
        if self.results:
            df_success = df[df['success'] == True]
            print(f"\n📊 Sweep Summary:")
            print(f"   - Total attempts: {len(df)}")
            print(f"   - Successful: {len(df_success)} ({len(df_success)/len(df)*100:.1f}%)")
            
            if len(df_success) > 0:
                print(f"   - Avg quality: {df_success['quality_score'].mean():.3f}")
                print(f"   - Avg time: {df_success['generation_time'].mean():.2f}s")

async def main():
    """Main execution function"""
    print("🔬 Starting Parameter Sweep Generation")
    print("=" * 50)
    
    try:
        # Initialize sweep generator
        sweep_gen = ParameterSweepGenerator()
        await sweep_gen.initialize()
        
        # Run comprehensive investigation sweeps
        sweep_types = ['algorithm_comparison', 'threshold_parameters']
        
        for sweep_type in sweep_types:
            print(f"\n{'='*20} {sweep_type.upper().replace('_', ' ')} SWEEP {'='*20}")
            
            if sweep_type == 'algorithm_comparison':
                await sweep_gen.run_algorithm_comparison_sweep()
            elif sweep_type == 'threshold_parameters':
                await sweep_gen.run_threshold_parameter_sweep()
        
        # Save results
        sweep_gen.save_results()
        
        print("\n✅ Parameter sweep generation completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Parameter sweep failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())