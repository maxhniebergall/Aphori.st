#!/usr/bin/env node
/**
 * Puzzle Generation Bridge: Node.js interface for Python to access real puzzle generation
 * 
 * This allows our Python investigation to use the actual TypeScript puzzle generation
 * with configurable parameters for comprehensive analysis.
 */

import { ConfigurablePuzzleGenerator } from './dist/ConfigurablePuzzleGenerator.js';
import { FullVectorLoader } from './dist/FullVectorLoader.js';

class PuzzleGenerationBridge {
    constructor() {
        this.vectorLoader = null;
        this.generator = null;
        this.initialized = false;
    }

    async initialize(quiet = false) {
        if (this.initialized) {
            return { success: true, message: 'Already initialized' };
        }

        if (!quiet) console.log('🔄 Initializing puzzle generation bridge...');
        
        try {
            // Initialize vector loader
            this.vectorLoader = new FullVectorLoader();
            const vectorResult = await this.vectorLoader.initialize();
            
            if (!vectorResult.success) {
                return { success: false, error: 'Vector loader initialization failed' };
            }
            
            // Initialize configurable puzzle generator
            this.generator = new ConfigurablePuzzleGenerator(this.vectorLoader);
            
            this.initialized = true;
            if (!quiet) console.log(`✅ Puzzle generation bridge initialized: ${vectorResult.loadedWords} words loaded`);
            
            return { 
                success: true, 
                loadedWords: vectorResult.loadedWords,
                totalWords: vectorResult.totalWords,
                dimension: vectorResult.dimension
            };
            
        } catch (error) {
            console.error('❌ Puzzle generation bridge initialization failed:', error);
            return { success: false, error: error.message };
        }
    }

    async generatePuzzle(config) {
        if (!this.initialized) {
            throw new Error('Puzzle generation bridge not initialized');
        }

        try {
            const date = new Date().toISOString().split('T')[0];
            const puzzleNumber = Math.floor(Math.random() * 1000);
            const puzzleSize = config.puzzleSize || 4;
            
            // Create generation config
            const generationConfig = {
                algorithm: config.algorithm || 'N=K',
                minSimilarityThreshold: config.minSimilarityThreshold,
                minWordFrequencyThreshold: config.minWordFrequencyThreshold,
                maxAttempts: config.maxAttempts || 20,
                qualityThreshold: config.qualityThreshold || 0.5
            };
            
            const result = await this.generator.generateConfigurablePuzzle(
                date, 
                puzzleNumber, 
                puzzleSize,
                generationConfig
            );
            
            if (result.puzzle) {
                return {
                    success: true,
                    puzzle: result.puzzle,
                    qualityScore: result.qualityScore,
                    attempts: result.attempts,
                    config: result.config,
                    generationMetrics: result.generationMetrics
                };
            } else {
                return {
                    success: false,
                    attempts: result.attempts,
                    error: 'Failed to generate puzzle within attempt limit'
                };
            }
            
        } catch (error) {
            console.error('❌ Error generating puzzle:', error);
            return { success: false, error: error.message };
        }
    }

    getStats() {
        if (!this.vectorLoader) {
            return { initialized: false };
        }

        const stats = this.vectorLoader.getStats();
        return {
            initialized: this.initialized,
            totalVocabulary: stats.totalVocabulary,
            loadedVectors: stats.loadedVectors,
            memoryUsage: stats.memoryUsage
        };
    }
}

// Command-line interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const bridge = new PuzzleGenerationBridge();

    if (command === 'init') {
        const quiet = args[1] === '--quiet';
        const result = await bridge.initialize(quiet);
        console.log(JSON.stringify(result));
        
    } else if (command === 'generate') {
        await bridge.initialize();
        
        // Parse config from command line arguments or stdin
        let config = {};
        if (args[1]) {
            try {
                config = JSON.parse(args[1]);
            } catch (e) {
                console.error('❌ Invalid JSON config:', args[1]);
                process.exit(1);
            }
        }
        
        const result = await bridge.generatePuzzle(config);
        console.log(JSON.stringify(result));
        
    } else if (command === 'stats') {
        if (args[1] !== 'only') {
            await bridge.initialize();
        }
        const stats = bridge.getStats();
        console.log(JSON.stringify(stats));
        
    } else if (command === 'test') {
        // Run comprehensive test
        console.log('🧪 Testing Puzzle Generation Bridge...');
        
        const initResult = await bridge.initialize();
        if (!initResult.success) {
            console.log('❌ Initialization failed');
            process.exit(1);
        }
        
        // Test puzzle generation with different algorithms
        const testConfigs = [
            { algorithm: 'N=K', puzzleSize: 4 },
            { algorithm: 'N=K+D', puzzleSize: 4 },
            { algorithm: 'N=K', minSimilarityThreshold: 0.3, puzzleSize: 4 }
        ];
        
        console.log('🔍 Testing puzzle generation:');
        for (const [index, config] of testConfigs.entries()) {
            const result = await bridge.generatePuzzle(config);
            if (result.success) {
                console.log(`   Test ${index + 1}: ✅ Generated ${config.algorithm} puzzle (quality: ${result.qualityScore.toFixed(3)}, attempts: ${result.attempts})`);
            } else {
                console.log(`   Test ${index + 1}: ❌ Failed to generate ${config.algorithm} puzzle (attempts: ${result.attempts})`);
            }
        }
        
        console.log('✅ Puzzle generation bridge test completed!');
        
    } else {
        console.log('Usage:');
        console.log('  node puzzle_generation_bridge.js init');
        console.log('  node puzzle_generation_bridge.js generate \'{"algorithm":"N=K","puzzleSize":4}\'');
        console.log('  node puzzle_generation_bridge.js stats [only]');
        console.log('  node puzzle_generation_bridge.js test');
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('❌ Puzzle generation bridge error:', error);
        process.exit(1);
    });
}

export { PuzzleGenerationBridge };