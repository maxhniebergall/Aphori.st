#!/usr/bin/env node

/**
 * Convert the flat-path JSON structure to Firebase-compatible nested structure
 */

import fs from 'fs';
import path from 'path';

function convertToFirebaseStructure(flatData) {
  const firebaseData = {};
  
  for (const [flatPath, data] of Object.entries(flatData)) {
    // Split path and create nested structure
    const pathParts = flatPath.split('/');
    let current = firebaseData;
    
    // Navigate to the nested location
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    
    // Set the final data
    const finalKey = pathParts[pathParts.length - 1];
    current[finalKey] = data;
  }
  
  return firebaseData;
}

// Read the flat structure file
const inputFile = process.argv[2] || './test-single-file/firebase_import.json';
const outputFile = process.argv[3] || './test-single-file/firebase_import_nested.json';

try {
  console.log(`Reading from: ${inputFile}`);
  const flatData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  
  console.log('Converting to Firebase nested structure...');
  const firebaseData = convertToFirebaseStructure(flatData);
  
  console.log(`Writing to: ${outputFile}`);
  fs.writeFileSync(outputFile, JSON.stringify(firebaseData, null, 2));
  
  console.log('✅ Conversion complete!');
  console.log('Firebase structure preview:');
  console.log(Object.keys(firebaseData));
  
  if (firebaseData.dailyPuzzles) {
    console.log('Daily puzzles dates:', Object.keys(firebaseData.dailyPuzzles.themes || {}));
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}