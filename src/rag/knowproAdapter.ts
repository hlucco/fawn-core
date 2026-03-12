import type { TextChunk } from './types.js';
import type { RAGIndex } from './ragIndex.js';

/**
 * Adapter for integrating knowpro data structures with RAG index
 */
export class KnowproRAGAdapter {
  private readonly ragIndex: RAGIndex;
  private chunkCounter = 0;

  constructor(ragIndex: RAGIndex) {
    this.ragIndex = ragIndex;
  }

  /**
   * Add pre-chunked text strings to the index
   * This is the most common use case from knowpro code
   */
  async addTextChunks(
    textChunks: string[],
    metadata?: Record<string, unknown>,
    idPrefix?: string
  ): Promise<void> {
    const chunks = this.createChunks(textChunks, idPrefix);
    await this.ragIndex.addChunks(chunks, metadata);
  }

  /**
   * Add a single text string that may need chunking
   * Used when users send whole text that needs to be chunked
   */
  async addFullText(
    text: string,
    metadata?: Record<string, unknown>,
    idPrefix?: string
  ): Promise<void> {
    await this.ragIndex.addText(text, metadata, idPrefix);
  }

  /**
   * Add a knowpro message's text chunks to the index
   */
  async addMessageChunks(
    messageChunks: string[],
    messageOrdinal: number,
    additionalMetadata?: Record<string, unknown>
  ): Promise<void> {
    const metadata = {
      messageOrdinal,
      ...additionalMetadata
    };
    await this.addTextChunks(
      messageChunks,
      metadata,
      `msg-${messageOrdinal}`
    );
  }

  /**
   * Add multiple messages incrementally
   */
  async addMessages(
    messages: Array<{
      textChunks: string[];
      ordinal: number;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    for (const message of messages) {
      await this.addMessageChunks(
        message.textChunks,
        message.ordinal,
        message.metadata
      );
    }
  }

  /**
   * Convert text strings to TextChunk objects with proper IDs
   */
  private createChunks(
    textChunks: string[],
    idPrefix?: string
  ): TextChunk[] {
    const prefix = idPrefix || `chunk-${this.chunkCounter++}`;
    return textChunks.map((text, index) => ({
      id: `${prefix}-${index}`,
      text
    }));
  }

  /**
   * Get the underlying RAG index for advanced operations
   */
  getIndex(): RAGIndex {
    return this.ragIndex;
  }
}

/**
 * Factory function to create a KnowproRAGAdapter
 */
export function createKnowproRAGAdapter(ragIndex: RAGIndex): KnowproRAGAdapter {
  return new KnowproRAGAdapter(ragIndex);
}
