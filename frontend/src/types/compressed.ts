/*
 * Requirements:
 * - Provide a generic type for representing compressed responses
 * - The type includes:
 *    - v: version number
 *    - c: boolean flag indicating if the content is compressed
 *    - d: the compressed data as a string
 * - Also define a helper union type to account for legacy string responses
 */

export interface Compressed<T> {
  v: number;
  c: boolean;
  d: string;
}

// Helper type in case the response might be either a compressed object or a plain string
export type CompressedResponse<T> = Compressed<T> | string; 