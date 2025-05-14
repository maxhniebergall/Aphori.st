export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[] | null>;
  // You might also want a method to get the expected embedding dimension
  getDimension(): number;
} 