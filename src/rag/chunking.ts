import type { TextChunk, ChunkingConfig } from './types.js';

/**
 * Split text into chunks based on configuration
 */
export function chunkText(
  text: string,
  config: ChunkingConfig,
  idPrefix: string = 'chunk'
): TextChunk[] {
  const { maxChunkSize, overlap = 0, splitOnSentences = true } = config;

  if (text.length === 0) {
    return [];
  }

  if (text.length <= maxChunkSize) {
    return [{
      id: `${idPrefix}-0`,
      text
    }];
  }

  const chunks: TextChunk[] = [];

  if (splitOnSentences) {
    // Split on sentence boundaries (., !, ?)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxChunkSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk) {
          chunks.push({
            id: `${idPrefix}-${chunkIndex++}`,
            text: currentChunk.trim()
          });
        }

        // If single sentence is too large, split it
        if (sentence.length > maxChunkSize) {
          const parts = splitLongText(sentence, maxChunkSize, overlap);
          for (const part of parts) {
            chunks.push({
              id: `${idPrefix}-${chunkIndex++}`,
              text: part.trim()
            });
          }
          currentChunk = '';
        } else {
          currentChunk = sentence;
        }
      }
    }

    if (currentChunk) {
      chunks.push({
        id: `${idPrefix}-${chunkIndex}`,
        text: currentChunk.trim()
      });
    }
  } else {
    // Simple character-based splitting with overlap
    const parts = splitLongText(text, maxChunkSize, overlap);
    for (let i = 0; i < parts.length; i++) {
      chunks.push({
        id: `${idPrefix}-${i}`,
        text: parts[i].trim()
      });
    }
  }

  return chunks.filter(chunk => chunk.text.length > 0);
}

/**
 * Split long text into fixed-size chunks with overlap
 */
function splitLongText(text: string, maxSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    chunks.push(text.substring(start, end));

    if (end === text.length) {
      break;
    }

    start = end - overlap;
  }

  return chunks;
}
