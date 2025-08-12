#!/usr/bin/env node
/**
 * Parallel Frequency Data Lemmatization
 * Uses worker threads to process frequency data across multiple CPUs
 */

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import os from 'os';

// Simple console logger
const logger = {
  info: console.log,
  debug: console.debug,
  warn: console.warn,
  error: console.error
};

interface WorkerResult {
  workerId: number;
  processedEntries: Array<{
    canonicalForm: string;
    totalCount: number;
    originalWords: string[];
  }>;
  errorCount: number;
}

async function lemmatizeFrequencyDataParallel() {
  console.log('🚀 Starting PARALLEL frequency data lemmatization...\n');

  try {
    // Find input CSV file
    const possiblePaths = [
      path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data/unigram_freq.csv'),
      path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data/unigram_freq.csv'),
      path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data/unigram_freq.csv'),
      path.resolve(process.cwd(), '../datascience/themes_quality/data/unigram_freq.csv'),
    ];
    
    let csvPath: string | null = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        csvPath = testPath;
        break;
      }
    }
    
    if (!csvPath) {
      const pathsStr = possiblePaths.join('\n  - ');
      throw new Error(`Frequency data file not found. Tried:\n  - ${pathsStr}`);
    }
    
    console.log(`📂 Reading frequency data from: ${csvPath}`);
    const outputPath = csvPath.replace('unigram_freq.csv', 'unigram_freq_lemmatized.csv');
    console.log(`📝 Output will be written to: ${outputPath}\n`);

    // Read and prepare data
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n');
    const dataLines = lines.slice(1).filter(line => line.trim());
    
    console.log(`📊 Processing ${dataLines.length} entries...`);
    
    // Use exactly 4 workers as requested
    const maxWorkers = 4;
    const chunkSize = Math.ceil(dataLines.length / maxWorkers);
    
    console.log(`🔧 Using ${maxWorkers} workers`);
    console.log(`📦 Chunk size: ${chunkSize} entries per worker\n`);

    // Split data into chunks
    const chunks: string[][] = [];
    for (let i = 0; i < dataLines.length; i += chunkSize) {
      chunks.push(dataLines.slice(i, i + chunkSize));
    }
    
    console.log(`📋 Created ${chunks.length} chunks for parallel processing`);

    // Create workers and process chunks
    const workers: Promise<WorkerResult>[] = [];
    const startTime = Date.now();
    
    for (let i = 0; i < chunks.length; i++) {
      const workerPromise = createWorker(i, chunks[i]);
      workers.push(workerPromise);
      console.log(`🚀 Started worker ${i + 1}/${chunks.length} with ${chunks[i].length} entries`);
    }

    // Wait for all workers to complete
    console.log(`\n⏳ Waiting for ${workers.length} workers to complete...\n`);
    const results = await Promise.all(workers);
    const processingTime = Date.now() - startTime;
    
    console.log(`\n✅ All workers completed in ${(processingTime / 1000).toFixed(1)}s\n`);

    // Merge results from all workers
    console.log('🔄 Merging results from all workers...');
    const mergedMap = new Map<string, {
      canonicalForm: string;
      totalCount: number;
      originalWords: string[];
    }>();

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const result of results) {
      totalProcessed += result.processedEntries.length;
      totalErrors += result.errorCount;
      
      console.log(`   Worker ${result.workerId + 1}: ${result.processedEntries.length} processed, ${result.errorCount} errors`);
      
      for (const entry of result.processedEntries) {
        if (mergedMap.has(entry.canonicalForm)) {
          const existing = mergedMap.get(entry.canonicalForm)!;
          existing.totalCount += entry.totalCount;
          // Merge original words (avoid duplicates)
          for (const word of entry.originalWords) {
            if (!existing.originalWords.includes(word)) {
              existing.originalWords.push(word);
            }
          }
        } else {
          mergedMap.set(entry.canonicalForm, { ...entry });
        }
      }
    }

    // Create output data
    const outputEntries = Array.from(mergedMap.values())
      .sort((a, b) => b.totalCount - a.totalCount); // Sort by frequency descending

    console.log(`\n📈 Parallel Processing Results:`);
    console.log(`   Original entries: ${dataLines.length}`);
    console.log(`   Processed entries: ${totalProcessed}`);
    console.log(`   Processing errors: ${totalErrors}`);
    console.log(`   Lemmatized entries: ${outputEntries.length}`);
    console.log(`   Reduction: ${((dataLines.length - outputEntries.length) / dataLines.length * 100).toFixed(1)}%`);
    console.log(`   Processing time: ${(processingTime / 1000).toFixed(1)}s`);
    console.log(`   Speed: ${Math.round(dataLines.length / (processingTime / 1000))} entries/sec`);
    
    // Show some examples of aggregation
    console.log(`\n🔗 Examples of word aggregation:`);
    const exampleAggregations = outputEntries
      .filter(entry => entry.originalWords.length > 1)
      .slice(0, 10);
      
    for (const example of exampleAggregations) {
      console.log(`   "${example.canonicalForm}": ${example.originalWords.join(', ')} → ${example.totalCount}`);
    }

    // Write output CSV
    console.log(`\n💾 Writing lemmatized data...`);
    const outputLines = ['word,count'];
    
    for (const entry of outputEntries) {
      outputLines.push(`${entry.canonicalForm},${entry.totalCount}`);
    }
    
    fs.writeFileSync(outputPath, outputLines.join('\n'));
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Parallel lemmatized frequency data written to: ${outputPath}`);
    console.log(`📊 Final dataset: ${outputEntries.length} canonical words`);
    console.log(`⚡ Total time: ${(totalTime / 1000).toFixed(1)}s (${maxWorkers}× speedup)`);
    
    // Show top words
    console.log(`\n🏆 Top 20 most frequent lemmatized words:`);
    for (let i = 0; i < Math.min(20, outputEntries.length); i++) {
      const entry = outputEntries[i];
      console.log(`   ${i + 1}. "${entry.canonicalForm}" (${entry.totalCount})`);
    }

  } catch (error) {
    console.error('❌ Parallel lemmatization failed:', error);
    process.exit(1);
  }
}

/**
 * Create a worker to process a chunk of data
 */
function createWorker(workerId: number, dataChunk: string[]): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    // Create worker script inline
    const workerScript = `
      import { parentPort } from 'worker_threads';
      import { SpellCheckService } from './dist/SpellCheckService.js';

      /**
       * Check if a word is suitable for themes game
       */
      function isWordSuitableForThemes(word) {
        if (!word || typeof word !== 'string') return false;
        
        const cleaned = word.toLowerCase().trim();
        
        // Length requirements
        if (cleaned.length < 3 || cleaned.length > 15) return false;
        
        // Only letters (no numbers, punctuation, or special characters)
        if (!/^[a-z]+$/.test(cleaned)) return false;
        
        // Exclude inappropriate words
        const excludeWords = new Set([
          'sex', 'porn', 'nude', 'naked', 'xxx', 'gay', 'lesbian', 'anal', 'oral', 'pussy', 'cum',
          'rape', 'incest', 'fuck', 'fucking', 'shit', 'ass', 'milf', 'mature', 'hardcore',
          'drug', 'kill', 'death', 'hate', 'racist', 'nazi', 'dead'
        ]);
        
        if (excludeWords.has(cleaned)) return false;
        
        // Exclude very technical terms, abbreviations, and non-dictionary words
        if (cleaned.length <= 3 && /^[a-z]{1,3}$/.test(cleaned)) {
          const allowedShort = new Set(['the', 'and', 'you', 'are', 'for', 'can', 'not', 'but', 'all', 'get', 'has', 'had', 'him', 'her', 'how', 'man', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'car', 'day', 'eye', 'far', 'got', 'run', 'sat', 'sun', 'top', 'try', 'win', 'yes', 'yet', 'ago', 'air', 'ask', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'buy', 'car', 'cat', 'cup', 'cut', 'die', 'dog', 'eat', 'end', 'eye', 'far', 'few', 'fit', 'fly', 'fun', 'gas', 'god', 'got', 'gun', 'guy', 'hit', 'hot', 'ice', 'job', 'key', 'kid', 'law', 'lay', 'leg', 'let', 'lie', 'lot', 'low', 'man', 'map', 'may', 'mom', 'net', 'new', 'nor', 'not', 'now', 'odd', 'off', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'per', 'put', 'raw', 'red', 'run', 'sad', 'sat', 'say', 'sea', 'see', 'set', 'she', 'sit', 'six', 'sky', 'son', 'sun', 'tax', 'ten', 'the', 'tie', 'tip', 'too', 'top', 'try', 'two', 'use', 'van', 'war', 'was', 'way', 'web', 'who', 'why', 'win', 'won', 'yes', 'yet', 'you', 'zoo']);
          return allowedShort.has(cleaned);
        }
        
        return true;
      }

      async function processChunk(workerId, dataChunk) {
        try {
          // Initialize spell checker
          const spellCheckService = new SpellCheckService();
          await spellCheckService.initialize();
          
          const processedEntries = new Map();
          let errorCount = 0;
          let processedCount = 0;
          
          for (const line of dataChunk) {
            try {
              const [word, countStr] = line.split(',');
              if (!word || !countStr) continue;
              
              const count = parseInt(countStr, 10);
              if (isNaN(count) || count <= 0) continue;
              
              const cleanWord = word.toLowerCase().trim();
              if (!isWordSuitableForThemes(cleanWord)) continue;
              
              // Get canonical form
              const canonicalForm = spellCheckService.getCanonicalForm(cleanWord);
              
              // Skip if canonical form became unsuitable
              if (!isWordSuitableForThemes(canonicalForm)) continue;
              
              // Aggregate counts
              if (processedEntries.has(canonicalForm)) {
                const existing = processedEntries.get(canonicalForm);
                existing.totalCount += count;
                if (!existing.originalWords.includes(cleanWord)) {
                  existing.originalWords.push(cleanWord);
                }
              } else {
                processedEntries.set(canonicalForm, {
                  canonicalForm,
                  totalCount: count,
                  originalWords: [cleanWord]
                });
              }
              
              processedCount++;
              
              // Progress report every 1000 entries
              if (processedCount % 1000 === 0) {
                parentPort.postMessage({
                  type: 'progress',
                  workerId,
                  processed: processedCount,
                  total: dataChunk.length
                });
              }
              
            } catch (error) {
              errorCount++;
            }
          }
          
          // Convert map to array
          const resultArray = Array.from(processedEntries.values());
          
          parentPort.postMessage({
            type: 'complete',
            result: {
              workerId,
              processedEntries: resultArray,
              errorCount
            }
          });
          
        } catch (error) {
          parentPort.postMessage({
            type: 'error',
            error: error.message
          });
        }
      }

      // Start processing when we receive data
      parentPort.on('message', (data) => {
        if (data.type === 'start') {
          processChunk(data.workerId, data.dataChunk);
        }
      });
    `;

    // Write worker script to temporary file
    const workerPath = path.join(process.cwd(), `worker-${workerId}.mjs`);
    fs.writeFileSync(workerPath, workerScript);

    const worker = new Worker(workerPath);
    
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        const progress = ((message.processed / message.total) * 100).toFixed(1);
        process.stdout.write(`\r   Worker ${message.workerId + 1}: ${progress}% (${message.processed}/${message.total})`);
      } else if (message.type === 'complete') {
        console.log(`\n   ✅ Worker ${message.result.workerId + 1} completed`);
        // Clean up worker file
        fs.unlinkSync(workerPath);
        resolve(message.result);
      } else if (message.type === 'error') {
        console.error(`\n   ❌ Worker ${workerId + 1} error:`, message.error);
        fs.unlinkSync(workerPath);
        reject(new Error(message.error));
      }
    });

    worker.on('error', (error) => {
      console.error(`\n   ❌ Worker ${workerId + 1} thread error:`, error);
      if (fs.existsSync(workerPath)) fs.unlinkSync(workerPath);
      reject(error);
    });

    // Start the worker
    worker.postMessage({
      type: 'start',
      workerId,
      dataChunk
    });
  });
}

// Run the parallel script
lemmatizeFrequencyDataParallel().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});