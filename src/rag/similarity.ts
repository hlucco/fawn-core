import type { Embedding } from './types.js';

/**
 * Calculate cosine similarity between two vectors
 * Returns a value between -1 and 1, where 1 means identical direction
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(vector: Embedding): Embedding {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map(val => val / magnitude);
}

/**
 * Calculate dot product of two vectors (assumes normalized vectors)
 */
export function dotProduct(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i] * b[i];
  }

  return result;
}
