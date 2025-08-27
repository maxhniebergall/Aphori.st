#!/usr/bin/env node

/**
 * Data Science Pipeline Bridge
 * Converts the data science pipeline output to the puzzle generation system format
 */

import fs from 'fs/promises';
import path from 'path';
import { GeneratedPuzzle, GeneratedCategory } from './HighQualityPuzzleGenerator.js';

export interface DataSciencePuzzleData {
  [puzzleId: string]: {
    words: string[];
    themes: string[];
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
   * Convert data science puzzles to puzzle categories
   */
  private async convertToPuzzles(dataScienceData: DataSciencePuzzleData, targetDate: string): Promise<GeneratedPuzzle[]> {
    const puzzleKeys = Object.keys(dataScienceData);
    const puzzles: GeneratedPuzzle[] = [];
    
    console.log(`📊 Converting ${puzzleKeys.length} pre-built puzzles from data science output`);
    
    // Each key in dataScienceData is already a complete puzzle (puzzle_1, puzzle_2, etc.)
    for (let i = 0; i < puzzleKeys.length; i++) {
      const puzzleKey = puzzleKeys[i];
      const puzzleData = dataScienceData[puzzleKey];
      
      // Extract the themes and words from the puzzle data
      const themes = puzzleData.themes || [];
      const words = puzzleData.words || [];
      
      if (themes.length !== 4 || words.length !== 16) {
        console.warn(`⚠️ Skipping ${puzzleKey}: expected 4 themes and 16 words, got ${themes.length} themes and ${words.length} words`);
        continue;
      }
      
      const puzzle = await this.createPuzzleFromData(
        themes,
        words,
        targetDate,
        i + 1
      );
      
      if (puzzle) {
        puzzles.push(puzzle);
        console.log(`✅ Converted puzzle ${i + 1}: [${themes.join(', ')}]`);
      }
    }
    
    console.log(`🎲 Converted ${puzzles.length} puzzles`);
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
   * Create a puzzle from pre-organized themes and words
   */
  private async createPuzzleFromData(
    themes: string[],
    words: string[],
    date: string,
    puzzleNumber: number
  ): Promise<GeneratedPuzzle | null> {
    const categories: GeneratedCategory[] = [];
    
    // Split the 16 words into 4 groups of 4 (one per theme)
    for (let i = 0; i < themes.length; i++) {
      const startIdx = i * 4;
      const themeWords = words.slice(startIdx, startIdx + 4);
      
      if (themeWords.length !== 4) {
        console.warn(`⚠️ Theme ${themes[i]} has ${themeWords.length} words instead of 4`);
        return null;
      }
      
      const category: GeneratedCategory = {
        id: `gemini_cat_${Date.now()}_${i}`,
        themeWord: themes[i],
        words: themeWords,
        difficulty: i + 1, // Progressive difficulty 1-based
        similarity: 0.85, // Default high similarity for Gemini-generated themes
        difficultyMetrics: {
          totalNeighbors: 4,
          frequencyThreshold: 0.05,
          discardedClosest: 0,
          selectedRange: "1-4 (closest neighbors)"
        }
      };
      
      categories.push(category);
    }
    
    const difficulty = this.calculateDifficulty(categories);
    const qualityScore = this.calculateQualityScore(categories);
    
    const puzzle: GeneratedPuzzle = {
      id: `gemini_puzzle_${date}_${puzzleNumber}`,
      date: date,
      puzzleNumber: puzzleNumber,
      difficulty: difficulty,
      gridSize: 4, // Always 4x4
      categories: categories,
      words: this.shuffleArray([...words]), // Shuffle all words for the puzzle
      metadata: {
        generatedAt: Date.now(),
        avgSimilarity: 0.85,
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
    const setName = `datascience_${convertedOutput.date}`;
    
    const firebaseData: Record<string, any> = {
      puzzleSets: {
        [setName]: {}
      },
      setIndex: {
        [setName]: {
          totalCount: convertedOutput.puzzles.length,
          lastUpdated: convertedOutput.metadata.generatedAt,
          status: 'active',
          generatorVersion: convertedOutput.metadata.generatorVersion,
          algorithm: 'datascience_pipeline',
          availableSizes: [],
          sizeCounts: {},
          puzzleIds: [],
          metadata: {
            batchGenerated: true,
            description: `Data science pipeline puzzles for ${convertedOutput.date}`,
            generatedAt: new Date(convertedOutput.metadata.generatedAt).toISOString(),
            originalSource: convertedOutput.metadata.originalSource,
            convertedFromDataScience: true
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
    
    // Add puzzles organized by size to puzzleSets
    const puzzleIds: string[] = [];
    const sizeCounts: Record<string, number> = {};
    const availableSizes: string[] = [];
    
    Object.entries(puzzlesBySize).forEach(([size, puzzles]) => {
      const sizeKey = `${size}x${size}`;
      firebaseData.puzzleSets[setName][sizeKey] = puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = {
          id: puzzle.id,
          setName: setName,
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
            algorithm: 'datascience_pipeline',
            batchGenerated: true
          }
        };
        puzzleIds.push(puzzle.id);
        return acc;
      }, {} as Record<string, any>);
      
      sizeCounts[sizeKey] = puzzles.length;
      availableSizes.push(sizeKey);
    });
    
    // Update setIndex with complete information
    firebaseData.setIndex[setName].sizeCounts = sizeCounts;
    firebaseData.setIndex[setName].availableSizes = availableSizes.sort();
    firebaseData.setIndex[setName].puzzleIds = puzzleIds.sort((a, b) => {
      const na = parseInt(a.split('_').pop() ?? '0', 10);
      const nb = parseInt(b.split('_').pop() ?? '0', 10);
      return na - nb || a.localeCompare(b);
    });
    
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
    "puzzle_1": {
      "themes": ["Space", "Sailing", "Clothing", "Music"],
      "words": ["orbit", "comet", "navy", "mast", "sock", "blazer", "lyre", "sonata", "...8 more"],
      "theme_similarity_scores": [0.92, 0.88, 0.85, 0.87],
      "all_candidates": ["..."],
      "all_similarities": ["..."]
    },
    "puzzle_2": { "..." }
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