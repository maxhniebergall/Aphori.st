/**
 * Spell Check Service - Uses hunspell-style spell checking via nspell
 * Provides functionality to check if words have the same "correct spelling"
 */

import { createRequire } from 'module';
import nspell from 'nspell';
import dictionary from 'dictionary-en-us';

const require = createRequire(import.meta.url);
const lemmatize = require('wink-lemmatizer');

export class SpellCheckService {
  private spellChecker: any = null;
  private initialized: boolean = false;

  /**
   * Initialize the spell checker with English dictionary
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      console.log('🔤 Initializing spell checker...');
      
      // Load the dictionary
      const dict = await new Promise((resolve, reject) => {
        dictionary((err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      // Initialize nspell with the dictionary
      this.spellChecker = nspell(dict);
      
      this.initialized = true;
      
      console.log('✅ Spell checker and lemmatizer initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize spell checker:', error);
      throw error;
    }
  }

  /**
   * Check if a word is spelled correctly
   */
  isCorrect(word: string): boolean {
    if (!this.initialized || !this.spellChecker) {
      throw new Error('SpellCheckService not initialized');
    }

    return this.spellChecker.correct(word);
  }

  /**
   * Get suggestions for a misspelled word
   */
  getSuggestions(word: string): string[] {
    if (!this.initialized || !this.spellChecker) {
      throw new Error('SpellCheckService not initialized');
    }

    return this.spellChecker.suggest(word);
  }

  /**
   * Get the base form (lemma) of a word
   * This reduces words to their root form (e.g., "running" -> "run", "cats" -> "cat")
   */
  getLemma(word: string): string {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    const cleanWord = word.toLowerCase();
    
    // Try different grammatical forms to find the best lemma
    // wink-lemmatizer returns the original word if no lemma is found
    const nounForm = lemmatize.noun(cleanWord);
    const verbForm = lemmatize.verb(cleanWord);
    const adjForm = lemmatize.adjective(cleanWord);
    
    // Return the shortest form that's different from the original
    // This prioritizes the most reduced form
    const forms = [nounForm, verbForm, adjForm]
      .filter(form => form !== cleanWord) // Only forms that actually changed
      .sort((a, b) => a.length - b.length); // Shortest first
    
    return forms.length > 0 ? forms[0] : cleanWord;
  }

  /**
   * Get the "correct spelling" of a word
   * If the word is already correct, returns the word itself
   * If the word is incorrect, returns the first suggestion (most likely correction)
   * If no suggestions are available, returns the original word
   */
  getCorrectSpelling(word: string): string {
    if (!this.initialized || !this.spellChecker) {
      throw new Error('SpellCheckService not initialized');
    }

    // If word is already correct, return it as-is
    if (this.spellChecker.correct(word)) {
      return word.toLowerCase();
    }

    // Get suggestions for misspelled word
    const suggestions = this.spellChecker.suggest(word);
    
    // Return first suggestion if available, otherwise original word
    return suggestions.length > 0 ? suggestions[0].toLowerCase() : word.toLowerCase();
  }

  /**
   * Get the base form after spell correction
   * This combines spell checking and lemmatization for the most canonical form
   */
  getCanonicalForm(word: string): string {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    // First get the correct spelling
    const correctedWord = this.getCorrectSpelling(word);
    
    // Then get the lemma of the corrected word
    const lemma = this.getLemma(correctedWord);
    
    return lemma;
  }

  /**
   * Check if two words are duplicates considering:
   * 1. Case-insensitive matching
   * 2. One word being a plural of the other (ending with 's')
   * 3. Same canonical form (lemmatization)
   */
  areDuplicates(word1: string, word2: string): boolean {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    const lower1 = word1.toLowerCase();
    const lower2 = word2.toLowerCase();

    // Check 1: Exact case-insensitive match
    if (lower1 === lower2) {
      return true;
    }

    // Check 2: Simple plural check (one ends with 's' and the rest matches)
    if ((lower1 === lower2 + 's') || (lower2 === lower1 + 's')) {
      return true;
    }

    // Check 3: Same canonical form (handles more complex plurals and word forms)
    const canonical1 = this.getCanonicalForm(word1);
    const canonical2 = this.getCanonicalForm(word2);
    
    return canonical1 === canonical2;
  }

  /**
   * Check if two words have the same correct spelling
   * This is the main method for quality control - replaces substring checking
   */
  haveSameCorrectSpelling(word1: string, word2: string): boolean {
    if (!this.initialized || !this.spellChecker) {
      throw new Error('SpellCheckService not initialized');
    }

    const correct1 = this.getCorrectSpelling(word1);
    const correct2 = this.getCorrectSpelling(word2);
    
    return correct1 === correct2;
  }

  /**
   * Check if two words have the same canonical form (base word)
   * This accounts for plurals, tenses, and other word forms
   */
  haveSameCanonicalForm(word1: string, word2: string): boolean {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    const canonical1 = this.getCanonicalForm(word1);
    const canonical2 = this.getCanonicalForm(word2);
    
    return canonical1 === canonical2;
  }

  /**
   * Check if any word in a set has the same correct spelling as the given word
   */
  hasMatchingCorrectSpelling(word: string, wordSet: Set<string>): { hasMatch: boolean; matchingWord?: string; correctSpelling?: string } {
    if (!this.initialized || !this.spellChecker) {
      throw new Error('SpellCheckService not initialized');
    }

    const correctSpelling = this.getCorrectSpelling(word);
    
    for (const existingWord of wordSet) {
      const existingCorrectSpelling = this.getCorrectSpelling(existingWord);
      
      if (correctSpelling === existingCorrectSpelling) {
        return {
          hasMatch: true,
          matchingWord: existingWord,
          correctSpelling: correctSpelling
        };
      }
    }
    
    return { hasMatch: false };
  }

  /**
   * Check if any word in a set has the same canonical form as the given word
   * This accounts for plurals, tenses, and other word forms
   */
  hasMatchingCanonicalForm(word: string, wordSet: Set<string>): { hasMatch: boolean; matchingWord?: string; canonicalForm?: string } {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    const canonicalForm = this.getCanonicalForm(word);
    
    for (const existingWord of wordSet) {
      const existingCanonicalForm = this.getCanonicalForm(existingWord);
      
      if (canonicalForm === existingCanonicalForm) {
        return {
          hasMatch: true,
          matchingWord: existingWord,
          canonicalForm: canonicalForm
        };
      }
    }
    
    return { hasMatch: false };
  }

  /**
   * Check if a word is a duplicate of any word in a set
   * Uses the enhanced duplicate detection (case-insensitive, plurals, canonical forms)
   */
  hasDuplicateInSet(word: string, wordSet: Set<string>): { hasMatch: boolean; matchingWord?: string; reason?: string } {
    if (!this.initialized) {
      throw new Error('SpellCheckService not initialized');
    }

    const wordLower = word.toLowerCase();
    
    for (const existingWord of wordSet) {
      if (this.areDuplicates(word, existingWord)) {
        const existingLower = existingWord.toLowerCase();
        
        // Determine the reason for the match
        let reason = 'canonical form';
        if (wordLower === existingLower) {
          reason = 'case-insensitive match';
        } else if (wordLower === existingLower + 's' || existingLower === wordLower + 's') {
          reason = 'plural form';
        }
        
        return {
          hasMatch: true,
          matchingWord: existingWord,
          reason: reason
        };
      }
    }
    
    return { hasMatch: false };
  }

  /**
   * Get statistics about the spell checker
   */
  getStats(): { initialized: boolean; hasSpellChecker: boolean } {
    return {
      initialized: this.initialized,
      hasSpellChecker: this.spellChecker !== null
    };
  }
}