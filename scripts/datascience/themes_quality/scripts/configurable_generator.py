#!/usr/bin/env python3
"""
Python-compatible Configurable Puzzle Generator for Investigation

This is a Python wrapper/simulation that interfaces with the existing TypeScript generators
or provides mock functionality for testing the investigation framework.
"""

import sys
import json
import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
import random

@dataclass
class GenerationConfig:
    """Configuration for puzzle generation"""
    algorithm: str = 'N=K'  # 'N=K' or 'N=K+D'
    minSimilarityThreshold: Optional[float] = None
    minWordFrequencyThreshold: Optional[float] = None
    maxAttempts: Optional[int] = None
    qualityThreshold: Optional[float] = None
    difficultyCalculation: str = 'frequency'
    customFrequencyThresholds: Optional[List[float]] = None

@dataclass
class GenerationMetrics:
    """Metrics from puzzle generation"""
    algorithmUsed: str
    parametersUsed: Dict[str, Any]
    categoryGenerationTimes: List[float]
    totalGenerationTime: float

class ConfigurablePuzzleGenerator:
    """Python-compatible configurable puzzle generator"""
    
    def __init__(self, vector_loader=None):
        self.vector_loader = vector_loader
        self.mock_mode = vector_loader is None
        
        if self.mock_mode:
            print("⚠️ ConfigurablePuzzleGenerator running in mock mode (no vector loader)")
        
    async def generateConfigurablePuzzle(
        self,
        date: str,
        puzzleNumber: int,
        puzzleSize: int = 4,
        overrideConfig: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate a puzzle with configurable parameters
        
        Returns a result compatible with the investigation framework
        """
        start_time = time.time()
        
        # Parse configuration
        config = GenerationConfig()
        if overrideConfig:
            for key, value in overrideConfig.items():
                if hasattr(config, key):
                    setattr(config, key, value)
        
        print(f"🔬 Generating {puzzleSize}x{puzzleSize} puzzle with algorithm: {config.algorithm}")
        
        if self.mock_mode:
            # Generate mock puzzle for testing
            result = self._generate_mock_puzzle(date, puzzleNumber, puzzleSize, config)
        else:
            # Interface with actual TypeScript generator would go here
            # For now, fall back to mock
            print("⚠️ Real generator interface not implemented, using mock")
            result = self._generate_mock_puzzle(date, puzzleNumber, puzzleSize, config)
        
        total_time = time.time() - start_time
        
        # Add generation metrics
        if result['puzzle']:
            result['generationMetrics'] = GenerationMetrics(
                algorithmUsed=config.algorithm,
                parametersUsed=asdict(config),
                categoryGenerationTimes=[random.uniform(0.1, 0.5) for _ in range(puzzleSize)],
                totalGenerationTime=total_time
            )
        
        return result
    
    def _generate_mock_puzzle(
        self, 
        date: str, 
        puzzleNumber: int, 
        puzzleSize: int, 
        config: GenerationConfig
    ) -> Dict[str, Any]:
        """Generate a mock puzzle for testing purposes"""
        
        # Mock word sets for different themes
        theme_word_sets = {
            'animals': ['cat', 'dog', 'bird', 'fish', 'horse', 'cow', 'pig', 'sheep'],
            'colors': ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown'],
            'actions': ['run', 'walk', 'jump', 'swim', 'fly', 'climb', 'dance', 'sing'],
            'foods': ['apple', 'banana', 'bread', 'cheese', 'pasta', 'rice', 'soup', 'cake'],
            'vehicles': ['car', 'bus', 'train', 'plane', 'bike', 'boat', 'truck', 'taxi'],
            'weather': ['rain', 'snow', 'wind', 'sun', 'cloud', 'storm', 'fog', 'ice']
        }
        
        themes = list(theme_word_sets.keys())
        
        # Simulate generation success/failure based on parameters
        success_rate = 0.8
        
        # Adjust success rate based on algorithm and thresholds
        if config.algorithm == 'N=K+D':
            success_rate *= 0.9  # Slightly harder
        
        if config.minSimilarityThreshold and config.minSimilarityThreshold > 0.7:
            success_rate *= 0.7  # Much harder with high similarity threshold
        
        # Simulate generation attempts
        max_attempts = config.maxAttempts or 20
        
        for attempt in range(1, max_attempts + 1):
            if random.random() < success_rate:
                # Generate successful puzzle
                categories = []
                all_words = []
                
                selected_themes = random.sample(themes, puzzleSize)
                
                for i, theme in enumerate(selected_themes):
                    theme_words = theme_word_sets[theme]
                    puzzle_words = random.sample(theme_words, puzzleSize)
                    
                    # Simulate difficulty progression
                    difficulty = i + 1
                    
                    # Simulate similarity (higher for easier categories)
                    base_similarity = 0.7 - (difficulty * 0.05)
                    similarity = max(0.5, base_similarity + random.uniform(-0.1, 0.1))
                    
                    # Apply similarity threshold constraint
                    if config.minSimilarityThreshold:
                        if similarity < config.minSimilarityThreshold:
                            # Failed similarity check, retry
                            break
                    
                    category = {
                        'id': f'cat_{i+1}',
                        'themeWord': theme,
                        'words': puzzle_words,
                        'difficulty': difficulty,
                        'similarity': similarity,
                        'difficultyMetrics': {
                            'totalNeighbors': puzzleSize if config.algorithm == 'N=K' else puzzleSize + difficulty,
                            'frequencyThreshold': 1000 * (10 ** (difficulty - 1)),
                            'discardedClosest': 0 if config.algorithm == 'N=K' else difficulty,
                            'selectedRange': f'1-{puzzleSize} (closest)' if config.algorithm == 'N=K' else f'{difficulty+1}-{puzzleSize+difficulty} (discarded {difficulty} closest)'
                        }
                    }
                    
                    categories.append(category)
                    all_words.extend(puzzle_words)
                
                # Check if we generated all categories successfully
                if len(categories) == puzzleSize:
                    # Calculate overall quality
                    avg_similarity = sum(cat['similarity'] for cat in categories) / len(categories)
                    quality_score = avg_similarity * 0.8 + random.uniform(0.1, 0.2)
                    
                    # Apply quality threshold
                    quality_threshold = config.qualityThreshold or 0.5
                    if quality_score >= quality_threshold:
                        puzzle = {
                            'id': f'themes_{date}_{puzzleNumber}',
                            'date': date,
                            'puzzleNumber': puzzleNumber,
                            'gridSize': puzzleSize,
                            'difficulty': sum(cat['difficulty'] for cat in categories) / len(categories),
                            'categories': categories,
                            'words': all_words,
                            'metadata': {
                                'generatedAt': int(time.time() * 1000),
                                'avgSimilarity': avg_similarity,
                                'qualityScore': quality_score
                            }
                        }
                        
                        return {
                            'puzzle': puzzle,
                            'qualityScore': quality_score,
                            'attempts': attempt
                        }
        
        # Failed to generate
        return {
            'puzzle': None,
            'qualityScore': 0,
            'attempts': max_attempts
        }

# Test the generator
async def test_configurable_generator():
    """Test the configurable generator"""
    print("🧪 Testing Configurable Generator")
    
    generator = ConfigurablePuzzleGenerator()
    
    configs = [
        {'algorithm': 'N=K'},
        {'algorithm': 'N=K+D'},
        {'algorithm': 'N=K', 'minSimilarityThreshold': 0.8},
        {'algorithm': 'N=K', 'qualityThreshold': 0.7}
    ]
    
    for i, config in enumerate(configs):
        print(f"\n🔬 Testing configuration {i+1}: {config}")
        
        result = await generator.generateConfigurablePuzzle(
            date="2024-08-05",
            puzzleNumber=i+1,
            puzzleSize=4,
            overrideConfig=config
        )
        
        if result['puzzle']:
            print(f"   ✅ Success: Quality {result['qualityScore']:.3f}, Attempts {result['attempts']}")
            if 'generationMetrics' in result:
                metrics = result['generationMetrics']
                print(f"   📊 Algorithm: {metrics.algorithmUsed}, Time: {metrics.totalGenerationTime:.3f}s")
        else:
            print(f"   ❌ Failed after {result['attempts']} attempts")

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_configurable_generator())