#!/usr/bin/env node
/**
 * Parallel Vector Data Lemmatization
 * Uses worker threads to process vector data across multiple CPUs
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

interface VectorMetadata {
  num_vectors: number;
  dimension: number;
  created_at: string;
  source?: string;
}

interface WorkerResult {
  workerId: number;
  processedMappings: Array<{
    canonicalForm: string;
    originalIndices: number[];
    originalWords: string[];
  }>;
  errorCount: number;
}

async function lemmatizeVectorDataParallel() {
  console.log('🚀 Starting PARALLEL vector data lemmatization...\n');

  try {
    // Find input files
    const possibleBasePaths = [
      path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '../datascience/themes_quality/data'),
    ];
    
    let dataPath: string | null = null;
    let vocabPath: string | null = null;
    let vectorsPath: string | null = null;
    let metadataPath: string | null = null;
    
    for (const basePath of possibleBasePaths) {
      const testVocabPath = path.join(basePath, 'themes_vocabulary.json');
      const testVectorsPath = path.join(basePath, 'themes_vectors.bin');
      const testMetadataPath = path.join(basePath, 'themes_metadata.json');
      
      if (fs.existsSync(testVocabPath) && fs.existsSync(testVectorsPath) && fs.existsSync(testMetadataPath)) {
        dataPath = basePath;
        vocabPath = testVocabPath;
        vectorsPath = testVectorsPath;
        metadataPath = testMetadataPath;
        break;
      }
    }
    
    if (!dataPath || !vocabPath || !vectorsPath || !metadataPath) {
      const pathsStr = possibleBasePaths.join('\n  - ');
      throw new Error(`Vector data files not found. Tried:\n  - ${pathsStr}`);
    }
    
    console.log(`📂 Reading vector data from: ${dataPath}`);
    
    // Set output paths
    const outputVocabPath = path.join(dataPath, 'themes_vocabulary_lemmatized.json');
    const outputVectorPath = path.join(dataPath, 'themes_vectors_lemmatized.bin');
    const outputMetadataPath = path.join(dataPath, 'themes_metadata_lemmatized.json');
    
    console.log(`📝 Output files:`);
    console.log(`   Vocabulary: ${outputVocabPath}`);
    console.log(`   Vectors: ${outputVectorPath}`);
    console.log(`   Metadata: ${outputMetadataPath}\n`);

    // Load metadata
    console.log('📊 Loading metadata...');
    const metadataContent = fs.readFileSync(metadataPath, 'utf8');
    const metadata: VectorMetadata = JSON.parse(metadataContent);
    console.log(`   Original vectors: ${metadata.num_vectors}`);
    console.log(`   Vector dimension: ${metadata.dimension}`);

    // Load vocabulary
    console.log('📚 Loading vocabulary...');
    const vocabContent = fs.readFileSync(vocabPath, 'utf8');
    const originalVocabulary: string[] = JSON.parse(vocabContent);
    console.log(`   Original vocabulary size: ${originalVocabulary.length}`);

    // Validate binary file
    console.log('🔢 Validating vector binary data...');
    const vectorBuffer = fs.readFileSync(vectorsPath);
    const headerSize = 8;
    const numVectors = vectorBuffer.readUInt32LE(0);
    const dimension = vectorBuffer.readUInt32LE(4);
    
    if (numVectors !== originalVocabulary.length || dimension !== metadata.dimension) {
      throw new Error(`Data mismatch: vocab=${originalVocabulary.length}, binary=${numVectors}, dim=${dimension}`);
    }

    // Use exactly 4 workers as requested
    const maxWorkers = 4;
    const chunkSize = Math.ceil(originalVocabulary.length / maxWorkers);
    
    console.log(`\n🔧 Using ${maxWorkers} workers`);
    console.log(`📦 Chunk size: ${chunkSize} words per worker\n`);

    // Split vocabulary into chunks with their indices
    const chunks: Array<{ startIdx: number; words: Array<{ index: number; word: string }> }> = [];
    for (let i = 0; i < originalVocabulary.length; i += chunkSize) {
      const endIdx = Math.min(i + chunkSize, originalVocabulary.length);
      const wordsChunk = originalVocabulary.slice(i, endIdx).map((word, localIdx) => ({
        index: i + localIdx,
        word: word
      }));
      chunks.push({ startIdx: i, words: wordsChunk });
    }
    
    console.log(`📋 Created ${chunks.length} chunks for parallel processing`);

    // Process chunks in parallel
    const workers: Promise<WorkerResult>[] = [];
    const startTime = Date.now();
    
    for (let i = 0; i < chunks.length; i++) {
      const workerPromise = createVectorWorker(i, chunks[i]);
      workers.push(workerPromise);
      console.log(`🚀 Started worker ${i + 1}/${chunks.length} with ${chunks[i].words.length} words`);
    }

    // Wait for all workers to complete
    console.log(`\n⏳ Waiting for ${workers.length} workers to complete...\n`);
    const results = await Promise.all(workers);
    const processingTime = Date.now() - startTime;
    
    console.log(`\n✅ All workers completed in ${(processingTime / 1000).toFixed(1)}s\n`);

    // Merge results from all workers
    console.log('🔄 Merging results from all workers...');
    const mergedMappings = new Map<string, {
      canonicalForm: string;
      originalIndices: number[];
      originalWords: string[];
    }>();

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const result of results) {
      totalProcessed += result.processedMappings.length;
      totalErrors += result.errorCount;
      
      console.log(`   Worker ${result.workerId + 1}: ${result.processedMappings.length} processed, ${result.errorCount} errors`);
      
      for (const mapping of result.processedMappings) {
        if (mergedMappings.has(mapping.canonicalForm)) {
          const existing = mergedMappings.get(mapping.canonicalForm)!;
          existing.originalIndices.push(...mapping.originalIndices);
          // Merge original words (avoid duplicates)
          for (const word of mapping.originalWords) {
            if (!existing.originalWords.includes(word)) {
              existing.originalWords.push(word);
            }
          }
        } else {
          mergedMappings.set(mapping.canonicalForm, { ...mapping });
        }
      }
    }

    console.log(`\n📈 Parallel Processing Results:`);
    console.log(`   Original vocabulary: ${originalVocabulary.length}`);
    console.log(`   Processed words: ${totalProcessed}`);
    console.log(`   Processing errors: ${totalErrors}`);
    console.log(`   Lemmatized vocabulary: ${mergedMappings.size}`);
    console.log(`   Reduction: ${((originalVocabulary.length - mergedMappings.size) / originalVocabulary.length * 100).toFixed(1)}%`);
    console.log(`   Processing time: ${(processingTime / 1000).toFixed(1)}s`);
    console.log(`   Speed: ${Math.round(originalVocabulary.length / (processingTime / 1000))} words/sec`);
    
    // Show aggregation examples
    console.log(`\n🔗 Examples of word aggregation:`);
    const exampleAggregations = Array.from(mergedMappings.values())
      .filter(entry => entry.originalWords.length > 1)
      .slice(0, 10);
      
    for (const example of exampleAggregations) {
      console.log(`   "${example.canonicalForm}": ${example.originalWords.join(', ')}`);
    }

    // Extract vectors for lemmatized words
    console.log(`\n🔢 Extracting and averaging vectors...`);
    const lemmatizedVocabulary: string[] = [];
    const lemmatizedVectors: Float32Array[] = [];
    
    let vectorProcessed = 0;
    const vectorProgressInterval = Math.floor(mergedMappings.size / 20);
    
    for (const [canonicalForm, mapping] of mergedMappings.entries()) {
      lemmatizedVocabulary.push(canonicalForm);
      
      if (mapping.originalIndices.length === 1) {
        // Single word - extract its vector directly
        const idx = mapping.originalIndices[0];
        const vectorStart = headerSize + idx * dimension * 4;
        const vectorData = new Float32Array(vectorBuffer.buffer, vectorStart, dimension);
        lemmatizedVectors.push(new Float32Array(vectorData));
      } else {
        // Multiple words - average their vectors
        const averageVector = new Float32Array(dimension);
        
        for (const idx of mapping.originalIndices) {
          const vectorStart = headerSize + idx * dimension * 4;
          const vectorData = new Float32Array(vectorBuffer.buffer, vectorStart, dimension);
          
          for (let j = 0; j < dimension; j++) {
            averageVector[j] += vectorData[j];
          }
        }
        
        // Divide by count to get average
        for (let j = 0; j < dimension; j++) {
          averageVector[j] /= mapping.originalIndices.length;
        }
        
        lemmatizedVectors.push(averageVector);
      }
      
      vectorProcessed++;
      if (vectorProcessed % vectorProgressInterval === 0) {
        const progress = ((vectorProcessed / mergedMappings.size) * 100).toFixed(1);
        console.log(`   📈 Vector processing: ${progress}% (${vectorProcessed}/${mergedMappings.size})`);
      }
    }

    // Write output files
    console.log(`\n💾 Writing lemmatized data...`);
    
    // 1. Write vocabulary
    console.log('   📚 Writing vocabulary...');
    fs.writeFileSync(outputVocabPath, JSON.stringify(lemmatizedVocabulary, null, 2));
    
    // 2. Write binary vectors
    console.log('   🔢 Writing binary vectors...');
    const outputVectorBuffer = Buffer.allocUnsafe(8 + lemmatizedVectors.length * dimension * 4);
    
    // Write header
    outputVectorBuffer.writeUInt32LE(lemmatizedVectors.length, 0);
    outputVectorBuffer.writeUInt32LE(dimension, 4);
    
    // Write vectors
    let bufferOffset = 8;
    for (const vector of lemmatizedVectors) {
      for (let j = 0; j < dimension; j++) {
        outputVectorBuffer.writeFloatLE(vector[j], bufferOffset);
        bufferOffset += 4;
      }
    }
    
    fs.writeFileSync(outputVectorPath, outputVectorBuffer);
    
    // 3. Write metadata
    console.log('   📊 Writing metadata...');
    const outputMetadata: VectorMetadata = {
      num_vectors: lemmatizedVectors.length,
      dimension: dimension,
      created_at: new Date().toISOString(),
      source: 'parallel_lemmatized_from_themes_vectors'
    };
    
    fs.writeFileSync(outputMetadataPath, JSON.stringify(outputMetadata, null, 2));
    
    const totalTime = Date.now() - startTime;
    console.log(`\n✅ Parallel lemmatized vector data written successfully!`);
    console.log(`📊 Final dataset:`);
    console.log(`   Vocabulary: ${lemmatizedVocabulary.length} canonical words`);
    console.log(`   Vectors: ${lemmatizedVectors.length} × ${dimension}D`);
    console.log(`   File sizes:`);
    console.log(`     Vocabulary: ${(fs.statSync(outputVocabPath).size / 1024 / 1024).toFixed(1)}MB`);
    console.log(`     Vectors: ${(fs.statSync(outputVectorPath).size / 1024 / 1024).toFixed(1)}MB`);
    console.log(`     Metadata: ${(fs.statSync(outputMetadataPath).size / 1024).toFixed(1)}KB`);
    console.log(`⚡ Total time: ${(totalTime / 1000).toFixed(1)}s (${maxWorkers}× speedup)`);

  } catch (error) {
    console.error('❌ Parallel vector lemmatization failed:', error);
    process.exit(1);
  }
}

/**
 * Create a worker to process a chunk of vocabulary words
 */
function createVectorWorker(workerId: number, chunk: { startIdx: number; words: Array<{ index: number; word: string }> }): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const workerScript = `
      import { parentPort } from 'worker_threads';
      import { SpellCheckService } from './dist/SpellCheckService.js';

      function isWordSuitableForThemes(word) {
        if (!word || typeof word !== 'string') return false;
        
        const cleaned = word.toLowerCase().trim();
        
        if (cleaned.length < 3 || cleaned.length > 15) return false;
        if (!/^[a-z]+$/.test(cleaned)) return false;
        
        const excludeWords = new Set([
          'sex', 'porn', 'nude', 'naked', 'xxx', 'gay', 'lesbian', 'anal', 'oral', 'pussy', 'cum',
          'rape', 'incest', 'fuck', 'fucking', 'shit', 'ass', 'milf', 'mature', 'hardcore',
          'drug', 'kill', 'death', 'hate', 'racist', 'nazi', 'dead'
        ]);
        
        if (excludeWords.has(cleaned)) return false;
        
        if (cleaned.length <= 3 && /^[a-z]{1,3}$/.test(cleaned)) {
          const allowedShort = new Set(['the', 'and', 'you', 'are', 'for', 'can', 'not', 'but', 'all', 'get', 'has', 'had', 'him', 'her', 'how', 'man', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'car', 'day', 'eye', 'far', 'got', 'run', 'sat', 'sun', 'top', 'try', 'win', 'yes', 'yet', 'ago', 'air', 'ask', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'buy', 'car', 'cat', 'cup', 'cut', 'die', 'dog', 'eat', 'end', 'eye', 'far', 'few', 'fit', 'fly', 'fun', 'gas', 'god', 'got', 'gun', 'guy', 'hit', 'hot', 'ice', 'job', 'key', 'kid', 'law', 'lay', 'leg', 'let', 'lie', 'lot', 'low', 'man', 'map', 'may', 'mom', 'net', 'new', 'nor', 'not', 'now', 'odd', 'off', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'per', 'put', 'raw', 'red', 'run', 'sad', 'sat', 'say', 'sea', 'see', 'set', 'she', 'sit', 'six', 'sky', 'son', 'sun', 'tax', 'ten', 'the', 'tie', 'tip', 'too', 'top', 'try', 'two', 'use', 'van', 'war', 'was', 'way', 'web', 'who', 'why', 'win', 'won', 'yes', 'yet', 'you', 'zoo']);
          return allowedShort.has(cleaned);
        }
        
        return true;
      }

      async function processVocabChunk(workerId, chunk) {
        try {
          const spellCheckService = new SpellCheckService();
          await spellCheckService.initialize();
          
          const processedMappings = new Map();
          let errorCount = 0;
          let processedCount = 0;
          
          for (const {index, word} of chunk.words) {
            try {
              const cleanWord = word.toLowerCase().trim();
              if (!isWordSuitableForThemes(cleanWord)) {
                processedCount++;
                continue;
              }
              
              const canonicalForm = spellCheckService.getCanonicalForm(cleanWord);
              
              if (!isWordSuitableForThemes(canonicalForm)) {
                processedCount++;
                continue;
              }
              
              if (processedMappings.has(canonicalForm)) {
                const existing = processedMappings.get(canonicalForm);
                existing.originalIndices.push(index);
                if (!existing.originalWords.includes(cleanWord)) {
                  existing.originalWords.push(cleanWord);
                }
              } else {
                processedMappings.set(canonicalForm, {
                  canonicalForm,
                  originalIndices: [index],
                  originalWords: [cleanWord]
                });
              }
              
              processedCount++;
              
              if (processedCount % 1000 === 0) {
                parentPort.postMessage({
                  type: 'progress',
                  workerId,
                  processed: processedCount,
                  total: chunk.words.length
                });
              }
              
            } catch (error) {
              errorCount++;
            }
          }
          
          const resultArray = Array.from(processedMappings.values());
          
          parentPort.postMessage({
            type: 'complete',
            result: {
              workerId,
              processedMappings: resultArray,
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

      parentPort.on('message', (data) => {
        if (data.type === 'start') {
          processVocabChunk(data.workerId, data.chunk);
        }
      });
    `;

    const workerPath = path.join(process.cwd(), `vector-worker-${workerId}.mjs`);
    fs.writeFileSync(workerPath, workerScript);

    const worker = new Worker(workerPath);
    
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        const progress = ((message.processed / message.total) * 100).toFixed(1);
        process.stdout.write(`\r   Worker ${message.workerId + 1}: ${progress}% (${message.processed}/${message.total})`);
      } else if (message.type === 'complete') {
        console.log(`\n   ✅ Worker ${message.result.workerId + 1} completed`);
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

    worker.postMessage({
      type: 'start',
      workerId,
      chunk
    });
  });
}

lemmatizeVectorDataParallel().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});