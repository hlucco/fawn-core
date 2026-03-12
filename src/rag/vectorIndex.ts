import type { Embedding } from './types.js';

/**
 * Abstract interface for vector index backends
 */
export interface VectorIndex {
  /**
   * Add embeddings to the index
   */
  add(embeddings: Embedding[]): void | Promise<void>;

  /**
   * Search for nearest neighbors
   */
  search(queryEmbedding: Embedding, k: number): { indices: number[]; distances: number[] } | Promise<{ indices: number[]; distances: number[] }>;

  /**
   * Get the number of vectors in the index
   */
  size(): number;

  /**
   * Remove vectors by indices
   */
  remove(indices: number[]): void;

  /**
   * Clear all vectors from the index
   */
  clear(): void;

  /**
   * Save index to file (if supported)
   */
  write?(path: string): void;

  /**
   * Load index from file (if supported)
   */
  read?(path: string): void;
}

/**
 * Brute-force vector index using cosine similarity
 */
export class BruteForceIndex implements VectorIndex {
  private embeddings: Embedding[] = [];

  add(embeddings: Embedding[]): void {
    this.embeddings.push(...embeddings);
  }

  search(queryEmbedding: Embedding, k: number): { indices: number[]; distances: number[] } {
    const scores = this.embeddings.map((embedding, index) => ({
      index,
      distance: 1 - this.cosineSimilarity(queryEmbedding, embedding) // Convert similarity to distance
    }));

    // Sort by distance (ascending - lower is better)
    scores.sort((a, b) => a.distance - b.distance);

    const topK = scores.slice(0, Math.min(k, scores.length));
    return {
      indices: topK.map(s => s.index),
      distances: topK.map(s => s.distance)
    };
  }

  size(): number {
    return this.embeddings.length;
  }

  remove(indices: number[]): void {
    const indexSet = new Set(indices);
    this.embeddings = this.embeddings.filter((_, index) => !indexSet.has(index));
  }

  clear(): void {
    this.embeddings = [];
  }

  private cosineSimilarity(a: Embedding, b: Embedding): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

/**
 * FAISS-based vector index for fast approximate nearest neighbor search
 */
export class FAISSIndex implements VectorIndex {
  private index!: {
    add: (vector: number[]) => void;
    search: (vector: number[], k: number) => { labels: number[]; distances: number[] };
    ntotal: () => number;
    write: (path: string) => void;
  };
  private dimension: number;
  private indexType: 'L2' | 'IP';

  constructor(dimension: number, indexType: 'L2' | 'IP' = 'L2') {
    this.dimension = dimension;
    this.indexType = indexType;
    this.initializeIndex();
  }

  private initializeIndex(): void {
    try {
      // Dynamic import to make faiss-node optional
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const faiss = require('faiss-node');

      if (this.indexType === 'IP') {
        this.index = new faiss.IndexFlatIP(this.dimension);
      } else {
        this.index = new faiss.IndexFlatL2(this.dimension);
      }
    } catch {
      throw new Error(
        'faiss-node is not installed. Install it with: pnpm add faiss-node'
      );
    }
  }

  add(embeddings: Embedding[]): void {
    if (embeddings.length === 0) {
      return;
    }

    // FAISS expects a flat array of numbers
    for (const embedding of embeddings) {
      if (embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
        );
      }
      this.index.add(embedding);
    }
  }

  search(queryEmbedding: Embedding, k: number): { indices: number[]; distances: number[] } {
    if (queryEmbedding.length !== this.dimension) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.dimension}, got ${queryEmbedding.length}`
      );
    }

    if (this.size() === 0) {
      return { indices: [], distances: [] };
    }

    const actualK = Math.min(k, this.size());
    const results = this.index.search(queryEmbedding, actualK);

    return {
      indices: results.labels,
      distances: results.distances
    };
  }

  size(): number {
    return this.index.ntotal();
  }

  remove(): void {
    // FAISS doesn't support efficient deletion
    // We would need to rebuild the index without those vectors
    // For now, throw an error - we'll implement this if needed
    throw new Error('Remove operation not supported by FAISS index. Use removeChunks on RAGIndex instead.');
  }

  clear(): void {
    // Reinitialize the index
    this.initializeIndex();
  }

  write(path: string): void {
    this.index.write(path);
  }

  read(path: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const faiss = require('faiss-node');

      if (this.indexType === 'IP') {
        this.index = faiss.IndexFlatIP.read(path);
      } else {
        this.index = faiss.IndexFlatL2.read(path);
      }
    } catch (error) {
      throw new Error(`Failed to read FAISS index from ${path}: ${error}`);
    }
  }
}

/**
 * HNSW-based vector index using pure TypeScript (works on all platforms)
 */
export class HNSWIndex implements VectorIndex {
  private index!: {
    buildIndex: (data: Array<{ id: number; vector: number[] }>) => Promise<void>;
    searchKNN: (query: number[], k: number) => Array<{ id: number; score: number }>;
  };
  private vectors: Embedding[] = []; // Track vectors since HNSW doesn't expose them
  private dimension: number;
  private m: number; // Number of connections per node
  private efConstruction: number; // Size of dynamic candidate list

  private initPromise?: Promise<void>;

  constructor(dimension: number, m: number = 16, efConstruction: number = 200) {
    this.dimension = dimension;
    this.m = m;
    this.efConstruction = efConstruction;
    // Lazy initialization - will be called on first use
  }

  private async ensureInitialized(): Promise<void> {
    if (this.index) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.initializeIndex();
    }
    await this.initPromise;
  }

  private async initializeIndex(): Promise<void> {
    try {
      // Dynamic import works in both CJS and ESM
      const { HNSW } = await import('hnsw');
      // HNSW(M, efConstruction, dimensions, metric)
      this.index = new HNSW(this.m, this.efConstruction, this.dimension, 'cosine');
    } catch (err) {
      throw new Error(
        `hnsw package is not installed or cannot be loaded. Install it with: pnpm add hnsw`
      );
    }
  }

  async add(embeddings: Embedding[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }

    for (const embedding of embeddings) {
      if (embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
        );
      }
    }

    // Ensure index is initialized
    await this.ensureInitialized();

    // Add to our vector list
    this.vectors.push(...embeddings);

    // Rebuild index with all vectors (HNSW requires full rebuild)
    // Convert vectors to format HNSW expects: { id, vector }
    const data = this.vectors.map((vector, id) => ({ id, vector }));
    await this.index.buildIndex(data);
  }

  async search(queryEmbedding: Embedding, k: number): Promise<{ indices: number[]; distances: number[] }> {
    if (queryEmbedding.length !== this.dimension) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.dimension}, got ${queryEmbedding.length}`
      );
    }

    if (this.size() === 0) {
      return { indices: [], distances: [] };
    }

    // Ensure index is initialized
    await this.ensureInitialized();

    const actualK = Math.min(k, this.size());

    // searchKNN returns array of {id, score} objects
    const results = this.index.searchKNN(queryEmbedding, actualK);

    const indices: number[] = [];
    const distances: number[] = [];

    for (const result of results) {
      indices.push(result.id);
      // HNSW returns score (higher is better for similarity)
      // For consistency with our API, we return distance (lower is better)
      // So we convert: distance = 1 - score
      distances.push(1 - result.score);
    }

    return { indices, distances };
  }

  size(): number {
    return this.vectors.length;
  }

  remove(): void {
    throw new Error('Remove operation not supported by HNSW index.');
  }

  clear(): void {
    this.vectors = [];
    // Reset the index and initialization promise
    this.index = undefined as any;
    this.initPromise = undefined;
    // Will be lazy loaded on next use
  }
}

/**
 * Factory function to create a vector index
 */
export function createVectorIndex(
  dimension: number,
  backend: 'bruteforce' | 'faiss' | 'hnsw' = 'bruteforce',
  indexType?: 'L2' | 'IP'
): VectorIndex {
  if (backend === 'faiss') {
    return new FAISSIndex(dimension, indexType || 'L2');
  }
  if (backend === 'hnsw') {
    return new HNSWIndex(dimension);
  }
  return new BruteForceIndex();
}
