#!/usr/bin/env node

/**
 * Data Science Pipeline Bridge
 * Converts the data science pipeline output to the puzzle generation system format
 */

import fs from 'fs/promises';
import path from 'path';
import { GeneratedPuzzle, GeneratedCategory } from './HighQualityPuzzleGenerator.js';

export interface DataSciencePuzzleData {
  [theme: string]: {
    words: string[];
    theme_similarity_scores: number[];
    all_candidates: string[];
    all_similarities: number[];
  };
}

export interface ConvertedPuzzleOutput {
  date: string;
  puzzles: GeneratedPuzzle[];
  metadata: {
    generatedAt: number;
    generatorVersion: string;
    totalThemes: number;
    convertedFromDataScience: boolean;
    originalSource: string;
  };
}

class DataScienceBridge {
  /**
   * Convert data science pipeline output to puzzle generation format
   */
  async convertDataScienceOutput(
    inputPath: string,
    outputPath: string,
    targetDate: string = new Date().toISOString().split('T')[0]
  ): Promise<ConvertedPuzzleOutput> {
    console.log(`🔄 Converting data science output from ${inputPath}`);
    
    // Load the data science pipeline output
    const rawData = await fs.readFile(inputPath, 'utf-8');
    const dataScienceData: DataSciencePuzzleData = JSON.parse(rawData);
    
    console.log(`📊 Found ${Object.keys(dataScienceData).length} themes to convert`);
    
    // Convert to puzzle format
    const puzzles = await this.convertToPuzzles(dataScienceData, targetDate);
    
    const convertedOutput: ConvertedPuzzleOutput = {
      date: targetDate,
      puzzles: puzzles,
      metadata: {
        generatedAt: Date.now(),
        generatorVersion: '2.0.0-datasci-bridge',
        totalThemes: Object.keys(dataScienceData).length,
        convertedFromDataScience: true,
        originalSource: inputPath
      }
    };
    
    // Save converted output
    await fs.writeFile(outputPath, JSON.stringify(convertedOutput, null, 2));
    console.log(`💾 Converted output saved to ${outputPath}`);
    
    // Generate Firebase-compatible format
    const firebaseOutput = this.convertToFirebaseFormat(convertedOutput);
    const firebasePath = outputPath.replace('.json', '_firebase.json');
    await fs.writeFile(firebasePath, JSON.stringify(firebaseOutput, null, 2));
    console.log(`🔥 Firebase format saved to ${firebasePath}`);
    
    return convertedOutput;
  }

  /**
   * Convert data science themes to puzzle categories
   */
  private async convertToPuzzles(dataScienceData: DataSciencePuzzleData, targetDate: string): Promise<GeneratedPuzzle[]> {
    const themes = Object.keys(dataScienceData);
    const puzzles: GeneratedPuzzle[] = [];
    
    // Group themes into puzzles by size (4x4, 5x5, etc.)
    const puzzleSizes = [4, 5, 6, 7, 8, 9, 10];
    let themeIndex = 0;
    
    for (let sizeIndex = 0; sizeIndex < puzzleSizes.length && themeIndex < themes.length; sizeIndex++) {
      const puzzleSize = puzzleSizes[sizeIndex];
      const puzzleThemes = themes.slice(themeIndex, themeIndex + puzzleSize);
      
      if (puzzleThemes.length === puzzleSize) {
        const puzzle = await this.createPuzzleFromThemes(
          puzzleThemes,
          dataScienceData,
          targetDate,
          sizeIndex + 1,
          puzzleSize
        );
        
        if (puzzle) {
          puzzles.push(puzzle);
          console.log(`✅ Created ${puzzleSize}x${puzzleSize} puzzle with themes: [${puzzleThemes.join(', ')}]`);
        }
        
        themeIndex += puzzleSize;
      }
    }
    
    console.log(`🎲 Generated ${puzzles.length} puzzles from ${themeIndex} themes`);
    return puzzles;
  }

  /**
   * Create a single puzzle from themes
   */
  private async createPuzzleFromThemes(
    themeNames: string[],
    dataScienceData: DataSciencePuzzleData,
    date: string,
    puzzleNumber: number,
    puzzleSize: number
  ): Promise<GeneratedPuzzle | null> {
    const categories: GeneratedCategory[] = [];
    const allWords: string[] = [];
    
    for (let i = 0; i < themeNames.length; i++) {
      const themeName = themeNames[i];
      const themeData = dataScienceData[themeName];
      
      if (!themeData || !themeData.words || themeData.words.length === 0) {
        console.warn(`⚠️ No data found for theme: ${themeName}`);
        return null;
      }
      
      // Create category from theme data
      const category: GeneratedCategory = {
        id: `datasci_cat_${Date.now()}_${i}`,
        themeWord: themeName,
        words: themeData.words,
        difficulty: i + 1, // Progressive difficulty 1-based
        similarity: themeData.theme_similarity_scores.length > 0 
          ? Math.min(...themeData.theme_similarity_scores)
          : 0.7, // Default similarity if not available
        difficultyMetrics: {
          totalNeighbors: themeData.words.length,
          selectedRange: `1-${themeData.words.length} (data science pipeline)`,
          discardedClosest: 0
        }
      };
      
      categories.push(category);
      allWords.push(...themeData.words);
    }
    
    // Calculate overall puzzle metrics
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    const qualityScore = this.calculateQualityScore(categories);
    
    const puzzle: GeneratedPuzzle = {
      id: `datasci_${date}_${puzzleNumber}`,
      date: date,
      puzzleNumber: puzzleNumber,
      gridSize: puzzleSize,
      difficulty: this.calculateDifficulty(categories),
      categories: categories,
      words: this.shuffleArray(allWords),
      metadata: {
        generatedAt: Date.now(),
        avgSimilarity: avgSimilarity,
        qualityScore: qualityScore
      }
    };
    
    return puzzle;
  }

  /**
   * Calculate puzzle difficulty based on categories
   */
  private calculateDifficulty(categories: GeneratedCategory[]): number {
    const avgDifficulty = categories.reduce((sum, cat) => sum + cat.difficulty, 0) / categories.length;
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    const similarityAdjustment = (1 - avgSimilarity) * 2;
    const finalDifficulty = avgDifficulty + similarityAdjustment;
    
    return Math.max(1, Math.min(10, Math.round(finalDifficulty)));
  }

  /**
   * Calculate quality score for puzzle
   */
  private calculateQualityScore(categories: GeneratedCategory[]): number {
    let qualityScore = 0;
    
    // Average similarity (70% weight)
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    qualityScore += avgSimilarity * 0.7;
    
    // Difficulty progression (20% weight)
    const hasGoodProgression = this.checkDifficultyProgression(categories);
    qualityScore += (hasGoodProgression ? 1 : 0.5) * 0.2;
    
    // Word diversity (10% weight)
    const allWords = categories.flatMap(cat => cat.words);
    const wordDiversity = this.calculateWordDiversity(allWords);
    qualityScore += wordDiversity * 0.1;
    
    return Math.max(0, Math.min(1, qualityScore));
  }

  /**
   * Check if categories have good difficulty progression
   */
  private checkDifficultyProgression(categories: GeneratedCategory[]): boolean {
    const difficulties = categories.map(cat => cat.difficulty);
    
    for (let i = 1; i < difficulties.length; i++) {
      if (difficulties[i] < difficulties[i - 1]) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate word diversity score
   */
  private calculateWordDiversity(words: string[]): number {
    const lengths = words.map(word => word.length);
    const uniqueLengths = new Set(lengths);
    const lengthDiversity = uniqueLengths.size / lengths.length;
    
    const allLetters = words.join('').split('');
    const uniqueLetters = new Set(allLetters);
    const letterDiversity = Math.min(1, uniqueLetters.size / 15);
    
    return (lengthDiversity + letterDiversity) / 2;
  }

  /**
   * Convert to Firebase-compatible format
   */
  private convertToFirebaseFormat(convertedOutput: ConvertedPuzzleOutput): Record<string, any> {
    const firebaseData: Record<string, any> = {
      dailyPuzzles: {
        datascience: {
          [convertedOutput.date]: {}
        }
      },
      puzzleIndex: {
        datascience: {
          [convertedOutput.date]: {
            totalCount: convertedOutput.puzzles.length,
            lastUpdated: convertedOutput.metadata.generatedAt,
            status: 'converted_from_datascience',
            generatorVersion: convertedOutput.metadata.generatorVersion,
            originalSource: convertedOutput.metadata.originalSource
          }
        }
      }
    };
    
    // Group puzzles by size
    const puzzlesBySize = convertedOutput.puzzles.reduce((acc, puzzle) => {
      const size = puzzle.gridSize;
      if (!acc[size]) {
        acc[size] = [];
      }
      acc[size].push(puzzle);
      return acc;
    }, {} as Record<number, GeneratedPuzzle[]>);
    
    // Add puzzles organized by size
    Object.entries(puzzlesBySize).forEach(([size, puzzles]) => {
      const sizeKey = `${size}x${size}`;
      firebaseData.dailyPuzzles.datascience[convertedOutput.date][sizeKey] = puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = {
          id: puzzle.id,
          date: puzzle.date,
          puzzleNumber: puzzle.puzzleNumber,
          gridSize: puzzle.gridSize,
          difficulty: puzzle.difficulty,
          words: puzzle.words,
          categories: puzzle.categories.map(cat => ({
            id: cat.id,
            themeWord: cat.themeWord,
            words: cat.words,
            difficulty: cat.difficulty,
            similarity: cat.similarity
          })),
          createdAt: puzzle.metadata.generatedAt,
          metadata: {
            avgSimilarity: puzzle.metadata.avgSimilarity,
            qualityScore: puzzle.metadata.qualityScore,
            generatedBy: 'datascience_bridge_v2.0',
            convertedFromDataScience: true
          }
        };
        return acc;
      }, {} as Record<string, any>);
    });
    
    // Update index with size counts
    const sizeCounts = Object.entries(puzzlesBySize).reduce((acc, [size, puzzles]) => {
      acc[`${size}x${size}`] = puzzles.length;
      return acc;
    }, {} as Record<string, number>);
    
    firebaseData.puzzleIndex.datascience[convertedOutput.date].sizeCounts = sizeCounts;
    firebaseData.puzzleIndex.datascience[convertedOutput.date].availableSizes = Object.keys(puzzlesBySize).map(size => `${size}x${size}`);
    firebaseData.puzzleIndex.datascience[convertedOutput.date].puzzleIds = convertedOutput.puzzles.map(p => p.id);
    
    return firebaseData;
  }

  /**
   * Shuffle array utility
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const inputPath = args[0];
  const outputPath = args[1] || './converted-puzzles.json';
  const targetDate = args[2] || new Date().toISOString().split('T')[0];

  if (!inputPath) {
    console.error('❌ Error: Input path is required');
    printUsage();
    process.exit(1);
  }

  console.log('🌉 Data Science Pipeline Bridge');
  console.log(`📊 Input: ${inputPath}`);
  console.log(`💾 Output: ${outputPath}`);
  console.log(`📅 Target Date: ${targetDate}`);

  try {
    const bridge = new DataScienceBridge();
    const result = await bridge.convertDataScienceOutput(inputPath, outputPath, targetDate);
    
    console.log('\n✨ Conversion Complete!');
    console.log(`🎲 Generated ${result.puzzles.length} puzzles from ${result.metadata.totalThemes} themes`);
    console.log(`📊 Average quality: ${result.puzzles.reduce((sum, p) => sum + p.metadata.qualityScore, 0) / result.puzzles.length}`);
    console.log(`🔥 Firebase format ready for import!`);
    
  } catch (error) {
    console.error('💥 Conversion failed:', (error as Error).message);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
🌉 Data Science Pipeline Bridge - Convert Pipeline Output

Usage:
  npm run bridge [inputPath] [outputPath] [targetDate]

Arguments:
  inputPath        Path to data science pipeline output JSON (required)
  outputPath       Output path for converted puzzles [default: ./converted-puzzles.json]
  targetDate       Target date for puzzles [default: today]

Examples:
  # Convert data science output to puzzle format
  npm run bridge ../datascience/output/final_puzzles.json ./converted-puzzles.json 2025-08-05

  # Convert with default output path and date
  npm run bridge ./final_puzzles.json

Input Format:
  The input should be a JSON file from the data science pipeline with structure:
  {
    "ThemeName": {
      "words": ["word1", "word2", "word3", "word4"],
      "theme_similarity_scores": [0.9, 0.8, 0.7, 0.6],
      "all_candidates": ["word1", "word2", ...],
      "all_similarities": [0.9, 0.8, ...]
    }
  }

Output:
  - Converted puzzles in standard puzzle generation format
  - Firebase-compatible format for database import
  - Puzzle metadata and quality metrics
`);
}

// Add bridge script to exports
export { DataScienceBridge, main as bridgeMain };

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}