/**
 * Check word counts at different frequency thresholds
 */

import { WordFrequencyService } from './WordFrequencyService.js';

async function checkThresholdCounts() {
  console.log('🔍 Checking word counts at different frequency thresholds...\n');

  const frequencyService = new WordFrequencyService();
  await frequencyService.initialize();

  // Test the raw count thresholds used in puzzle generation
  const thresholds = [
    { label: 'Difficulty 1 (>= 1M occurrences)', value: 1000000 },
    { label: 'Difficulty 2 (>= 100K occurrences)', value: 100000 },
    { label: 'Difficulty 3 (>= 10K occurrences)', value: 10000 },
    { label: 'Difficulty 4 (>= 1K occurrences)', value: 1000 },
    { label: 'General quality control (>= 50 occurrences)', value: 50 },
    { label: 'Very low threshold (>= 10 occurrences)', value: 10 }
  ];

  console.log('📊 Word counts by raw frequency threshold:');
  for (const threshold of thresholds) {
    const count = frequencyService.getWordCountAboveThreshold(threshold.value);
    const percentage = ((count / frequencyService.getStats()?.totalWords!) * 100).toFixed(2);
    console.log(`   ${threshold.label.padEnd(40)} (${threshold.value.toLocaleString().padStart(8)}): ${count.toLocaleString().padStart(6)} words (${percentage}%)`);
  }

  console.log('\n📈 Total words in frequency dataset:', frequencyService.getStats()?.totalWords?.toLocaleString());
}

// Run the check
checkThresholdCounts().catch(console.error);