#!/usr/bin/env node
/**
 * Fast Lemmatized Dataset Test
 * Quick validation of lemmatized datasets without full system initialization
 */

import fs from 'fs';
import path from 'path';

async function fastLemmatizedTest() {
  console.log('⚡ Fast lemmatized datasets test...\n');

  try {
    // Test paths
    const possibleBasePaths = [
      path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data'),
      path.resolve(process.cwd(), '../datascience/themes_quality/data'),
    ];
    
    let dataPath: string | null = null;
    for (const testPath of possibleBasePaths) {
      if (fs.existsSync(testPath)) {
        dataPath = testPath;
        break;
      }
    }
    
    if (!dataPath) {
      throw new Error('Data directory not found');
    }
    
    console.log(`📂 Data directory: ${dataPath}\n`);
    
    // Check for lemmatized files
    const lemmatizedFiles = {
      frequency: path.join(dataPath, 'unigram_freq_lemmatized.csv'),
      vocabulary: path.join(dataPath, 'themes_vocabulary_lemmatized.json'),
      vectors: path.join(dataPath, 'themes_vectors_lemmatized.bin'),
      metadata: path.join(dataPath, 'themes_metadata_lemmatized.json')
    };
    
    const originalFiles = {
      frequency: path.join(dataPath, 'unigram_freq.csv'),
      vocabulary: path.join(dataPath, 'themes_vocabulary.json'),
      vectors: path.join(dataPath, 'themes_vectors.bin'),
      metadata: path.join(dataPath, 'themes_metadata.json')
    };
    
    console.log('🔍 Checking file availability:');
    
    // Test frequency files
    const hasLemmatizedFreq = fs.existsSync(lemmatizedFiles.frequency);
    const hasOriginalFreq = fs.existsSync(originalFiles.frequency);
    
    console.log(`   Frequency data:`);
    console.log(`     Original: ${hasOriginalFreq ? '✅' : '❌'} ${hasOriginalFreq ? getFileSizeMB(originalFiles.frequency) : 'N/A'}`);
    console.log(`     Lemmatized: ${hasLemmatizedFreq ? '✅' : '❌'} ${hasLemmatizedFreq ? getFileSizeMB(lemmatizedFiles.frequency) : 'N/A'}`);
    
    // Test vector files
    const hasLemmatizedVectors = fs.existsSync(lemmatizedFiles.vocabulary) && 
                                fs.existsSync(lemmatizedFiles.vectors) && 
                                fs.existsSync(lemmatizedFiles.metadata);
    const hasOriginalVectors = fs.existsSync(originalFiles.vocabulary) && 
                              fs.existsSync(originalFiles.vectors) && 
                              fs.existsSync(originalFiles.metadata);
    
    console.log(`   Vector data:`);
    console.log(`     Original: ${hasOriginalVectors ? '✅' : '❌'} ${hasOriginalVectors ? getFileSizeMB(originalFiles.vectors) : 'N/A'}`);
    console.log(`     Lemmatized: ${hasLemmatizedVectors ? '✅' : '❌'} ${hasLemmatizedVectors ? getFileSizeMB(lemmatizedFiles.vectors) : 'N/A'}`);
    
    // Test frequency data content if available
    if (hasLemmatizedFreq || hasOriginalFreq) {
      console.log('\n📊 Frequency data analysis:');
      
      if (hasLemmatizedFreq) {
        const lemmatizedStats = analyzeFrequencyFile(lemmatizedFiles.frequency);
        console.log(`   Lemmatized: ${lemmatizedStats.entries} entries, top word: "${lemmatizedStats.topWord}" (${lemmatizedStats.topCount})`);
      }
      
      if (hasOriginalFreq) {
        const originalStats = analyzeFrequencyFile(originalFiles.frequency);
        console.log(`   Original: ${originalStats.entries} entries, top word: "${originalStats.topWord}" (${originalStats.topCount})`);
      }
      
      if (hasLemmatizedFreq && hasOriginalFreq) {
        const lemStats = analyzeFrequencyFile(lemmatizedFiles.frequency);
        const origStats = analyzeFrequencyFile(originalFiles.frequency);
        const reduction = ((origStats.entries - lemStats.entries) / origStats.entries * 100).toFixed(1);
        console.log(`   Reduction: ${reduction}% fewer entries after lemmatization`);
      }
    }
    
    // Test vector metadata if available
    if (hasLemmatizedVectors || hasOriginalVectors) {
      console.log('\n🔢 Vector data analysis:');
      
      if (hasLemmatizedVectors) {
        const lemmatizedMeta = JSON.parse(fs.readFileSync(lemmatizedFiles.metadata, 'utf8'));
        console.log(`   Lemmatized: ${lemmatizedMeta.num_vectors} vectors, ${lemmatizedMeta.dimension}D`);
      }
      
      if (hasOriginalVectors) {
        const originalMeta = JSON.parse(fs.readFileSync(originalFiles.metadata, 'utf8'));
        console.log(`   Original: ${originalMeta.num_vectors} vectors, ${originalMeta.dimension}D`);
      }
      
      if (hasLemmatizedVectors && hasOriginalVectors) {
        const lemMeta = JSON.parse(fs.readFileSync(lemmatizedFiles.metadata, 'utf8'));
        const origMeta = JSON.parse(fs.readFileSync(originalFiles.metadata, 'utf8'));
        const reduction = ((origMeta.num_vectors - lemMeta.num_vectors) / origMeta.num_vectors * 100).toFixed(1);
        console.log(`   Reduction: ${reduction}% fewer vectors after lemmatization`);
      }
    }
    
    // Performance prediction
    console.log('\n⚡ Performance prediction:');
    
    if (hasLemmatizedFreq && hasLemmatizedVectors) {
      console.log('   ✅ FAST: Both lemmatized datasets available (~2-5 second initialization)');
    } else if (hasOriginalFreq && hasOriginalVectors) {
      console.log('   ⚠️ MODERATE: Using original datasets (~15-20 second initialization)');
    } else {
      console.log('   ❌ INCOMPLETE: Some datasets missing');
    }
    
    // Next steps
    console.log('\n📋 Status & Next Steps:');
    
    if (!hasLemmatizedFreq) {
      console.log('   🔄 Run frequency lemmatization: node dist/lemmatize-frequency-data-parallel.js');
    }
    
    if (!hasLemmatizedVectors) {
      console.log('   🔄 Run vector lemmatization: node dist/lemmatize-vector-data-parallel.js');
    }
    
    if (hasLemmatizedFreq && hasLemmatizedVectors) {
      console.log('   🎯 Ready for fast puzzle generation!');
    }
    
    console.log('\n✅ Fast test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

function getFileSizeMB(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    return `(${sizeMB}MB)`;
  } catch {
    return '(unknown size)';
  }
}

function analyzeFrequencyFile(filePath: string): { entries: number; topWord: string; topCount: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const dataLines = lines.slice(1); // Skip header
    
    if (dataLines.length === 0) {
      return { entries: 0, topWord: 'N/A', topCount: '0' };
    }
    
    // Get first data line (highest frequency)
    const [topWord, topCount] = dataLines[0].split(',');
    
    return {
      entries: dataLines.length,
      topWord: topWord || 'N/A',
      topCount: topCount || '0'
    };
  } catch {
    return { entries: 0, topWord: 'N/A', topCount: '0' };
  }
}

fastLemmatizedTest().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});