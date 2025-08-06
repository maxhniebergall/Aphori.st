/**
 * Used Theme Words Tracker
 * Manages a persistent record of theme words that have been used in puzzles
 * to prevent duplicates across puzzle generation sessions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USED_WORDS_FILE = 'used-theme-words.json';

export interface UsedThemeWordEntry {
  word: string;
  firstUsed: string; // ISO date string
  puzzleId?: string; // Optional puzzle identifier
  generationSession?: string; // Optional session identifier
  similarity?: number; // Similarity score when word was used/rejected
  rejected?: boolean; // Whether word was rejected due to low similarity
}

export class UsedThemeWords {
  private usedWords: Set<string> = new Set();
  private wordEntries: Map<string, UsedThemeWordEntry> = new Map();
  private filePath: string;

  constructor(puzzleGenerationDir: string = __dirname) {
    this.filePath = path.join(puzzleGenerationDir, USED_WORDS_FILE);
    this.loadUsedWords();
  }

  /**
   * Load used words from persistent storage
   */
  private loadUsedWords(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const entries: UsedThemeWordEntry[] = JSON.parse(data);
        
        for (const entry of entries) {
          this.usedWords.add(entry.word.toLowerCase());
          this.wordEntries.set(entry.word.toLowerCase(), entry);
        }
        
        console.log(`📋 Loaded ${this.usedWords.size} used theme words from ${this.filePath}`);
      } else {
        console.log(`📋 No existing used words file found, starting fresh`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load used words file: ${error}`);
      // Continue with empty set
    }
  }

  /**
   * Save used words to persistent storage
   */
  private saveUsedWords(): void {
    try {
      const entries = Array.from(this.wordEntries.values());
      const data = JSON.stringify(entries, null, 2);
      fs.writeFileSync(this.filePath, data, 'utf8');
      console.log(`💾 Saved ${entries.length} used theme words to ${this.filePath}`);
    } catch (error) {
      console.error(`❌ Failed to save used words file: ${error}`);
    }
  }

  /**
   * Check if a theme word has been used before
   */
  isWordUsed(word: string): boolean {
    return this.usedWords.has(word.toLowerCase());
  }

  /**
   * Mark a theme word as used
   */
  markWordAsUsed(word: string, puzzleId?: string, generationSession?: string, similarity?: number, rejected?: boolean): void {
    const lowerWord = word.toLowerCase();
    
    if (!this.usedWords.has(lowerWord)) {
      const entry: UsedThemeWordEntry = {
        word: word, // Keep original casing
        firstUsed: new Date().toISOString(),
        puzzleId,
        generationSession,
        similarity,
        rejected
      };
      
      this.usedWords.add(lowerWord);
      this.wordEntries.set(lowerWord, entry);
      this.saveUsedWords();
      
      const status = rejected ? 'rejected' : 'used';
      const simText = similarity ? ` (similarity: ${similarity.toFixed(3)})` : '';
      console.log(`✅ Marked theme word "${word}" as ${status}${simText}`);
    }
  }

  /**
   * Get statistics about used words
   */
  getStats(): { totalUsed: number; oldestEntry?: string; newestEntry?: string } {
    const entries = Array.from(this.wordEntries.values());
    
    if (entries.length === 0) {
      return { totalUsed: 0 };
    }
    
    const sorted = entries.sort((a, b) => new Date(a.firstUsed).getTime() - new Date(b.firstUsed).getTime());
    
    return {
      totalUsed: entries.length,
      oldestEntry: sorted[0]?.firstUsed,
      newestEntry: sorted[sorted.length - 1]?.firstUsed
    };
  }

  /**
   * Get all used words (for debugging/inspection)
   */
  getAllUsedWords(): UsedThemeWordEntry[] {
    return Array.from(this.wordEntries.values());
  }

  /**
   * Clear all used words (use with caution)
   */
  clearAllUsedWords(): void {
    this.usedWords.clear();
    this.wordEntries.clear();
    
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      console.log(`🗑️ Cleared all used theme words and deleted file`);
    } catch (error) {
      console.error(`❌ Failed to delete used words file: ${error}`);
    }
  }

  /**
   * Import used words from an array (for migration/setup)
   */
  importUsedWords(words: string[], generationSession?: string): void {
    let imported = 0;
    
    for (const word of words) {
      if (!this.isWordUsed(word)) {
        this.markWordAsUsed(word, undefined, generationSession);
        imported++;
      }
    }
    
    console.log(`📥 Imported ${imported} new theme words (${words.length - imported} were already tracked)`);
  }
}