import numpy as np
import json

# --- Configuration ---
# Path to the local binary file
MODEL_FILE = '/Users/mh/Downloads/GoogleNews-vectors-negative300.bin'


# --- Output file names ---
# For Python/FAISS/NumPy
NUMPY_VECTORS_FILE = 'word_vectors.npy'
VOCAB_FILE = 'word_vocab.json'



def convert_word2vec():
    """
    Loads the Word2Vec model and converts it into NumPy and JSON formats.
    """
    # --- 1. Load the Model ---
    print(f"Attempting to load the local binary file: {MODEL_FILE}")
    print("This may take several minutes and require a good amount of RAM.")
    
    try:
        from gensim.models import KeyedVectors
        wv = KeyedVectors.load_word2vec_format(MODEL_FILE, binary=True)
    except FileNotFoundError:
        print(f"Error: File not found at {MODEL_FILE}")
        print("Please check the file path is correct.")
        return
    except Exception as e:
        print(f"An unexpected error occurred during load: {e}")
        return
        
    print("Model loaded successfully.")

    # Extract the vectors and the vocabulary list (index_to_key)
    vectors = wv.vectors
    vocab = wv.index_to_key

    # --- 2. Save for Python/FAISS (NumPy format) ---
    print("\n--- Saving for Python/FAISS usage ---")
    try:
        # Save the entire vector matrix in NumPy's binary format (.npy)
        np.save(NUMPY_VECTORS_FILE, vectors)
        print(f"Successfully saved {len(vectors)} vectors to '{NUMPY_VECTORS_FILE}'")

        # Save the corresponding vocabulary list as a JSON file
        with open(VOCAB_FILE, 'w') as f:
            json.dump(vocab, f)
        print(f"Successfully saved {len(vocab)} words to '{VOCAB_FILE}'")
        
        # How to load these back in another Python script:
        # import numpy as np
        # import json
        # loaded_vectors = np.load('word_vectors.npy')
        # with open('word_vocab.json', 'r') as f:
        #     loaded_vocab = json.load(f)

    except Exception as e:
        print(f"An error occurred while saving NumPy/JSON files: {e}")

if __name__ == '__main__':
    # Before running, ensure you have the necessary libraries installed:
    # pip install gensim numpy
    convert_word2vec()
    print("\nConversion process finished.")

