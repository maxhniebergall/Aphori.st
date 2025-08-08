#!/usr/bin/env python3
"""
Quality Metrics for Themes Puzzle Analysis

Implements sophisticated quality assessment metrics using proper linear algebra
and cluster validation techniques:
- intracategory_word_distinctiveness (using Silhouette-like analysis)
- intercategory_discoherence (using Davies-Bouldin and Calinski-Harabasz concepts)
- intracategory_coherence (using within-cluster compactness)
- difficulty_progression
- textual_similarity_penalty (penalty for textually similar words)
"""

import sys
import os
import numpy as np
from typing import List, Dict, Optional
import math

# Add puzzle generation to path using absolute path
script_dir = os.path.dirname(os.path.abspath(__file__))
puzzle_generation_path = os.path.join(script_dir, '../../puzzle-generation')
sys.path.append(puzzle_generation_path)

try:
    from python_vector_loader import PythonVectorLoader
    VECTORS_AVAILABLE = True
except ImportError:
    print("Warning: Could not import PythonVectorLoader. Using string-based metrics only.")
    PythonVectorLoader = None
    VECTORS_AVAILABLE = False

class QualityMetrics:
    """Calculates quality metrics using linear algebra and cluster validation concepts"""
    
    def __init__(self, vector_loader = None):
        self.vector_loader = vector_loader
        self.python_vector_loader = None
        
        # Auto-initialize PythonVectorLoader if available and no other loader provided
        if vector_loader is None and VECTORS_AVAILABLE:
            try:
                self.python_vector_loader = PythonVectorLoader()
                init_result = self.python_vector_loader.initialize()
                if init_result['success']:
                    print(f"✅ Auto-initialized PythonVectorLoader: {init_result['loadedWords']} words")
                else:
                    print(f"⚠️ PythonVectorLoader initialization failed: {init_result.get('error', 'Unknown error')}")
                    self.python_vector_loader = None
            except Exception as e:
                print(f"⚠️ Could not auto-initialize PythonVectorLoader: {e}")
                self.python_vector_loader = None
        
    def cosine_similarity(self, vector_a: np.ndarray, vector_b: np.ndarray) -> float:
        """
        Calculate cosine similarity between two vectors.
        Formula: cos(θ) = (A · B) / (||A|| * ||B||)
        """
        norm_a = np.linalg.norm(vector_a)
        norm_b = np.linalg.norm(vector_b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        dot_product = np.dot(vector_a, vector_b)
        cosine_sim = dot_product / (norm_a * norm_b)
        
        return max(-1.0, min(1.0, cosine_sim))
    
    def euclidean_distance(self, vector_a: np.ndarray, vector_b: np.ndarray) -> float:
        """Calculate Euclidean distance between two vectors"""
        return np.linalg.norm(vector_a - vector_b)
    
    def get_word_vector(self, word: str) -> Optional[np.ndarray]:
        """Get normalized vector for a word from the vector loader"""
        # Try PythonVectorLoader first if available
        if self.python_vector_loader:
            try:
                return self.python_vector_loader.get_word_vector(word)
            except Exception as e:
                print(f"Warning: Could not get vector for word '{word}' from PythonVectorLoader: {e}")
        
        # Fall back to FullVectorLoader if available
        if not self.vector_loader:
            return None
            
        try:
            word_index = self.vector_loader.wordToIndex.get(word.lower())
            if word_index is None:
                return None
            
            vector = self.vector_loader.vectorCache.get(word_index)
            if vector is None:
                return None
                
            return np.array(vector)
            
        except Exception as e:
            print(f"Warning: Could not get vector for word '{word}': {e}")
            return None
    
    def calculate_intracategory_word_distinctiveness(self, category_words: List[str]) -> float:
        """
        Measure word distinctiveness within a category using Silhouette-inspired analysis.
        
        For each word, calculate:
        - a(i): average distance to other words in same category (should be high for distinctiveness)
        - b(i): average distance to words in other categories (context for comparison)
        
        Distinctiveness = normalized measure of how different words are within the category
        Returns: 0.0 to 1.0, where 1.0 = words are maximally distinct from each other
        """
        if len(category_words) < 2:
            return 1.0  # Single word is perfectly distinct
        
        if not self.vector_loader and not self.python_vector_loader:
            return self._string_based_distinctiveness(category_words)
        
        # Get vectors for all words
        vectors = []
        valid_words = []
        
        for word in category_words:
            vector = self.get_word_vector(word)
            if vector is not None:
                vectors.append(vector)
                valid_words.append(word)
        
        if len(vectors) < 2:
            return self._string_based_distinctiveness(category_words)
        
        # Calculate average intra-category distances (higher = more distinct)
        intra_distances = []
        for i in range(len(vectors)):
            distances_to_others = []
            for j in range(len(vectors)):
                if i != j:
                    dist = self.euclidean_distance(vectors[i], vectors[j])
                    distances_to_others.append(dist)
            
            if distances_to_others:
                avg_intra_distance = np.mean(distances_to_others)
                intra_distances.append(avg_intra_distance)
        
        if not intra_distances:
            return 0.0
        
        # Normalize distances to [0,1] range
        # Higher average intra-category distance = higher distinctiveness
        avg_intra_distance = np.mean(intra_distances)
        
        # Normalize using typical vector space distances (empirically ~0.5-2.0 for normalized vectors)
        # Map [0, 2.0] to [0, 1.0]
        distinctiveness = min(1.0, avg_intra_distance / 2.0)
        
        return distinctiveness
    
    def calculate_intercategory_discoherence(self, puzzle_categories: List[List[str]]) -> float:
        """
        Measure category separation using Davies-Bouldin and Calinski-Harabasz inspired metrics.
        
        Calculates:
        1. Within-category compactness (WCSS - Within-Cluster Sum of Squares)
        2. Between-category separation (BCSS - Between-Cluster Sum of Squares)  
        3. Returns ratio that measures how well-separated categories are
        
        Returns: 0.0 to 1.0, where 1.0 = categories are maximally separated
        """
        if len(puzzle_categories) < 2:
            return 1.0  # Single category is perfectly separated
        
        if not self.vector_loader and not self.python_vector_loader:
            return self._string_based_discoherence(puzzle_categories)
        
        # Get vectors for all categories and calculate centroids
        category_data = []
        all_vectors = []
        
        for category_words in puzzle_categories:
            vectors = []
            for word in category_words:
                vector = self.get_word_vector(word)
                if vector is not None:
                    vectors.append(vector)
                    all_vectors.append(vector)
            
            if vectors:
                centroid = np.mean(vectors, axis=0)
                category_data.append({
                    'vectors': vectors,
                    'centroid': centroid,
                    'size': len(vectors)
                })
        
        if len(category_data) < 2:
            return self._string_based_discoherence(puzzle_categories)
        
        # Calculate overall centroid
        if all_vectors:
            overall_centroid = np.mean(all_vectors, axis=0)
        else:
            return 0.0
        
        # Calculate Within-Category Sum of Squares (WCSS)
        wcss = 0.0
        total_points = 0
        
        for cat_data in category_data:
            for vector in cat_data['vectors']:
                distance_to_centroid = self.euclidean_distance(vector, cat_data['centroid'])
                wcss += distance_to_centroid ** 2
                total_points += 1
        
        # Calculate Between-Category Sum of Squares (BCSS)
        bcss = 0.0
        
        for cat_data in category_data:
            distance_to_overall = self.euclidean_distance(cat_data['centroid'], overall_centroid)
            bcss += cat_data['size'] * (distance_to_overall ** 2)
        
        # Calculate Calinski-Harabasz inspired ratio
        # CH = (BCSS / (k-1)) / (WCSS / (n-k))
        # where k = number of categories, n = total points
        
        k = len(category_data)
        n = total_points
        
        if wcss == 0 or n <= k:
            return 1.0  # Perfect separation
        
        ch_ratio = (bcss / (k - 1)) / (wcss / (n - k))
        
        # Normalize CH ratio to [0,1] range
        # Higher CH ratio = better separation
        # Typical CH values range from ~1 to ~1000+, use log scaling
        normalized_ratio = min(1.0, math.log(1 + ch_ratio) / math.log(1001))  # log(1001) ≈ 6.9
        
        return normalized_ratio
    
    def calculate_intracategory_coherence(self, category_words: List[str], theme_word: str = None) -> float:
        """
        Measure category coherence using within-cluster compactness analysis.
        
        Calculates how tightly clustered words are within the category,
        with bonus weighting for coherence to theme word.
        
        Returns: 0.0 to 1.0, where 1.0 = words are maximally coherent
        """
        if len(category_words) < 2:
            return 1.0  # Single word is perfectly coherent
        
        if not self.vector_loader and not self.python_vector_loader:
            return self._string_based_coherence(category_words)
        
        # Get vectors for category words
        vectors = []
        valid_words = []
        
        for word in category_words:
            vector = self.get_word_vector(word)
            if vector is not None:
                vectors.append(vector)
                valid_words.append(word)
        
        if len(vectors) < 2:
            return self._string_based_coherence(category_words)
        
        # Calculate category centroid
        centroid = np.mean(vectors, axis=0)
        
        # Calculate within-category compactness (lower distances = higher coherence)
        distances_to_centroid = []
        for vector in vectors:
            distance = self.euclidean_distance(vector, centroid)
            distances_to_centroid.append(distance)
        
        avg_distance_to_centroid = np.mean(distances_to_centroid)
        
        # Convert distance to coherence (inverse relationship)
        # Map typical distances [0, 2.0] to coherence [1.0, 0.0]
        base_coherence = max(0.0, 1.0 - (avg_distance_to_centroid / 2.0))
        
        # Theme coherence bonus
        theme_bonus = 0.0
        if theme_word:
            theme_vector = self.get_word_vector(theme_word)
            if theme_vector is not None:
                # Calculate how close category centroid is to theme
                theme_distance = self.euclidean_distance(centroid, theme_vector)
                theme_coherence = max(0.0, 1.0 - (theme_distance / 2.0))
                theme_bonus = theme_coherence * 0.3  # 30% bonus weight
        
        # Combine base coherence with theme bonus
        total_coherence = min(1.0, base_coherence + theme_bonus)
        
        return total_coherence
    
    def calculate_difficulty_progression(self, categories: List[Dict]) -> float:
        """
        Measure how well difficulty progresses across categories.
        Perfect score (1.0) means strictly increasing difficulty.
        """
        if len(categories) < 2:
            return 1.0
        
        difficulties = [cat.get('difficulty', 0) for cat in categories]
        
        # Check for strictly increasing progression
        violations = 0
        for i in range(1, len(difficulties)):
            if difficulties[i] <= difficulties[i-1]:  # Should be strictly increasing
                violations += 1
        
        # Calculate progression score
        max_violations = len(difficulties) - 1
        if max_violations == 0:
            return 1.0
            
        progression_score = 1.0 - (violations / max_violations)
        
        return max(0.0, min(1.0, progression_score))
    
    # Fallback string-based methods for when vectors aren't available
    def _string_based_distinctiveness(self, words: List[str]) -> float:
        """Calculate distinctiveness using string-based metrics"""
        if len(words) < 2:
            return 1.0
        
        similarities = []
        for i in range(len(words)):
            for j in range(i + 1, len(words)):
                edit_sim = self._edit_distance_similarity(words[i], words[j])
                char_sim = self._character_overlap_similarity(words[i], words[j])
                combined_sim = (edit_sim + char_sim) / 2
                similarities.append(combined_sim)
        
        avg_similarity = np.mean(similarities)
        return 1.0 - avg_similarity  # Inverse for distinctiveness
    
    def _string_based_discoherence(self, categories: List[List[str]]) -> float:
        """Calculate discoherence using string-based metrics"""
        if len(categories) < 2:
            return 1.0
        
        # Calculate within-category similarities
        within_similarities = []
        for cat_words in categories:
            if len(cat_words) >= 2:
                cat_sims = []
                for i in range(len(cat_words)):
                    for j in range(i + 1, len(cat_words)):
                        edit_sim = self._edit_distance_similarity(cat_words[i], cat_words[j])
                        char_sim = self._character_overlap_similarity(cat_words[i], cat_words[j])
                        combined_sim = (edit_sim + char_sim) / 2
                        cat_sims.append(combined_sim)
                
                if cat_sims:
                    within_similarities.extend(cat_sims)
        
        # Calculate between-category similarities
        between_similarities = []
        for i in range(len(categories)):
            for j in range(i + 1, len(categories)):
                for word1 in categories[i]:
                    for word2 in categories[j]:
                        edit_sim = self._edit_distance_similarity(word1, word2)
                        char_sim = self._character_overlap_similarity(word1, word2)
                        combined_sim = (edit_sim + char_sim) / 2
                        between_similarities.append(combined_sim)
        
        # Discoherence = low between-category similarity relative to within-category similarity
        if not between_similarities or not within_similarities:
            return 0.5
        
        avg_within = np.mean(within_similarities)
        avg_between = np.mean(between_similarities)
        
        # Higher within-category similarity and lower between-category similarity = higher discoherence
        if avg_within == 0:
            return 1.0 - avg_between
        
        discoherence = (avg_within - avg_between) / avg_within
        return max(0.0, min(1.0, discoherence))
    
    def _string_based_coherence(self, words: List[str]) -> float:
        """Calculate coherence using string-based metrics"""
        if len(words) < 2:
            return 1.0
        
        similarities = []
        for i in range(len(words)):
            for j in range(i + 1, len(words)):
                edit_sim = self._edit_distance_similarity(words[i], words[j])
                char_sim = self._character_overlap_similarity(words[i], words[j])
                combined_sim = (edit_sim + char_sim) / 2
                similarities.append(combined_sim)
        
        return np.mean(similarities) if similarities else 0.0
    
    def _edit_distance_similarity(self, word1: str, word2: str) -> float:
        """Calculate similarity based on edit distance"""
        def edit_distance(s1: str, s2: str) -> int:
            m, n = len(s1), len(s2)
            dp = [[0] * (n + 1) for _ in range(m + 1)]
            
            for i in range(m + 1):
                dp[i][0] = i
            for j in range(n + 1):
                dp[0][j] = j
            
            for i in range(1, m + 1):
                for j in range(1, n + 1):
                    if s1[i-1] == s2[j-1]:
                        dp[i][j] = dp[i-1][j-1]
                    else:
                        dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
            
            return dp[m][n]
        
        max_len = max(len(word1), len(word2))
        if max_len == 0:
            return 1.0
        
        distance = edit_distance(word1.lower(), word2.lower())
        similarity = 1.0 - (distance / max_len)
        
        return max(0.0, similarity)
    
    def _character_overlap_similarity(self, word1: str, word2: str) -> float:
        """Calculate similarity based on character overlap (Jaccard similarity)"""
        set1 = set(word1.lower())
        set2 = set(word2.lower())
        
        if not set1 and not set2:
            return 1.0
        
        intersection = len(set1 & set2)
        union = len(set1 | set2)
        
        return intersection / union if union > 0 else 0.0

    def _longest_common_substring_ratio(self, word1: str, word2: str) -> float:
        """Calculate similarity based on longest common substring"""
        word1, word2 = word1.lower(), word2.lower()
        m, n = len(word1), len(word2)
        
        if m == 0 or n == 0:
            return 0.0
        
        # Create DP table for LCS length
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        max_length = 0
        
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if word1[i-1] == word2[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                    max_length = max(max_length, dp[i][j])
                else:
                    dp[i][j] = 0
        
        # Return ratio of longest common substring to average word length
        avg_length = (m + n) / 2
        return max_length / avg_length if avg_length > 0 else 0.0

    def calculate_textual_similarity_penalty(self, words: List[str]) -> float:
        """
        Calculate a penalty score based on textual similarity between words.
        Higher penalty (closer to 1.0) means words are more textually similar.
        Lower penalty (closer to 0.0) means words are more textually distinct.
        
        This combines multiple similarity measures:
        - Character overlap (Jaccard similarity on character sets)
        - Edit distance similarity (Levenshtein distance)
        - Longest common substring ratio
        
        Returns: 0.0 to 1.0, where 1.0 = maximum textual similarity penalty
        """
        if len(words) < 2:
            return 0.0  # No penalty for single word
        
        similarities = []
        
        for i in range(len(words)):
            for j in range(i + 1, len(words)):
                word1, word2 = words[i], words[j]
                
                # Calculate multiple similarity measures
                char_overlap = self._character_overlap_similarity(word1, word2)
                edit_distance_sim = self._edit_distance_similarity(word1, word2)
                lcs_ratio = self._longest_common_substring_ratio(word1, word2)
                
                # Weighted combination - emphasizing character overlap and LCS
                combined_similarity = (
                    char_overlap * 0.4 +
                    edit_distance_sim * 0.3 +
                    lcs_ratio * 0.3
                )
                
                similarities.append(combined_similarity)
        
        # Return average similarity as penalty score
        return np.mean(similarities) if similarities else 0.0
    
    def calculate_all_metrics(self, puzzle: Dict) -> Dict[str, float]:
        """Calculate all quality metrics for a puzzle"""
        metrics = {}
        
        if 'categories' not in puzzle:
            return metrics
        
        categories = puzzle['categories']
        category_words = [cat.get('words', []) for cat in categories]
        
        # Intracategory word distinctiveness (average across categories)
        distinctiveness_scores = []
        for words in category_words:
            if words:
                score = self.calculate_intracategory_word_distinctiveness(words)
                distinctiveness_scores.append(score)
        
        metrics['intracategory_word_distinctiveness'] = (
            np.mean(distinctiveness_scores) if distinctiveness_scores else 0.0
        )
        
        # Intercategory discoherence
        metrics['intercategory_discoherence'] = self.calculate_intercategory_discoherence(category_words)
        
        # Intracategory coherence (average across categories)
        coherence_scores = []
        for _, cat in enumerate(categories):
            words = cat.get('words', [])
            theme = cat.get('themeWord')
            if words:
                score = self.calculate_intracategory_coherence(words, theme)
                coherence_scores.append(score)
        
        metrics['intracategory_coherence'] = (
            np.mean(coherence_scores) if coherence_scores else 0.0
        )
        
        # Difficulty progression
        metrics['difficulty_progression'] = self.calculate_difficulty_progression(categories)
        
        # Textual similarity penalty (average across all categories)
        textual_similarity_penalties = []
        for words in category_words:
            if words and len(words) >= 2:  # Only calculate for categories with multiple words
                penalty = self.calculate_textual_similarity_penalty(words)
                textual_similarity_penalties.append(penalty)
        
        metrics['textual_similarity_penalty'] = (
            np.mean(textual_similarity_penalties) if textual_similarity_penalties else 0.0
        )
        
        # Additional metrics for context
        metrics['generation_success_rate'] = 1.0  # Will be calculated at puzzle level
        
        # Overall quality score (weighted combination)
        # Note: textual_similarity_penalty is subtracted since higher penalty = lower quality
        weights = {
            'intracategory_word_distinctiveness': 0.20,
            'intercategory_discoherence': 0.20,
            'intracategory_coherence': 0.30,
            'difficulty_progression': 0.10,
            'textual_similarity_penalty': -0.20  # Negative weight since it's a penalty
        }
        
        overall_score = sum(
            metrics.get(metric, 0.0) * weight 
            for metric, weight in weights.items()
        )
        
        # Ensure overall score stays within [0, 1] range
        overall_score = max(0.0, min(1.0, overall_score))
        
        metrics['overall_quality_score'] = overall_score
        
        return metrics

def test_quality_metrics():
    """Test the quality metrics with sample data"""
    print("🧪 Testing Quality Metrics with Linear Algebra Approach")
    
    # Sample puzzle data
    sample_puzzle = {
        'categories': [
            {
                'words': ['cat', 'dog', 'bird', 'fish'],
                'themeWord': 'animal',
                'difficulty': 1
            },
            {
                'words': ['red', 'blue', 'green', 'yellow'],
                'themeWord': 'color',
                'difficulty': 2
            },
            {
                'words': ['run', 'walk', 'jump', 'swim'],
                'themeWord': 'action',
                'difficulty': 3
            },
            {
                'words': ['car', 'bus', 'train', 'plane'],
                'themeWord': 'transport',
                'difficulty': 4
            }
        ]
    }
    
    # Test with automatic vector loader initialization
    print("\n📊 Testing with quality metrics (auto-detecting vector availability):")
    metrics_calculator = QualityMetrics()
    metrics = metrics_calculator.calculate_all_metrics(sample_puzzle)
    
    # Report which vector system is being used
    if metrics_calculator.python_vector_loader:
        print("🔍 Using PythonVectorLoader for real semantic similarity")
    elif metrics_calculator.vector_loader:
        print("🔍 Using FullVectorLoader for semantic similarity")
    else:
        print("🔍 Using string-based fallback metrics (no vector loader available)")
    
    for metric, value in metrics.items():
        print(f"   {metric}: {value:.3f}")
    
    print("\n🔬 Metric Interpretations:")
    print("   - intracategory_word_distinctiveness: How different words are within each category")
    print("   - intercategory_discoherence: How well-separated categories are from each other")
    print("   - intracategory_coherence: How well words relate within categories and to themes")
    print("   - difficulty_progression: Whether difficulty increases appropriately")
    print("   - textual_similarity_penalty: Penalty for textually similar words (higher = worse quality)")
    print("   - overall_quality_score: Weighted combination of all metrics")
    
    return metrics

if __name__ == "__main__":
    test_quality_metrics()