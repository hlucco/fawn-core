export {
  RAGIndex,
  type RAGIndexConfig,
  type VectorBackend,
  type FAISSIndexType
} from './ragIndex.js';

export {
  createVectorIndex,
  BruteForceIndex,
  FAISSIndex,
  HNSWIndex,
  type VectorIndex
} from './vectorIndex.js';

export {
  createEmbeddingProvider,
  createEmbeddingProviderFromEnv,
  createOpenAIEmbeddingProvider,
  createVoyageEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderType,
  type EmbeddingProviderConfig
} from './embeddingProvider.js';

export {
  chunkText
} from './chunking.js';

export {
  cosineSimilarity,
  normalizeVector,
  dotProduct
} from './similarity.js';

export type {
  Embedding,
  TextChunk,
  EmbeddedChunk,
  SimilaritySearchResult,
  ChunkingConfig
} from './types.js';

export {
  KnowproRAGAdapter,
  createKnowproRAGAdapter
} from './knowproAdapter.js';
