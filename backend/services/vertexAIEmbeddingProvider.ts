import { GoogleGenAI } from "@google/genai";
import { EmbeddingProvider } from './embeddingProvider'; // Import the interface
import logger from '../logger.js'; // Assuming logger is in a similar path

// const GEMINI_EMBEDDING_DIMENSION = 768; // This will be passed in constructor

export class GCPEmbeddingProvider implements EmbeddingProvider {
  private genAI: GoogleGenAI;
  private modelIdForEmbeddings: string; // This will be the model name like 'gemini-embedding-exp-03-07'
  private dimension: number;

  constructor(modelId: string, dimension: number) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        logger.error("GEMINI_API_KEY environment variable not set. VertexAIEmbeddingProvider cannot be initialized.");
        throw new Error("GEMINI_API_KEY environment variable not set.");
    }
    // Initialize with options object, as suggested by linter error and common practice.
    this.genAI = new GoogleGenAI({ apiKey }); 
    this.modelIdForEmbeddings = modelId; // Store the model ID passed from server.ts
    this.dimension = dimension;
    logger.info(`VertexAIEmbeddingProvider initialized with GoogleGenAI for model: ${this.modelIdForEmbeddings}, dimension: ${this.dimension}. ProjectID/LocationID params from constructor are ignored.`);
  }

  async generateEmbedding(textToEmbed: string): Promise<number[] | null> {
    try {
      const response = await this.genAI.models.embedContent({
        model: this.modelIdForEmbeddings,
        contents: [textToEmbed], // Changed to 'contents' and wrapped in an array as it expects multiple contents, even for one.
                                // The JS example uses a single string for 'contents', but TS types often prefer array for 'contents'.
                                // Let's try with an array first. If it complains, we can revert to single string for `contents`.
        config: { // As per JS documentation and linter feedback
          taskType: "SEMANTIC_SIMILARITY" // Use camelCase taskType inside config
        }
      });

      // response.embeddings is ContentEmbedding[]
      // For a single input in `contents`, we expect one ContentEmbedding object.
      if (response && response.embeddings && Array.isArray(response.embeddings) && response.embeddings.length > 0) {
        const embeddingObject = response.embeddings[0];
        if (embeddingObject && embeddingObject.values && Array.isArray(embeddingObject.values)) {
          const values = embeddingObject.values;
          if (values.length !== this.dimension) {
              logger.warn(`VertexAIEmbeddingProvider: Generated embedding dimension (${values.length}) for model '${this.modelIdForEmbeddings}' does not match configured dimension (${this.dimension}). Returning provided embedding anyway.`);
          }
          return values;
        }
      }
      logger.error('VertexAIEmbeddingProvider: Unexpected or empty embedding structure in response from ai.models.embedContent.', { modelId: this.modelIdForEmbeddings, response });
      return null;
    } catch (error) {
      logger.error('VertexAIEmbeddingProvider: Error getting embedding from ai.models.embedContent:', { modelId: this.modelIdForEmbeddings, error });
      return null;
    }
  }

  getDimension(): number {
    return this.dimension;
  }
} 