/**
 * Vector embedding representation
 */
export type Embedding = number[];

/**
 * A text chunk with its associated metadata
 */
export interface TextChunk {
    /**
     * The text content of the chunk
     */
    text: string;
    /**
     * Unique identifier for the chunk
     */
    id: string;
    /**
     * Optional metadata associated with the chunk
     */
    metadata?: Record<string, unknown>;
}

/**
 * A chunk with its vector embedding
 */
export interface EmbeddedChunk extends TextChunk {
    /**
     * The vector embedding for this chunk
     */
    embedding: Embedding;
}

/**
 * Result of a similarity search
 */
export interface SimilaritySearchResult {
    /**
     * The matched chunk
     */
    chunk: EmbeddedChunk;
    /**
     * Similarity score (0-1, where 1 is most similar)
     */
    score: number;
}

/**
 * Configuration for text chunking
 */
export interface ChunkingConfig {
    /**
     * Maximum size of each chunk in characters
     */
    maxChunkSize: number;
    /**
     * Number of characters to overlap between chunks
     */
    overlap?: number;
    /**
     * Whether to split on sentence boundaries
     */
    splitOnSentences?: boolean;
}
