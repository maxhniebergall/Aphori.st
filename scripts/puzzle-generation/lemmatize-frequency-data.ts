#!/usr/bin/env node
/**
 * Lemmatize Frequency Data Script
 * Pre-processes unigram_freq.csv to create a lemmatized version with aggregated counts
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

async function lemmatizeFrequencyData() {
  console.log('🔤 Starting frequency data lemmatization...\n');

  try {
    // Initialize spell checker
    console.log('🔧 Initializing spell checker...');
    const spellCheckService = new SpellCheckService();
    await spellCheckService.initialize();
    console.log('✅ Spell checker initialized\n');

    // Find input CSV file
    const possiblePaths = [
      path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data/unigram_freq.csv'), // From project root
      path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data/unigram_freq.csv'), // From scripts/puzzle-generation dir
      path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data/unigram_freq.csv'), // From nested script dir
      path.resolve(process.cwd(), '../datascience/themes_quality/data/unigram_freq.csv'), // Alternative path
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
    
    // Set output path
    const outputPath = csvPath.replace('unigram_freq.csv', 'unigram_freq_lemmatized.csv');
    console.log(`📝 Output will be written to: ${outputPath}\n`);

    // Read and process CSV data
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n');
    
    // Skip header line
    const dataLines = lines.slice(1).filter(line => line.trim());
    console.log(`📊 Processing ${dataLines.length} entries...`);
    
    // Track progress
    let processedCount = 0;
    const totalCount = dataLines.length;
    const progressInterval = Math.floor(totalCount / 20); // Show progress every 5%
    
    // Use map to aggregate counts for words with same canonical form
    const lemmatizedWordMap = new Map<string, {
      canonicalForm: string;
      totalCount: number;
      originalWords: string[];
    }>();

    // Process each line
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      
      try {
        const [word, countStr] = line.split(',');
        if (!word || !countStr) continue;
        
        const count = parseInt(countStr, 10);
        if (isNaN(count) || count <= 0) continue;
        
        // Clean and validate word
        const cleanWord = word.toLowerCase().trim();
        if (!isWordSuitableForThemes(cleanWord)) continue;
        
        // Get canonical form (lemmatized)
        const canonicalForm = spellCheckService.getCanonicalForm(cleanWord);
        
        // Skip if canonical form became unsuitable
        if (!isWordSuitableForThemes(canonicalForm)) continue;
        
        // Aggregate counts for words with same canonical form
        if (lemmatizedWordMap.has(canonicalForm)) {
          const existing = lemmatizedWordMap.get(canonicalForm)!;
          existing.totalCount += count;
          if (!existing.originalWords.includes(cleanWord)) {
            existing.originalWords.push(cleanWord);
          }
        } else {
          lemmatizedWordMap.set(canonicalForm, {
            canonicalForm,
            totalCount: count,
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
        logger.warn(`   ⚠️ Error processing line ${i + 1}: ${line}`, error);
        continue;
      }
    }

    // Create output data
    const outputEntries = Array.from(lemmatizedWordMap.values())
      .sort((a, b) => b.totalCount - a.totalCount); // Sort by frequency descending

    console.log(`\n📈 Lemmatization Results:`);
    console.log(`   Original entries: ${totalCount}`);
    console.log(`   Lemmatized entries: ${outputEntries.length}`);
    console.log(`   Reduction: ${((totalCount - outputEntries.length) / totalCount * 100).toFixed(1)}%`);
    
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
    
    console.log(`✅ Lemmatized frequency data written to: ${outputPath}`);
    console.log(`📊 Final dataset: ${outputEntries.length} canonical words`);
    
    // Show top words
    console.log(`\n🏆 Top 20 most frequent lemmatized words:`);
    for (let i = 0; i < Math.min(20, outputEntries.length); i++) {
      const entry = outputEntries[i];
      console.log(`   ${i + 1}. "${entry.canonicalForm}" (${entry.totalCount})`);
    }

  } catch (error) {
    console.error('❌ Lemmatization failed:', error);
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
lemmatizeFrequencyData().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});