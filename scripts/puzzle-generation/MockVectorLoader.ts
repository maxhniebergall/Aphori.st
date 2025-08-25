/**
 * Mock Vector Loader for Testing
 * Provides a simplified implementation for testing the puzzle generation system
 */

import { SearchResult, VectorLoadResult } from './FullVectorLoader.js';

export class MockVectorLoader {
  private mockVocabulary: string[] = [];
  private initialized: boolean = false;

  /**
   * Initialize with mock data
   */
  async initialize(): Promise<VectorLoadResult> {
    if (this.initialized) {
      return {
        totalWords: this.mockVocabulary.length,
        loadedWords: this.mockVocabulary.length,
        dimension: 300,
        success: true
      };
    }

    console.log('🧪 Initializing Mock Vector Loader for testing...');
    
    // Create mock vocabulary with themed word groups
    this.mockVocabulary = [
      // Animals
      'cat', 'dog', 'bird', 'fish', 'horse', 'cow', 'sheep', 'pig', 'duck', 'chicken',
      'lion', 'tiger', 'bear', 'wolf', 'fox', 'deer', 'rabbit', 'mouse', 'rat', 'elephant',
      'monkey', 'giraffe', 'zebra', 'hippo', 'rhino', 'kangaroo', 'koala', 'panda', 'whale', 'dolphin',
      
      // Colors
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
      'gray', 'silver', 'gold', 'bronze', 'crimson', 'scarlet', 'navy', 'teal', 'lime', 'coral',
      'violet', 'indigo', 'turquoise', 'maroon', 'olive', 'beige', 'tan', 'ivory', 'pearl', 'ruby',
      
      // Food
      'apple', 'banana', 'orange', 'grape', 'cherry', 'berry', 'peach', 'pear', 'plum', 'mango',
      'bread', 'cheese', 'milk', 'butter', 'egg', 'meat', 'chicken', 'beef', 'pork', 'fish',
      'rice', 'pasta', 'pizza', 'burger', 'salad', 'soup', 'cake', 'cookie', 'candy', 'chocolate',
      
      // Transportation
      'car', 'bus', 'train', 'plane', 'boat', 'ship', 'bike', 'truck', 'taxi', 'subway',
      'ferry', 'yacht', 'jet', 'rocket', 'scooter', 'motor', 'auto', 'van', 'wagon', 'coach',
      'vessel', 'craft', 'vehicle', 'ride', 'transit', 'journey', 'travel', 'drive', 'fly', 'sail',
      
      // Sports
      'soccer', 'tennis', 'golf', 'swim', 'run', 'jump', 'throw', 'catch', 'kick', 'hit',
      'ball', 'game', 'play', 'sport', 'team', 'match', 'race', 'win', 'lose', 'score',
      'field', 'court', 'pool', 'track', 'gym', 'coach', 'player', 'athlete', 'medal', 'trophy',
      
      // Nature
      'tree', 'flower', 'grass', 'leaf', 'branch', 'root', 'stem', 'seed', 'bloom', 'grow',
      'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'storm', 'light', 'dark',
      'mountain', 'hill', 'valley', 'river', 'lake', 'ocean', 'beach', 'forest', 'desert', 'island',
      
      // Technology
      'computer', 'phone', 'tablet', 'screen', 'keyboard', 'mouse', 'camera', 'video', 'audio', 'sound',
      'internet', 'website', 'email', 'message', 'call', 'text', 'app', 'software', 'hardware', 'digital',
      'online', 'virtual', 'cloud', 'data', 'file', 'code', 'program', 'system', 'network', 'server',
      
      // Music
      'song', 'music', 'melody', 'rhythm', 'beat', 'tune', 'note', 'chord', 'voice', 'sing',
      'piano', 'guitar', 'drum', 'violin', 'flute', 'horn', 'band', 'orchestra', 'concert', 'stage',
      'album', 'track', 'record', 'play', 'listen', 'hear', 'sound', 'loud', 'quiet', 'volume'
    ];

    this.initialized = true;
    
    console.log(`✅ Mock loader initialized with ${this.mockVocabulary.length} words`);
    
    return {
      totalWords: this.mockVocabulary.length,
      loadedWords: this.mockVocabulary.length,
      dimension: 300,
      success: true
    };
  }

  /**
   * Find similar words using mock similarity based on categories
   */
  async findNearest(word: string, k: number): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error('MockVectorLoader not initialized');
    }

    const wordLower = word.toLowerCase();
    const results: SearchResult[] = [];
    
    // Define mock category mappings
    const categories = {
      animals: ['cat', 'dog', 'bird', 'fish', 'horse', 'cow', 'sheep', 'pig', 'duck', 'chicken',
               'lion', 'tiger', 'bear', 'wolf', 'fox', 'deer', 'rabbit', 'mouse', 'rat', 'elephant',
               'monkey', 'giraffe', 'zebra', 'hippo', 'rhino', 'kangaroo', 'koala', 'panda', 'whale', 'dolphin'],
      colors: ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
              'gray', 'silver', 'gold', 'bronze', 'crimson', 'scarlet', 'navy', 'teal', 'lime', 'coral',
              'violet', 'indigo', 'turquoise', 'maroon', 'olive', 'beige', 'tan', 'ivory', 'pearl', 'ruby'],
      food: ['apple', 'banana', 'orange', 'grape', 'cherry', 'berry', 'peach', 'pear', 'plum', 'mango',
             'bread', 'cheese', 'milk', 'butter', 'egg', 'meat', 'beef', 'pork',
             'rice', 'pasta', 'pizza', 'burger', 'salad', 'soup', 'cake', 'cookie', 'candy', 'chocolate'],
      transportation: ['car', 'bus', 'train', 'plane', 'boat', 'ship', 'bike', 'truck', 'taxi', 'subway',
                      'ferry', 'yacht', 'jet', 'rocket', 'scooter', 'motor', 'auto', 'van', 'wagon', 'coach',
                      'vessel', 'craft', 'vehicle', 'ride', 'transit', 'journey', 'travel', 'drive', 'fly', 'sail'],
      sports: ['soccer', 'tennis', 'golf', 'swim', 'run', 'jump', 'throw', 'catch', 'kick', 'hit',
              'ball', 'game', 'play', 'sport', 'team', 'match', 'race', 'win', 'lose', 'score',
              'field', 'court', 'pool', 'track', 'gym', 'coach', 'player', 'athlete', 'medal', 'trophy'],
      nature: ['tree', 'flower', 'grass', 'leaf', 'branch', 'root', 'stem', 'seed', 'bloom', 'grow',
              'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'storm', 'light', 'dark',
              'mountain', 'hill', 'valley', 'river', 'lake', 'ocean', 'beach', 'forest', 'desert', 'island'],
      technology: ['computer', 'phone', 'tablet', 'screen', 'keyboard', 'mouse', 'camera', 'video', 'audio', 'sound',
                  'internet', 'website', 'email', 'message', 'call', 'text', 'app', 'software', 'hardware', 'digital',
                  'online', 'virtual', 'cloud', 'data', 'file', 'code', 'program', 'system', 'network', 'server'],
      music: ['song', 'music', 'melody', 'rhythm', 'beat', 'tune', 'note', 'chord', 'voice', 'sing',
             'piano', 'guitar', 'drum', 'violin', 'flute', 'horn', 'band', 'orchestra', 'concert', 'stage',
             'album', 'track', 'record', 'play', 'listen', 'hear', 'sound', 'loud', 'quiet', 'volume']
    };

    // Find which category the word belongs to
    let targetCategory: string[] = [];
    for (const [categoryName, words] of Object.entries(categories)) {
      if (words.includes(wordLower)) {
        targetCategory = words;
        break;
      }
    }

    // If word not found in any category, return cross-category results
    if (targetCategory.length === 0) {
      console.log(`⚠️ Word "${word}" not found in mock categories`);
      // Return random words from different categories
      targetCategory = this.mockVocabulary.slice(0, k * 2);
    }

    // Create mock similarity results
    let candidateWords = targetCategory.filter(w => w !== wordLower);
    
    // If not enough words in category, add from other categories with lower similarity
    if (candidateWords.length < k) {
      const otherWords = this.mockVocabulary.filter(w => 
        w !== wordLower && !candidateWords.includes(w)
      );
      candidateWords = [...candidateWords, ...otherWords.slice(0, k - candidateWords.length)];
    }

    // Create results with mock similarity scores
    for (let i = 0; i < Math.min(k, candidateWords.length); i++) {
      const candidateWord = candidateWords[i];
      
      // Mock similarity: higher for same category, decreasing with position
      const isInSameCategory = targetCategory.includes(candidateWord);
      const baseSimilarity = isInSameCategory ? 0.9 : 0.4;
      const positionPenalty = i * 0.05; // Decrease similarity by position
      const similarity = Math.max(0.3, baseSimilarity - positionPenalty);
      
      results.push({
        word: candidateWord,
        similarity: similarity
      });
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, k);
  }

  /**
   * Get a random seed word
   */
  getRandomSeedWord(): string {
    if (!this.initialized) {
      throw new Error('MockVectorLoader not initialized');
    }

    // Select from high-quality seed words
    const goodSeedWords = [
      'animal', 'color', 'food', 'transport', 'sport', 'nature', 'tech', 'music',
      'cat', 'red', 'apple', 'car', 'soccer', 'tree', 'computer', 'song'
    ];
    
    return goodSeedWords[Math.floor(Math.random() * goodSeedWords.length)];
  }

  /**
   * Get a random seed word with frequency filtering (mock implementation)
   */
  getRandomSeedWordWithFrequency(frequencyThreshold: number, maxAttempts: number = 50): string {
    // For mock, just return a random seed word
    return this.getRandomSeedWord();
  }

  /**
   * Find nearest neighbors with quality controls (mock implementation)
   */
  async findNearestWithQualityControls(
    word: string, 
    k: number, 
    existingWords: Set<string>, 
    frequencyThreshold: number
  ): Promise<SearchResult[]> {
    // Get candidates using the existing findNearest method
    const candidates = await this.findNearest(word, k * 2);
    
    // Filter out existing words
    const filtered = candidates.filter(candidate => !existingWords.has(candidate.word));
    
    // Return up to k results
    return filtered.slice(0, k);
  }


  /**
   * Get stats for mock loader
   */
  getStats(): {
    totalVocabulary: number;
    loadedVectors: number;
    memoryUsage: string;
  } {
    return {
      totalVocabulary: this.mockVocabulary.length,
      loadedVectors: this.mockVocabulary.length,
      memoryUsage: '~1MB (mock data)'
    };
  }
}