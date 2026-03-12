# RAG Index

Vector-based Retrieval-Augmented Generation (RAG) index for semantic search with support for multiple backends:
- **Brute-force** (default): Exact cosine similarity search, works everywhere
- **HNSW** (recommended): Fast approximate nearest neighbor search using pure TypeScript
- **FAISS** (optional): Fastest ANN search using Meta's FAISS library (requires native bindings)

## Features

- **Multiple Backends**: Choose between brute-force (exact) or FAISS (approximate) similarity search
- **Text Chunking**: Automatic chunking with configurable size and overlap
- **Vector Embeddings**: Support for OpenAI and Voyage AI embedding models
- **Cosine Similarity**: Fast similarity search over embedded chunks
- **Batch Processing**: Efficient batch embedding generation
- **Metadata Support**: Associate metadata with chunks
- **Filtering**: Filter search results by custom criteria
- **Persistence**: Save and load FAISS indexes to/from disk

## Quick Start

### For Pre-Chunked Text (Knowpro Integration)

```typescript
import {
  RAGIndex,
  KnowproRAGAdapter,
  createEmbeddingProviderFromEnv
} from './rag/index.js';

// Create embedding provider and RAG index
const embeddingProvider = createEmbeddingProviderFromEnv();
const ragIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: {
    maxChunkSize: 1000,
    overlap: 100,
    splitOnSentences: true
  }
});

// Create adapter for knowpro integration
const adapter = new KnowproRAGAdapter(ragIndex);

// Add pre-chunked text (most common use case from knowpro)
await adapter.addTextChunks(
  ['Chunk 1 text', 'Chunk 2 text', 'Chunk 3 text'],
  { source: 'conversation' }
);

// Add message chunks with ordinal tracking
await adapter.addMessageChunks(
  message.textChunks,
  messageOrdinal,
  { timestamp: message.timestamp }
);

// Query the index
const results = await adapter.getIndex().query('What is this about?', {
  topK: 5,
  minScore: 0.7
});
```

### For Full Text (Automatic Chunking)

```typescript
import {
  RAGIndex,
  createEmbeddingProviderFromEnv
} from './rag/index.js';

// Create embedding provider from environment variables
const embeddingProvider = createEmbeddingProviderFromEnv();

// Create RAG index
const index = new RAGIndex({
  embeddingProvider,
  chunkingConfig: {
    maxChunkSize: 1000,
    overlap: 100,
    splitOnSentences: true
  }
});

// Add text to index (will be automatically chunked)
await index.addText('Your document text here');

// Query the index
const results = await index.query('What is this about?', {
  topK: 5,
  minScore: 0.7
});

// Display results
for (const result of results) {
  console.log(`Score: ${result.score}`);
  console.log(`Text: ${result.chunk.text}`);
}
```

## Vector Backends

### Brute-force (Default)

The brute-force backend performs exact cosine similarity search across all vectors. It's simple, reliable, and works on all platforms without additional dependencies.

**Pros:**
- No additional dependencies
- Exact search results
- Works on all platforms
- Supports metadata filtering

**Cons:**
- Slower for large datasets (O(n) search complexity)
- Higher memory usage for large datasets

**Best for:** Small datasets (<1,000 chunks), exact search requirements, development/testing

### HNSW (Recommended)

HNSW (Hierarchical Navigable Small Worlds) provides fast approximate nearest neighbor search using a pure TypeScript implementation. **No native bindings required!**

**Pros:**
- ✅ **Works on all platforms** (Windows, Linux, macOS, browser)
- ✅ **Pure TypeScript** - no compilation needed
- ✅ Fast search (logarithmic complexity)
- ✅ Good accuracy vs speed tradeoff
- ✅ Simple installation

**Cons:**
- Approximate results (typically >95% accuracy)
- Slightly slower than FAISS for very large datasets

**Best for:** Medium to large datasets (1K-1M chunks), cross-platform compatibility

**Installation:**
```bash
pnpm add hnsw
```

### FAISS (Expert Use)

FAISS (Facebook AI Similarity Search) provides the fastest approximate nearest neighbor search using Meta's optimized library. **Requires native bindings.**

**Pros:**
- Fastest search available
- Lower memory footprint with quantization
- Battle-tested at scale (billions of vectors)

**Cons:**
- ❌ Requires native compilation (often fails on Windows)
- ❌ Complex installation
- Approximate results

**Best for:** Very large datasets (>1M chunks), Linux/macOS production deployments

**Installation:**
```bash
pnpm add faiss-node
```

**Note:** faiss-node requires C++ compilation tools. It works best on Linux and macOS. Windows support is limited.

### Backend Comparison

| Feature | Brute-force | HNSW | FAISS |
|---------|-------------|------|-------|
| **Platform Support** | All ✅ | All ✅ | Linux/macOS ⚠️ |
| **Installation** | Built-in | `pnpm add hnsw` | Requires native build |
| **Search Speed (10K vectors)** | ~50ms | ~1-2ms | ~0.5ms |
| **Memory Usage** | High | Medium | Low |
| **Accuracy** | 100% | ~95-99% | ~95-99% |
| **Best For** | <1K chunks | 1K-1M chunks | >1M chunks |

### Usage

```typescript
// Brute-force backend (default)
const bruteForceIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: { maxChunkSize: 1000 },
  vectorBackend: 'bruteforce' // or omit - it's the default
});

// HNSW backend (recommended for most use cases)
const hnswIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: { maxChunkSize: 1000 },
  vectorBackend: 'hnsw'
});

// FAISS backend (for expert users)
const faissIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: { maxChunkSize: 1000 },
  vectorBackend: 'faiss',
  faissIndexType: 'L2' // or 'IP' for inner product
});
```

## Environment Variables

### Embedding Provider Configuration

```bash
# Provider selection (default: 'openai')
EMBEDDING_PROVIDER=openai   # or 'voyage'

# API keys (set the one for your chosen provider)
OPENAI_API_KEY=sk-...       # For OpenAI
VOYAGE_API_KEY=pa-...       # For Voyage AI

# Optional: Override default model
EMBEDDING_MODEL=text-embedding-3-small
```

### Default Models

- **OpenAI**: `text-embedding-3-small` (1536 dimensions)
- **Voyage AI**: `voyage-3` (1024 dimensions)

## API Reference

### KnowproRAGAdapter

Adapter for integrating knowpro data structures with the RAG index. Use this when working with pre-chunked text from the knowpro conversation system.

```typescript
class KnowproRAGAdapter {
  constructor(ragIndex: RAGIndex)

  // Add pre-chunked text strings (most common use case)
  addTextChunks(
    textChunks: string[],
    metadata?: Record<string, unknown>,
    idPrefix?: string
  ): Promise<void>

  // Add full text that needs automatic chunking
  addFullText(
    text: string,
    metadata?: Record<string, unknown>,
    idPrefix?: string
  ): Promise<void>

  // Add knowpro message chunks with ordinal tracking
  addMessageChunks(
    messageChunks: string[],
    messageOrdinal: number,
    additionalMetadata?: Record<string, unknown>
  ): Promise<void>

  // Add multiple messages incrementally
  addMessages(
    messages: Array<{
      textChunks: string[];
      ordinal: number;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void>

  // Access the underlying RAG index
  getIndex(): RAGIndex
}
```

### RAGIndex

```typescript
class RAGIndex {
  constructor(config: RAGIndexConfig)

  // Properties
  get size(): number
  getChunks(): EmbeddedChunk[]

  // Adding content
  addText(text: string, metadata?: Record<string, unknown>, idPrefix?: string): Promise<void>
  addTexts(texts: string[], metadata?: Record<string, unknown>[], idPrefix?: string): Promise<void>
  addChunks(chunks: TextChunk[], metadata?: Record<string, unknown>): Promise<void>

  // Querying
  query(queryText: string, options?: QueryOptions): Promise<SimilaritySearchResult[]>
  queryMultiple(queryTexts: string[], options?: QueryOptions): Promise<SimilaritySearchResult[]>

  // Management
  clear(): void
  removeChunks(ids: string[]): number

  // Serialization
  toJSON(): object
  static fromJSON(data: any, embeddingProvider: EmbeddingProvider): RAGIndex
}
```

### Query Options

```typescript
interface QueryOptions {
  topK?: number;              // Number of results to return (default: 5)
  minScore?: number;          // Minimum similarity score (default: 0)
  filter?: (chunk: EmbeddedChunk) => boolean;  // Custom filter function
}
```

## Examples

### Incremental Addition of Chunks (Knowpro)

```typescript
import { RAGIndex, KnowproRAGAdapter, createEmbeddingProviderFromEnv } from './rag/index.js';

const embeddingProvider = createEmbeddingProviderFromEnv();
const ragIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: { maxChunkSize: 1000, overlap: 100 }
});

const adapter = new KnowproRAGAdapter(ragIndex);

// Add first message's chunks
await adapter.addMessageChunks(
  ['First chunk of message 1', 'Second chunk of message 1'],
  0,
  { timestamp: '2024-01-01T10:00:00Z' }
);

// Add second message's chunks incrementally
await adapter.addMessageChunks(
  ['First chunk of message 2', 'Second chunk of message 2'],
  1,
  { timestamp: '2024-01-01T10:05:00Z' }
);

// Or add multiple messages at once
await adapter.addMessages([
  {
    textChunks: ['Chunk 1', 'Chunk 2'],
    ordinal: 2,
    metadata: { timestamp: '2024-01-01T10:10:00Z' }
  },
  {
    textChunks: ['Chunk 1', 'Chunk 2', 'Chunk 3'],
    ordinal: 3,
    metadata: { timestamp: '2024-01-01T10:15:00Z' }
  }
]);

// Query across all added chunks
const results = await adapter.getIndex().query('search query', { topK: 5 });
```

### Basic Usage

```typescript
const index = new RAGIndex({
  embeddingProvider: createOpenAIEmbeddingProvider(apiKey),
  chunkingConfig: {
    maxChunkSize: 500,
    overlap: 50,
    splitOnSentences: true
  }
});

await index.addText('Long document text...');
const results = await index.query('search query');
```

### With Metadata and Filtering

```typescript
// Add with metadata
await index.addText('Document 1', { source: 'file1.txt', type: 'manual' });
await index.addText('Document 2', { source: 'file2.txt', type: 'api' });

// Query with filter
const results = await index.query('query', {
  topK: 10,
  minScore: 0.5,
  filter: (chunk) => chunk.metadata?.type === 'manual'
});
```

### Export and Load

```typescript
// Export index to JSON (works with both backends)
const data = index.toJSON();
await fs.writeFile('index.json', JSON.stringify(data));

// Load index from JSON
const loadedData = JSON.parse(await fs.readFile('index.json', 'utf-8'));
const index = RAGIndex.fromJSON(loadedData, embeddingProvider);

// FAISS-specific: Save/load binary index file
const faissIndex = new RAGIndex({
  embeddingProvider,
  chunkingConfig: { maxChunkSize: 1000 },
  vectorBackend: 'faiss'
});

// Save FAISS index to binary file (fast, compact)
faissIndex.writeFAISS('index.faiss');

// Note: FAISS files only store vectors, not metadata
// You still need to save chunks separately:
const data = faissIndex.toJSON();
await fs.writeFile('index-metadata.json', JSON.stringify(data));

// Load both files
const loaded = RAGIndex.fromJSON(
  JSON.parse(await fs.readFile('index-metadata.json', 'utf-8')),
  embeddingProvider
);
// Vectors are rebuilt from embeddings in the JSON
```

## Chunking Strategies

### Sentence-based Chunking (Recommended)

```typescript
chunkingConfig: {
  maxChunkSize: 1000,
  overlap: 100,
  splitOnSentences: true  // Preserves sentence boundaries
}
```

### Fixed-size Chunking

```typescript
chunkingConfig: {
  maxChunkSize: 500,
  overlap: 50,
  splitOnSentences: false  // Simple character-based splitting
}
```

## Performance Tips

1. **Choose the Right Backend**:
   - Use `bruteforce` for <1K chunks or when you need 100% exact results
   - Use `hnsw` (recommended) for 1K-1M chunks - works everywhere, good performance
   - Use `faiss` only for >1M chunks on Linux/macOS in production
   - Note: Filters automatically fall back to brute-force (ANN indexes don't support filtering)

2. **Batch Size**: Adjust `batchSize` in config for optimal embedding generation (default: 100)
3. **Chunk Size**: Balance between context (larger) and precision (smaller)
4. **Overlap**: Use overlap to prevent losing context at chunk boundaries
5. **Filtering**: Use metadata filtering to narrow search space (automatically uses brute-force)
6. **Score Threshold**: Set `minScore` to filter out low-quality matches
7. **FAISS Index Type**:
   - Use `L2` (default) for Euclidean distance
   - Use `IP` (inner product) if your embeddings are normalized

8. **Memory Management**: Clear old indexes with `index.clear()` when no longer needed

## Similarity Scores

Cosine similarity scores range from -1 to 1:
- **1.0**: Identical direction (perfect match)
- **0.5-0.9**: High similarity
- **0.0-0.5**: Some similarity
- **< 0.0**: Dissimilar (rare with embeddings)

Typical thresholds:
- `minScore: 0.8` - Very relevant results only
- `minScore: 0.7` - Good relevance
- `minScore: 0.5` - Moderate relevance
- `minScore: 0.0` - All results (default)
