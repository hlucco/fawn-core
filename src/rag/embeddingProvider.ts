import type { Embedding } from './types.js';

export type EmbeddingProviderType = 'openai' | 'voyage';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  apiKey: string;
  model?: string;
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderType;
  readonly model: string;
  readonly dimensions: number;

  /**
   * Generate embeddings for a batch of texts
   */
  generateEmbeddings(texts: string[]): Promise<Embedding[]>;
}

/**
 * OpenAI embedding provider
 */
export function createOpenAIEmbeddingProvider(
  apiKey: string,
  model: string = 'text-embedding-3-small'
): EmbeddingProvider {
  const dimensions = model === 'text-embedding-3-small' ? 1536 :
                     model === 'text-embedding-3-large' ? 3072 : 1536;

  return {
    name: 'openai',
    model,
    dimensions,
    async generateEmbeddings(texts: string[]): Promise<Embedding[]> {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          input: texts,
          model
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding API error: ${error}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map((item) => item.embedding);
    }
  };
}

/**
 * Voyage AI embedding provider (recommended by Anthropic)
 */
export function createVoyageEmbeddingProvider(
  apiKey: string,
  model: string = 'voyage-3'
): EmbeddingProvider {
  const dimensions = model === 'voyage-3' ? 1024 :
                     model === 'voyage-3-lite' ? 512 : 1024;

  return {
    name: 'voyage',
    model,
    dimensions,
    async generateEmbeddings(texts: string[]): Promise<Embedding[]> {
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          input: texts,
          model
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Voyage AI embedding API error: ${error}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map((item) => item.embedding);
    }
  };
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return createOpenAIEmbeddingProvider(config.apiKey, config.model);
    case 'voyage':
      return createVoyageEmbeddingProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

/**
 * Create embedding provider from environment variables
 * Uses EMBEDDING_PROVIDER env var (defaults to 'openai')
 * API keys:
 * - OpenAI: OPENAI_API_KEY
 * - Voyage: VOYAGE_API_KEY
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const provider = (process.env.EMBEDDING_PROVIDER || 'openai') as EmbeddingProviderType;

  let apiKey: string | undefined;
  if (provider === 'voyage') {
    apiKey = process.env.VOYAGE_API_KEY;
  } else {
    apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_SDK_KEY;
  }

  const model = process.env.EMBEDDING_MODEL;

  if (!apiKey) {
    throw new Error(`Missing API key for embedding provider: ${provider}`);
  }

  return createEmbeddingProvider({ provider, apiKey, model });
}
