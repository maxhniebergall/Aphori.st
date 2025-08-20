#!/usr/bin/env node
/**
 * Firebase Format Converter
 * Converts puzzle outputs from both algorithms to unified Firebase format
 */
import fs from 'fs/promises';
import path from 'path';
class FirebaseFormatConverter {
    /**
     * Convert puzzle batch to Firebase format with named sets
     */
    async convertBatchToFirebase(batchPath, algorithm, outputPath, setName) {
        console.log(`🔄 Converting ${algorithm} batch to Firebase format...`);
        const puzzlesPath = path.join(batchPath, 'puzzles.json');
        const puzzlesData = await fs.readFile(puzzlesPath, 'utf-8');
        const rawPuzzles = JSON.parse(puzzlesData);
        // Handle different input formats
        const puzzleList = this.extractPuzzleList(rawPuzzles, algorithm);
        console.log(`📊 Converting ${puzzleList.length} puzzles to Firebase format`);
        // Generate set name if not provided
        const algorithmName = algorithm === 'wiki_puzzle_pipeline' ? 'wiki' : 'gemini';
        const finalSetName = setName || `${algorithmName}_batch_${new Date().toISOString().split('T')[0]}`;
        // Convert puzzles to Firebase format
        const firebasePuzzles = {};
        const puzzleIds = [];
        for (let i = 0; i < puzzleList.length; i++) {
            const puzzle = puzzleList[i];
            const firebasePuzzle = await this.convertSinglePuzzle(puzzle, algorithm, finalSetName, i + 1);
            firebasePuzzles[firebasePuzzle.id] = firebasePuzzle;
            puzzleIds.push(firebasePuzzle.id);
        }
        // Create Firebase output structure with named sets
        const firebaseOutput = {
            puzzleSets: {
                [finalSetName]: {
                    "4x4": firebasePuzzles
                }
            },
            setIndex: {
                [finalSetName]: {
                    totalCount: puzzleList.length,
                    lastUpdated: Date.now(),
                    status: `active`,
                    generatorVersion: "3.0.0-batch",
                    algorithm: algorithm,
                    sizeCounts: { "4x4": puzzleList.length },
                    availableSizes: ["4x4"],
                    puzzleIds: puzzleIds,
                    metadata: {
                        batchGenerated: true,
                        generatedAt: new Date().toISOString(),
                        targetCount: 100,
                        description: `Batch-generated 4x4 puzzles using ${algorithm}`
                    }
                }
            }
        };
        // Save Firebase format
        await fs.writeFile(outputPath, JSON.stringify(firebaseOutput, null, 2));
        console.log(`💾 Firebase format saved to: ${outputPath}`);
        return firebaseOutput;
    }
    /**
     * Extract puzzle list from different algorithm formats
     */
    extractPuzzleList(rawPuzzles, algorithm) {
        if (algorithm === 'wiki_puzzle_pipeline') {
            // Wiki pipeline format: { puzzles: [...], total_count: N }
            if (rawPuzzles.puzzles && Array.isArray(rawPuzzles.puzzles)) {
                return rawPuzzles.puzzles;
            }
            throw new Error('Wiki pipeline: Expected puzzles array in data');
        }
        else if (algorithm === 'wiki_puzzle_gemini_pipeline') {
            // Gemini pipeline format: { theme1: {...}, theme2: {...} }
            if (typeof rawPuzzles === 'object' && !Array.isArray(rawPuzzles)) {
                return Object.values(rawPuzzles);
            }
            throw new Error('Gemini pipeline: Expected object with theme keys');
        }
        else {
            throw new Error(`Unknown algorithm: ${algorithm}`);
        }
    }
    /**
     * Convert a single puzzle to Firebase format
     */
    async convertSinglePuzzle(puzzle, algorithm, setName, puzzleNumber) {
        const timestamp = Date.now();
        const algorithmName = algorithm === 'wiki_puzzle_pipeline' ? 'wiki' : 'gemini';
        const puzzleId = `${setName}_${puzzleNumber}`;
        if (algorithm === 'wiki_puzzle_pipeline') {
            return this.convertWikiPuzzle(puzzle, puzzleId, setName, puzzleNumber, timestamp);
        }
        else if (algorithm === 'wiki_puzzle_gemini_pipeline') {
            return this.convertGeminiPuzzle(puzzle, puzzleId, setName, puzzleNumber, timestamp);
        }
        else {
            throw new Error(`Unknown algorithm: ${algorithm}`);
        }
    }
    /**
     * Convert wiki pipeline puzzle to Firebase format
     */
    convertWikiPuzzle(puzzle, puzzleId, setName, puzzleNumber, timestamp) {
        // Wiki pipeline now produces 4x4 format: { id, categories: [...], words: [...] }
        if (!puzzle.categories || !Array.isArray(puzzle.categories) || puzzle.categories.length !== 4) {
            throw new Error(`Wiki puzzle ${puzzleId} must have exactly 4 categories, got ${puzzle.categories?.length || 0}`);
        }
        if (!puzzle.words || !Array.isArray(puzzle.words) || puzzle.words.length !== 16) {
            throw new Error(`Wiki puzzle ${puzzleId} must have exactly 16 words, got ${puzzle.words?.length || 0}`);
        }
        const categories = [];
        let overallSimilarities = [];
        // Convert each category from the puzzle
        for (let i = 0; i < 4; i++) {
            const category = puzzle.categories[i];
            if (!category.words || category.words.length !== 4) {
                throw new Error(`Category ${i} in puzzle ${puzzleId} must have exactly 4 words, got ${category.words?.length || 0}`);
            }
            const similarities = category.similarity_scores || [];
            overallSimilarities.push(...similarities);
            categories.push({
                id: `${puzzleId}_cat_${i}`,
                themeWord: category.theme,
                words: category.words,
                difficulty: i + 1,
                similarity: category.average_similarity || 0.7
            });
        }
        const avgSimilarity = overallSimilarities.length > 0 ?
            overallSimilarities.reduce((a, b) => a + b, 0) / overallSimilarities.length : 0.7;
        return {
            id: puzzleId,
            setName: setName,
            puzzleNumber,
            gridSize: 4,
            difficulty: Math.ceil(avgSimilarity * 4) + 1,
            words: puzzle.words,
            categories,
            createdAt: timestamp,
            metadata: {
                avgSimilarity,
                qualityScore: avgSimilarity,
                generatedBy: "wiki_pipeline_batch_v4.0",
                algorithm: "wiki_puzzle_pipeline",
                batchGenerated: true
            }
        };
    }
    /**
     * Convert Gemini pipeline puzzle to Firebase format
     */
    convertGeminiPuzzle(puzzle, puzzleId, setName, puzzleNumber, timestamp) {
        // Gemini pipeline should now produce 4x4 format with exactly 16 words
        const words = puzzle.words || [];
        const similarities = puzzle.theme_similarity_scores || [];
        if (words.length !== 16) {
            throw new Error(`Gemini puzzle ${puzzleId} must have exactly 16 words, got ${words.length}`);
        }
        // Create 4 categories from the 16 words (4 words each)
        const categories = [];
        for (let i = 0; i < 4; i++) {
            const startIdx = i * 4;
            const categoryWords = words.slice(startIdx, startIdx + 4);
            if (categoryWords.length !== 4) {
                throw new Error(`Category ${i} in Gemini puzzle ${puzzleId} must have exactly 4 words, got ${categoryWords.length}`);
            }
            const categorySimilarities = similarities.slice(startIdx, startIdx + 4);
            const avgCategorySimilarity = categorySimilarities.length > 0 ?
                categorySimilarities.reduce((a, b) => a + b, 0) / categorySimilarities.length : 0.8;
            categories.push({
                id: `${puzzleId}_cat_${i}`,
                themeWord: `Theme ${i + 1}`, // Gemini format doesn't provide theme names currently
                words: categoryWords,
                difficulty: i + 1,
                similarity: avgCategorySimilarity
            });
        }
        const avgSimilarity = similarities.length > 0 ?
            similarities.reduce((a, b) => a + b, 0) / similarities.length : 0.8;
        return {
            id: puzzleId,
            setName: setName,
            puzzleNumber,
            gridSize: 4,
            difficulty: Math.ceil(avgSimilarity * 4) + 1,
            words: words,
            categories,
            createdAt: timestamp,
            metadata: {
                avgSimilarity,
                qualityScore: avgSimilarity,
                generatedBy: "gemini_pipeline_batch_v4.0",
                algorithm: "wiki_puzzle_gemini_pipeline",
                batchGenerated: true
            }
        };
    }
    /**
     * Convert both batches and merge into single Firebase output
     */
    async convertBothBatches(wikiBatchPath, geminiBatchPath, outputPath, wikiSetName, geminiSetName) {
        console.log(`🔄 Converting both batches to unified Firebase format...`);
        const dateStamp = new Date().toISOString().split('T')[0];
        const finalWikiSetName = wikiSetName || `wiki_batch_${dateStamp}`;
        const finalGeminiSetName = geminiSetName || `gemini_batch_${dateStamp}`;
        // Convert wiki batch
        const wikiOutputPath = path.join(path.dirname(outputPath), 'wiki_firebase.json');
        const wikiOutput = await this.convertBatchToFirebase(wikiBatchPath, 'wiki_puzzle_pipeline', wikiOutputPath, finalWikiSetName);
        // Convert gemini batch
        const geminiOutputPath = path.join(path.dirname(outputPath), 'gemini_firebase.json');
        const geminiOutput = await this.convertBatchToFirebase(geminiBatchPath, 'wiki_puzzle_gemini_pipeline', geminiOutputPath, finalGeminiSetName);
        // Merge both outputs
        const mergedOutput = {
            puzzleSets: {
                ...wikiOutput.puzzleSets,
                ...geminiOutput.puzzleSets
            },
            setIndex: {
                ...wikiOutput.setIndex,
                ...geminiOutput.setIndex
            }
        };
        // Save merged output
        await fs.writeFile(outputPath, JSON.stringify(mergedOutput, null, 2));
        console.log(`🎯 Unified Firebase format saved to: ${outputPath}`);
        // Create summary
        const summary = {
            generatedAt: new Date().toISOString(),
            dateStamp,
            sets: {
                wiki: {
                    setName: finalWikiSetName,
                    puzzleCount: Object.keys(wikiOutput.puzzleSets[finalWikiSetName]["4x4"]).length,
                    outputFile: wikiOutputPath
                },
                gemini: {
                    setName: finalGeminiSetName,
                    puzzleCount: Object.keys(geminiOutput.puzzleSets[finalGeminiSetName]["4x4"]).length,
                    outputFile: geminiOutputPath
                }
            },
            merged: {
                totalPuzzles: Object.keys(wikiOutput.puzzleSets[finalWikiSetName]["4x4"]).length +
                    Object.keys(geminiOutput.puzzleSets[finalGeminiSetName]["4x4"]).length,
                outputFile: outputPath,
                setNames: [finalWikiSetName, finalGeminiSetName]
            }
        };
        const summaryPath = path.join(path.dirname(outputPath), 'firebase-conversion-summary.json');
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
        console.log(`📋 Conversion summary saved to: ${summaryPath}`);
    }
}
async function main() {
    const args = process.argv.slice(2);
    const batchDir = args[0] || './batch-output';
    const wikiSetName = args[1]; // Optional custom wiki set name
    const geminiSetName = args[2]; // Optional custom gemini set name
    console.log(`🎯 Firebase Format Converter`);
    console.log(`📁 Batch directory: ${batchDir}`);
    if (wikiSetName)
        console.log(`🏷️  Wiki set name: ${wikiSetName}`);
    if (geminiSetName)
        console.log(`🏷️  Gemini set name: ${geminiSetName}`);
    const converter = new FirebaseFormatConverter();
    try {
        const wikiBatchPath = path.join(batchDir, 'set1-wiki-pipeline');
        const geminiBatchPath = path.join(batchDir, 'set2-gemini-pipeline');
        const outputPath = path.join(batchDir, 'unified-firebase-puzzles.json');
        await converter.convertBothBatches(wikiBatchPath, geminiBatchPath, outputPath, wikiSetName, geminiSetName);
        console.log(`✅ Firebase conversion completed successfully`);
        console.log(`📁 Unified output: ${outputPath}`);
    }
    catch (error) {
        console.error(`❌ Firebase conversion failed: ${error}`);
        process.exit(1);
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
export { FirebaseFormatConverter };
