# fawn-core

A TypeScript library for knowledge extraction and semantic search over conversational text. Fawn processes messages to extract structured knowledge (entities, actions, topics) and enables natural language question-answering over that knowledge. Derivative of the original TypeAgent knowledge processor: https://github.com/microsoft/TypeAgent/tree/main/ts/packages/knowPro.

## Installation

```bash
npm install fawn-memory
```

## Quick Start

```typescript
import { createConversation, createMessage, createInMemoryStorageProvider } from 'fawn-core';
import 'dotenv/config';

const storageProvider = createInMemoryStorageProvider();
const messages = storageProvider.createMessageCollection();

const conversation = createConversation(messages, 'my-conversation', {
  storageProvider
});

// Add messages and extract knowledge
await conversation.addMessageAsync(
  createMessage('Alice told Bob that the project deadline is Friday.')
);

// Query the conversation
const answer = await conversation.query('What is the project deadline?');
console.log(answer);
```

## Configuration

Set your LLM provider credentials via environment variables:

```bash
# Provider selection (default: 'openai')
LLM_PROVIDER=openai   # or 'claude'

# API keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional: override default model
LLM_MODEL=gpt-4o
```

Default models:
- OpenAI: `gpt-4o`
- Claude: `claude-sonnet-4-20250514`

## Architecture

### Core Pipeline

1. **Knowledge Extraction** (`knowpro/knowledge.ts`): Uses TypeChat to extract entities, actions, and topics from text
2. **Semantic Indexing** (`knowpro/semanticRefIndex.ts`): Builds inverted indexes mapping terms to semantic references
3. **Search Query Translation** (`knowpro/searchQueryTranslator.ts`): Converts natural language to structured `SearchQuery` objects
4. **Context Compilation** (`knowpro/search.ts`): Scores and selects relevant refs based on query terms
5. **Answer Generation** (`knowpro/answerTranslator.ts`): Generates answers from compiled context

### Key Types

- **`Conversation`** — manages messages, semantic refs, and indexes; provides `query()` and `addMessageAsync()`
- **`SemanticRef`** — links extracted knowledge to source text ranges with `knowledgeType`, `knowledge`, and `range`
- **`KnowledgeResponse`** — contains `entities` (`ConcreteEntity[]`), `actions` (`Action[]`), and `topics`

### Modules

- `src/knowpro/` — core knowledge processing (extraction, indexing, search, conversation)
- `src/rag/` — RAG (Retrieval-Augmented Generation) with embedding-based vector search
- `src/agent/` — agent loop and tool registry utilities
- `src/utils/` — async helpers and string utilities

## API Reference

### Conversation

```typescript
const conversation = createConversation(messages, nameTag, options);

// Add a message and index its knowledge
await conversation.addMessageAsync(message);

// Query with natural language
const answer = await conversation.query('Who mentioned the deadline?');

// Expand index with lemmatization
conversation.lemmatize();

// Expand with LLM-generated related terms
await conversation.expandRelatedTerms({ relatedTermWeight: 0.9 });

// Expand with WordNet synonyms
await conversation.expandWithWordNet({ relatedTermWeight: 0.9 });
```

### Storage

```typescript
import { createInMemoryStorageProvider } from 'fawn-core';

const provider = createInMemoryStorageProvider();
const messages = provider.createMessageCollection();
const semanticRefs = provider.createSemanticRefCollection();
```

### LLM Provider

```typescript
import { createLLMProvider } from 'fawn-core';

const llm = createLLMProvider(); // reads from env vars
```

## Building

```bash
pnpm install
pnpm run build
```

## License

MIT
