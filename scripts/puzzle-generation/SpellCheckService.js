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
    spellChecker = null;
    initialized = false;
    /**
     * Initialize the spell checker with English dictionary
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        try {
            console.log('🔤 Initializing spell checker...');
            // Load the dictionary
            const dict = await new Promise((resolve, reject) => {
                dictionary((err, result) => {
                    if (err)
                        reject(err);
                    else
                        resolve(result);
                });
            });
            // Initialize nspell with the dictionary
            this.spellChecker = nspell(dict);
            this.initialized = true;
            console.log('✅ Spell checker and lemmatizer initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize spell checker:', error);
            throw error;
        }
    }
    /**
     * Check if a word is spelled correctly
     */
    isCorrect(word) {
        if (!this.initialized || !this.spellChecker) {
            throw new Error('SpellCheckService not initialized');
        }
        return this.spellChecker.correct(word);
    }
    /**
     * Get suggestions for a misspelled word
     */
    getSuggestions(word) {
        if (!this.initialized || !this.spellChecker) {
            throw new Error('SpellCheckService not initialized');
        }
        return this.spellChecker.suggest(word);
    }
    /**
     * Get the base form (lemma) of a word
     * This reduces words to their root form (e.g., "running" -> "run", "cats" -> "cat")
     */
    getLemma(word) {
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
    getCorrectSpelling(word) {
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
    getCanonicalForm(word) {
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
     * Check if two words have the same correct spelling
     * This is the main method for quality control - replaces substring checking
     */
    haveSameCorrectSpelling(word1, word2) {
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
    haveSameCanonicalForm(word1, word2) {
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
    hasMatchingCorrectSpelling(word, wordSet) {
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
    hasMatchingCanonicalForm(word, wordSet) {
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
     * Get statistics about the spell checker
     */
    getStats() {
        return {
            initialized: this.initialized,
            hasSpellChecker: this.spellChecker !== null
        };
    }
}
