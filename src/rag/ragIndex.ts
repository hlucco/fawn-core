import type {
  EmbeddedChunk,
  TextChunk,
  SimilaritySearchResult,
  ChunkingConfig
} from './types.js';
import type { EmbeddingProvider } from './embeddingProvider.js';
import { chunkText } from './chunking.js';
import { createVectorIndex, type VectorIndex } from './vectorIndex.js';

export type VectorBackend = 'bruteforce' | 'faiss' | 'hnsw';
export type FAISSIndexType = 'L2' | 'IP';

export interface RAGIndexConfig {
  embeddingProvider: EmbeddingProvider;
  chunkingConfig: ChunkingConfig;
  batchSize?: number;
  vectorBackend?: VectorBackend;
  faissIndexType?: FAISSIndexType;
}

/**
 * RAG Index for storing and querying text chunks using vector embeddings
 */
export class RAGIndex {
  private chunks: EmbeddedChunk[] = [];
  private config: RAGIndexConfig;
  private vectorIndex: VectorIndex;

  constructor(config: RAGIndexConfig) {
    this.config = config;
    const backend = config.vectorBackend || 'bruteforce';
    this.vectorIndex = createVectorIndex(
      config.embeddingProvider.dimensions,
      backend,
      config.faissIndexType
    );
  }

  /**
   * Get the number of chunks in the index
   */
  get size(): number {
    return this.chunks.length;
  }

  /**
   * Get all chunks in the index
   */
  getChunks(): EmbeddedChunk[] {
    return [...this.chunks];
  }

  /**
   * Add text to the index (will be chunked and embedded)
   */
  async addText(
    text: string,
    metadata?: Record<string, unknown>,
    idPrefix?: string
  ): Promise<void> {
    const textChunks = chunkText(text, this.config.chunkingConfig, idPrefix);
    await this.addChunks(textChunks, metadata);
  }

  /**
   * Add multiple texts to the index
   */
  async addTexts(
    texts: string[],
    metadata?: Record<string, unknown>[],
    idPrefix?: string
  ): Promise<void> {
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const meta = metadata?.[i];
      const prefix = idPrefix ? `${idPrefix}-${i}` : `text-${i}`;
      await this.addText(text, meta, prefix);
    }
  }

  /**
   * Add pre-chunked text to the index
   */
  async addChunks(
    textChunks: TextChunk[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (textChunks.length === 0) {
      return;
    }

    // Generate embeddings in batches
    const batchSize = this.config.batchSize || 100;
    const texts = textChunks.map(c => c.text);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.config.embeddingProvider.generateEmbeddings(batch);

      // Add to vector index (may be async for HNSW)
      await Promise.resolve(this.vectorIndex.add(embeddings));

      // Store chunks with metadata
      for (let j = 0; j < batch.length; j++) {
        const chunkIndex = i + j;
        const chunk = textChunks[chunkIndex];
        this.chunks.push({
          ...chunk,
          embedding: embeddings[j],
          metadata: { ...chunk.metadata, ...metadata }
        });
      }
    }
  }

  /**
   * Query the index for similar chunks
   */
  async query(
    queryText: string,
    options: {
      topK?: number;
      minScore?: number;
      filter?: (chunk: EmbeddedChunk) => boolean;
    } = {}
  ): Promise<SimilaritySearchResult[]> {
    const { topK = 5, minScore = 0, filter } = options;

    if (this.chunks.length === 0) {
      return [];
    }

    // Generate embedding for query
    const [queryEmbedding] = await this.config.embeddingProvider.generateEmbeddings([
      queryText
    ]);

    // If filter is provided, fall back to brute force search
    if (filter) {
      return this.bruteForceQuery(queryEmbedding, topK, minScore, filter);
    }

    // Use vector index for fast search (may be async for HNSW)
    const searchResults = await Promise.resolve(this.vectorIndex.search(queryEmbedding, topK * 2)); // Get more results for filtering

    // Convert distances to similarity scores and filter
    const results: SimilaritySearchResult[] = [];
    for (let i = 0; i < searchResults.indices.length; i++) {
      const index = searchResults.indices[i];
      const distance = searchResults.distances[i];

      // Convert distance to similarity score based on backend
      let score: number;
      if (this.config.vectorBackend === 'hnsw') {
        // HNSW with cosine returns distance [0, 2], convert to similarity [0, 1]
        score = 1 - (distance / 2);
      } else if (this.config.faissIndexType === 'IP') {
        // FAISS IP: distance is already similarity
        score = distance;
      } else {
        // FAISS L2: similarity = 1 / (1 + distance)
        score = 1 / (1 + distance);
      }

      if (score >= minScore) {
        results.push({
          chunk: this.chunks[index],
          score
        });
      }
    }

    // Return top K after filtering
    return results.slice(0, topK);
  }

  /**
   * Brute force query for when filters are applied
   */
  private bruteForceQuery(
    queryEmbedding: number[],
    topK: number,
    minScore: number,
    filter: (chunk: EmbeddedChunk) => boolean
  ): SimilaritySearchResult[] {
    const results: SimilaritySearchResult[] = [];

    for (const chunk of this.chunks) {
      if (!filter(chunk)) {
        continue;
      }

      // Calculate cosine similarity
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        results.push({ chunk, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
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

  /**
   * Query with multiple query texts (uses average embedding)
   */
  async queryMultiple(
    queryTexts: string[],
    options: {
      topK?: number;
      minScore?: number;
      filter?: (chunk: EmbeddedChunk) => boolean;
    } = {}
  ): Promise<SimilaritySearchResult[]> {
    const { topK = 5, minScore = 0, filter } = options;

    if (this.chunks.length === 0 || queryTexts.length === 0) {
      return [];
    }

    // Generate embeddings for all queries
    const queryEmbeddings = await this.config.embeddingProvider.generateEmbeddings(
      queryTexts
    );

    // Average the query embeddings
    const avgEmbedding = new Array(queryEmbeddings[0].length).fill(0);
    for (const embedding of queryEmbeddings) {
      for (let i = 0; i < embedding.length; i++) {
        avgEmbedding[i] += embedding[i];
      }
    }
    for (let i = 0; i < avgEmbedding.length; i++) {
      avgEmbedding[i] /= queryEmbeddings.length;
    }

    // If filter is provided, fall back to brute force search
    if (filter) {
      return this.bruteForceQuery(avgEmbedding, topK, minScore, filter);
    }

    // Use vector index for fast search (may be async for HNSW)
    const searchResults = await Promise.resolve(this.vectorIndex.search(avgEmbedding, topK * 2));

    // Convert distances to similarity scores and filter
    const results: SimilaritySearchResult[] = [];
    for (let i = 0; i < searchResults.indices.length; i++) {
      const index = searchResults.indices[i];
      const distance = searchResults.distances[i];

      // Convert distance to similarity score based on backend
      let score: number;
      if (this.config.vectorBackend === 'hnsw') {
        score = 1 - (distance / 2);
      } else if (this.config.faissIndexType === 'IP') {
        score = distance;
      } else {
        score = 1 / (1 + distance);
      }

      if (score >= minScore) {
        results.push({
          chunk: this.chunks[index],
          score
        });
      }
    }

    return results.slice(0, topK);
  }

  /**
   * Clear all chunks from the index
   */
  clear(): void {
    this.chunks = [];
    this.vectorIndex.clear();
  }

  /**
   * Remove chunks by ID
   */
  removeChunks(ids: string[]): number {
    const idSet = new Set(ids);
    const initialLength = this.chunks.length;

    // Find indices to remove
    const indicesToRemove: number[] = [];
    for (let i = 0; i < this.chunks.length; i++) {
      if (idSet.has(this.chunks[i].id)) {
        indicesToRemove.push(i);
      }
    }

    // Remove from chunks array
    this.chunks = this.chunks.filter(chunk => !idSet.has(chunk.id));

    // For FAISS backend, we need to rebuild the index
    if (indicesToRemove.length > 0 && this.config.vectorBackend === 'faiss') {
      this.rebuildVectorIndex();
    }

    return initialLength - this.chunks.length;
  }

  /**
   * Rebuild the vector index from scratch (needed after deletions with FAISS)
   */
  private rebuildVectorIndex(): void {
    this.vectorIndex.clear();
    const embeddings = this.chunks.map(chunk => chunk.embedding);
    if (embeddings.length > 0) {
      this.vectorIndex.add(embeddings);
    }
  }

  /**
   * Save FAISS index to file
   */
  writeFAISS(path: string): void {
    if (this.config.vectorBackend !== 'faiss') {
      throw new Error('Can only save FAISS indexes. Current backend: ' + this.config.vectorBackend);
    }
    if (this.vectorIndex.write) {
      this.vectorIndex.write(path);
    }
  }

  /**
   * Load FAISS index from file
   */
  readFAISS(path: string): void {
    if (this.config.vectorBackend !== 'faiss') {
      throw new Error('Can only load FAISS indexes. Current backend: ' + this.config.vectorBackend);
    }
    if (this.vectorIndex.read) {
      this.vectorIndex.read(path);
    }
  }

  /**
   * Export index to JSON
   */
  toJSON(): object {
    return {
      chunks: this.chunks,
      config: {
        chunkingConfig: this.config.chunkingConfig,
        batchSize: this.config.batchSize,
        vectorBackend: this.config.vectorBackend,
        faissIndexType: this.config.faissIndexType,
        embeddingProvider: {
          name: this.config.embeddingProvider.name,
          model: this.config.embeddingProvider.model,
          dimensions: this.config.embeddingProvider.dimensions
        }
      }
    };
  }

  /**
   * Load index from JSON (requires providing embedding provider)
   */
  static fromJSON(
    data: {
      chunks: EmbeddedChunk[];
      config: {
        chunkingConfig: ChunkingConfig;
        batchSize?: number;
        vectorBackend?: VectorBackend;
        faissIndexType?: FAISSIndexType;
      };
    },
    embeddingProvider: EmbeddingProvider
  ): RAGIndex {
    const index = new RAGIndex({
      embeddingProvider,
      chunkingConfig: data.config.chunkingConfig,
      batchSize: data.config.batchSize,
      vectorBackend: data.config.vectorBackend,
      faissIndexType: data.config.faissIndexType
    });
    index.chunks = data.chunks;

    // Rebuild vector index from embeddings
    const embeddings = data.chunks.map(chunk => chunk.embedding);
    if (embeddings.length > 0) {
      index.vectorIndex.add(embeddings);
    }

    return index;
  }
}
