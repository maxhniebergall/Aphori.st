#!/usr/bin/env node

/**
 * Monthly Puzzle Generation Script
 * Generates puzzles for the next 30+ days with improved batch processing
 */

import { main as generatePuzzles } from './generate-puzzles.js';

interface MonthlyConfig {
  startDate?: string;
  days: number;
  puzzlesPerDay: number;
  qualityThreshold: number;
  outputDir: string;
  verbose: boolean;
}

/**
 * Generate date string in YYYY-MM-DD format
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Generate puzzles for the next month
 */
async function generateMonthlyPuzzles(config: MonthlyConfig): Promise<void> {
  const startDate = config.startDate ? new Date(config.startDate) : new Date();
  const endDate = addDays(startDate, config.days - 1);
  
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  
  console.log('🚀 Monthly Puzzle Generation');
  console.log(`📅 Date Range: ${startDateStr} to ${endDateStr} (${config.days} days)`);
  console.log(`🎲 Puzzles per day: ${config.puzzlesPerDay} (sizes 4x4 through 10x10)`);
  console.log(`⭐ Quality threshold: ${config.qualityThreshold}`);
  console.log(`📁 Output directory: ${config.outputDir}`);
  console.log('');

  // Set up process.argv to simulate CLI call to generate-puzzles.js
  const originalArgv = process.argv;
  
  try {
    process.argv = [
      process.argv[0], // node
      process.argv[1], // script path
      startDateStr,    // start date
      endDateStr,      // end date
      config.puzzlesPerDay.toString(), // puzzles per day
      config.qualityThreshold.toString(), // quality threshold
      config.outputDir, // output directory
      '10', // max attempts per day
      ...(config.verbose ? ['--verbose'] : [])
    ];

    await generatePuzzles();
    
  } finally {
    // Restore original argv
    process.argv = originalArgv;
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

  // Calculate default start date (tomorrow if no date provided)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const config: MonthlyConfig = {
    startDate: args[0] || formatDate(tomorrow),
    days: parseInt(args[1]) || 31, // Default: 31 days
    puzzlesPerDay: parseInt(args[2]) || 7, // Default: all sizes 4x4-10x10
    qualityThreshold: parseFloat(args[3]) || 0.5,
    outputDir: args[4] || './monthly-puzzles',
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  console.log('🎯 Monthly Puzzle Generation Configuration:');
  console.log(`   📅 Start Date: ${config.startDate}`);
  console.log(`   📊 Duration: ${config.days} days`);
  console.log(`   🎲 Puzzles/Day: ${config.puzzlesPerDay}`);
  console.log(`   ⭐ Quality: ${config.qualityThreshold}`);
  console.log(`   📁 Output: ${config.outputDir}`);
  console.log(`   🔍 Verbose: ${config.verbose ? 'Yes' : 'No'}`);
  console.log('');

  try {
    await generateMonthlyPuzzles(config);
    console.log('✨ Monthly puzzle generation completed successfully!');
    
  } catch (error) {
    console.error('💥 Monthly generation failed:', (error as Error).message);
    if (config.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
🗓️  Monthly Themes Puzzle Generator

Usage:
  npm run generate-monthly [startDate] [days] [puzzlesPerDay] [qualityThreshold] [outputDir] [options]

Arguments:
  startDate        Start date (YYYY-MM-DD) [default: tomorrow]
  days             Number of days to generate [default: 31]
  puzzlesPerDay    Puzzles per day (max 7 for sizes 4x4-10x10) [default: 7]
  qualityThreshold Minimum quality score (0-1) [default: 0.5]
  outputDir        Output directory [default: ./monthly-puzzles]

Options:
  --verbose, -v    Verbose output with puzzle details
  --help, -h       Show this help message

Examples:
  # Generate next 31 days starting tomorrow
  npm run generate-monthly

  # Generate next 30 days starting from specific date
  npm run generate-monthly 2025-08-05 30

  # Generate high-quality puzzles for 2 weeks
  npm run generate-monthly 2025-08-05 14 7 0.6

  # Generate with verbose output
  npm run generate-monthly 2025-08-05 31 7 0.5 ./august-puzzles --verbose

Output:
  - Single firebase_import.json file ready for Firebase RTDB import
  - Comprehensive generation_report.json with quality metrics
  - All puzzle sizes (4x4 through 10x10) organized by date and size
  - Progressive difficulty within each puzzle size
`);
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateMonthlyPuzzles, main };