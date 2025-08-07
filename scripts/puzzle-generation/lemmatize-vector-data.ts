#!/usr/bin/env node
/**
 * Lemmatize Vector Data Script
 * Pre-processes themes vector data to create lemmatized versions with canonical word forms
 */

import fs from 'fs';
import path from 'path';
import { SpellCheckService } from './SpellCheckService.js';

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

async function lemmatizeVectorData() {
  console.log('🔤 Starting vector data lemmatization...\n');

  try {
    // Initialize spell checker
    console.log('🔧 Initializing spell checker...');
    const spellCheckService = new SpellCheckService();
    await spellCheckService.initialize();
    console.log('✅ Spell checker initialized\n');

    // Find input files
    const possibleBasePaths = [
      path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data'), // From project root
      path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data'), // From scripts/puzzle-generation dir
      path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data'), // From nested script dir
      path.resolve(process.cwd(), '../datascience/themes_quality/data'), // Alternative path
    ];
    
    let dataPath: string | null = null;
    for (const testPath of possibleBasePaths) {
      const vocabPath = path.join(testPath, 'themes_vocabulary.json');
      const vectorPath = path.join(testPath, 'themes_vectors.bin');
      const metadataPath = path.join(testPath, 'themes_metadata.json');
      
      if (fs.existsSync(vocabPath) && fs.existsSync(vectorPath) && fs.existsSync(metadataPath)) {
        dataPath = testPath;
        break;
      }
    }
    
    if (!dataPath) {
      const pathsStr = possibleBasePaths.join('\n  - ');
      throw new Error(`Vector data files not found. Tried:\n  - ${pathsStr}`);
    }
    
    const vocabPath = path.join(dataPath, 'themes_vocabulary.json');
    const vectorPath = path.join(dataPath, 'themes_vectors.bin');
    const metadataPath = path.join(dataPath, 'themes_metadata.json');
    
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

    // Load vector binary data
    console.log('🔢 Loading vector binary data...');
    const vectorBuffer = fs.readFileSync(vectorPath);
    
    // Read header (num_vectors, dimension)
    const headerSize = 8; // 2 * 4 bytes
    const numVectors = vectorBuffer.readUInt32LE(0);
    const dimension = vectorBuffer.readUInt32LE(4);
    
    console.log(`   Binary header - vectors: ${numVectors}, dimension: ${dimension}`);
    
    if (numVectors !== originalVocabulary.length) {
      throw new Error(`Vocabulary size mismatch: vocab=${originalVocabulary.length}, binary=${numVectors}`);
    }
    
    if (dimension !== metadata.dimension) {
      throw new Error(`Dimension mismatch: metadata=${metadata.dimension}, binary=${dimension}`);
    }

    // Process vocabulary and create lemmatization mapping
    console.log('\n🔤 Processing vocabulary lemmatization...');
    
    const lemmatizedMapping = new Map<string, {
      canonicalForm: string;
      originalIndices: number[];
      originalWords: string[];
    }>();

    let processedCount = 0;
    const totalCount = originalVocabulary.length;
    const progressInterval = Math.floor(totalCount / 20); // Show progress every 5%
    
    for (let i = 0; i < originalVocabulary.length; i++) {
      const word = originalVocabulary[i];
      
      try {
        // Clean and validate word
        const cleanWord = word.toLowerCase().trim();
        if (!isWordSuitableForThemes(cleanWord)) {
          processedCount++;
          continue;
        }
        
        // Get canonical form
        const canonicalForm = spellCheckService.getCanonicalForm(cleanWord);
        
        // Skip if canonical form became unsuitable
        if (!isWordSuitableForThemes(canonicalForm)) {
          processedCount++;
          continue;
        }
        
        // Add to mapping
        if (lemmatizedMapping.has(canonicalForm)) {
          const existing = lemmatizedMapping.get(canonicalForm)!;
          existing.originalIndices.push(i);
          if (!existing.originalWords.includes(cleanWord)) {
            existing.originalWords.push(cleanWord);
          }
        } else {
          lemmatizedMapping.set(canonicalForm, {
            canonicalForm,
            originalIndices: [i],
            originalWords: [cleanWord]
          });
        }
        
        processedCount++;
        
        // Show progress
        if (processedCount % progressInterval === 0 || processedCount === totalCount) {
          const percentage = ((processedCount / totalCount) * 100).toFixed(1);
          console.log(`   ⏳ Progress: ${percentage}% (${processedCount}/${totalCount})`);
        }
        
      } catch (error) {
        logger.warn(`   ⚠️ Error processing word "${word}":`, error);
        processedCount++;
        continue;
      }
    }

    console.log(`\n📈 Lemmatization Results:`);
    console.log(`   Original vocabulary: ${originalVocabulary.length}`);
    console.log(`   Lemmatized vocabulary: ${lemmatizedMapping.size}`);
    console.log(`   Reduction: ${((originalVocabulary.length - lemmatizedMapping.size) / originalVocabulary.length * 100).toFixed(1)}%`);
    
    // Show some examples of aggregation
    console.log(`\n🔗 Examples of word aggregation:`);
    const exampleAggregations = Array.from(lemmatizedMapping.values())
      .filter(entry => entry.originalWords.length > 1)
      .slice(0, 10);
      
    for (const example of exampleAggregations) {
      console.log(`   "${example.canonicalForm}": ${example.originalWords.join(', ')}`);
    }

    // Extract vectors for lemmatized words
    console.log(`\n🔢 Extracting and averaging vectors...`);
    const lemmatizedVocabulary: string[] = [];
    const lemmatizedVectors: Float32Array[] = [];
    
    for (const [canonicalForm, mapping] of lemmatizedMapping.entries()) {
      lemmatizedVocabulary.push(canonicalForm);
      
      if (mapping.originalIndices.length === 1) {
        // Single word - extract its vector directly
        const idx = mapping.originalIndices[0];
        const vectorStart = headerSize + idx * dimension * 4; // 4 bytes per float
        const vectorData = new Float32Array(vectorBuffer.buffer, vectorStart, dimension);
        lemmatizedVectors.push(new Float32Array(vectorData)); // Copy to new array
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
      source: 'lemmatized_from_themes_vectors'
    };
    
    fs.writeFileSync(outputMetadataPath, JSON.stringify(outputMetadata, null, 2));
    
    console.log(`✅ Lemmatized vector data written successfully!`);
    console.log(`📊 Final dataset:`);
    console.log(`   Vocabulary: ${lemmatizedVocabulary.length} canonical words`);
    console.log(`   Vectors: ${lemmatizedVectors.length} × ${dimension}D`);
    console.log(`   File sizes:`);
    console.log(`     Vocabulary: ${(fs.statSync(outputVocabPath).size / 1024 / 1024).toFixed(1)}MB`);
    console.log(`     Vectors: ${(fs.statSync(outputVectorPath).size / 1024 / 1024).toFixed(1)}MB`);
    console.log(`     Metadata: ${(fs.statSync(outputMetadataPath).size / 1024).toFixed(1)}KB`);

  } catch (error) {
    console.error('❌ Vector lemmatization failed:', error);
    process.exit(1);
  }
}

/**
 * Check if a word is suitable for themes game (copied from WordFrequencyService)
 */
function isWordSuitableForThemes(word: string): boolean {
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
    // Allow common short words but exclude technical abbreviations
    const allowedShort = new Set(['the', 'and', 'you', 'are', 'for', 'can', 'not', 'but', 'all', 'get', 'has', 'had', 'him', 'her', 'how', 'man', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'car', 'day', 'eye', 'far', 'got', 'run', 'sat', 'sun', 'top', 'try', 'win', 'yes', 'yet', 'ago', 'air', 'ask', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'buy', 'car', 'cat', 'cup', 'cut', 'die', 'dog', 'eat', 'end', 'eye', 'far', 'few', 'fit', 'fly', 'fun', 'gas', 'god', 'got', 'gun', 'guy', 'hit', 'hot', 'ice', 'job', 'key', 'kid', 'law', 'lay', 'leg', 'let', 'lie', 'lot', 'low', 'man', 'map', 'may', 'mom', 'net', 'new', 'nor', 'not', 'now', 'odd', 'off', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'per', 'put', 'raw', 'red', 'run', 'sad', 'sat', 'say', 'sea', 'see', 'set', 'she', 'sit', 'six', 'sky', 'son', 'sun', 'tax', 'ten', 'the', 'tie', 'tip', 'too', 'top', 'try', 'two', 'use', 'van', 'war', 'was', 'way', 'web', 'who', 'why', 'win', 'won', 'yes', 'yet', 'you', 'zoo']);
    return allowedShort.has(cleaned);
  }
  
  return true;
}

// Run the script
lemmatizeVectorData().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});