import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createConversation, loadConversationFromExport, type Message, type Conversation } from './knowpro/conversation.js';
import { createInMemoryStorageProvider } from './knowpro/storageProvider.js';
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { printAction, printEntity, printTopic } from './knowpro/entities.js';
import type { Action, ConcreteEntity } from './knowpro/knowledgeSchema.js';
import type { Topic, ITermToSemanticRefIndexData } from './knowpro/interfaces.js';

// Public exports
export { createConversation, createMessage, loadConversationFromExport, loadConversationFromExportData } from './knowpro/conversation.js';
export type { Conversation, Message, ExportedIndex, ConversationOptions } from './knowpro/conversation.js';
export { createInMemoryStorageProvider } from './knowpro/storageProvider.js';
export type { InMemoryStorageProvider } from './knowpro/storageProvider.js';
export { createKnowledgeExtractor } from './knowpro/knowledge.js';
export type { KnowledgeExtractor } from './knowpro/interfaces.js';
export type { InMemorySemanticRefIndex, LemmatizationResult, RelatedTermsExpansionOptions, RelatedTermsExpansionResult, WordNetExpansionOptions } from './knowpro/semanticRefIndex.js';
export type {
  DeletionInfo,
  IMessage,
  IMessageMetadata,
  IConversation,
  MessageTag,
  SemanticRef,
  Topic,
  Knowledge,
  KnowledgeType,
  ITermToSemanticRefIndexData,
  ITermToSemanticRefIndexItem,
  ScoredSemanticRefOrdinal
} from './knowpro/interfaces.js';
export type { KnowledgeResponse, ConcreteEntity, Action } from './knowpro/knowledgeSchema.js';
export type { TimestampIndexExtended } from './knowpro/timestampIndex.js';
export { createTimestampIndex, createTimestampIndexExtended, parseTemporalExpression, hasTemporalReference } from './knowpro/timestampIndex.js';
export * from './knowpro/llmProvider.js';
export { setDebug, isDebugEnabled } from './knowpro/debug.js';

// Agent module
export * from './agent/index.js';

// Storage provider interfaces for custom implementations
export type {
    IStorageProvider,
    IMessageCollection,
    ISemanticRefCollection,
    ICollection,
    IReadonlyCollection,
    JsonSerializer,
} from './knowpro/interfaces.js';

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const inMemoryStorageProvider = createInMemoryStorageProvider();
  const messages = inMemoryStorageProvider.createMessageCollection<Message>();
  let conversation: Conversation = createConversation(
    messages,
    "test conversation",
    { storageProvider: inMemoryStorageProvider }
  );
  
  if (!conversation.semanticRefIndex) {
    console.log("No index found");
    process.exit();
  }
  // console.log(conversation.semanticRefIndex.getTerms());

  const readline = createInterface({
    input: process.stdin
  });

  let quit = false;
  console.log("starting repl...");
  while(!quit) {
    process.stdout.write("> ");
    const query = await readline.question("> ");

    if (query.includes("@entity")){
      const refs = conversation.semanticRefIndex?.lookupTerm(query.split(" ")[1]);
      if (refs) {
        refs.forEach((refOrdinal) => {
          const ref = conversation.semanticRefs?.get(refOrdinal.semanticRefOrdinal);
          if (ref && ref.knowledgeType === "entity") {
            printEntity(ref.knowledge as ConcreteEntity);
          }

        })
      }
      continue;
    }
    if (query.includes("@action")) {
      const refs = conversation.semanticRefIndex?.lookupTerm(query.split(" ")[1]);
      if (refs) {
        refs.forEach((refOrdinal) => {
          const ref = conversation.semanticRefs?.get(refOrdinal.semanticRefOrdinal);
          if (ref && ref.knowledgeType === "action") {
            printAction(ref.knowledge as Action);
          }
        });
      }
      continue;
    }

    if (query.includes("@term")) {
      const terms = query.split(" ").slice(1);
      console.log(await conversation.queryTerms(terms));
      continue;
    }

    if (query.includes("@topic")) {
      const refs = conversation.semanticRefIndex?.lookupTerm(query.split(" ")[1]);
      if (refs) {
        refs.forEach((refOrdinal) => {
          const ref = conversation.semanticRefs?.get(refOrdinal.semanticRefOrdinal);
          if (ref && ref.knowledgeType === "topic") {
            printTopic(ref.knowledge as Topic);
          }
        });
      }

      if (!refs) {
        const refs = conversation.getAllTopics();
        refs.forEach((ref) => {
          printTopic(ref.knowledge as Topic);
        })
      }
      continue;
    }

    if (query.startsWith("@load ")) {
      const filePath = query.slice("@load ".length).trim();
      if (!filePath) {
        console.log("ERROR: Provide a file path after @load.");
        continue;
      }
      if (!conversation.loadFromFile) {
        console.log("ERROR: loadFromFile not supported by current storage provider.");
        continue;
      }
      conversation.loadFromFile(filePath);

      console.log(`Loaded: ${filePath}`);
      continue;
    }

    if (query.startsWith("@loadindex ")) {
      const filePath = query.slice("@loadindex ".length).trim();
      if (!filePath) {
        console.log("ERROR: Provide a file path after @loadindex.");
        continue;
      }
      try {
        conversation = loadConversationFromExport(filePath);
        console.log(`Index loaded from: ${filePath}`);
      } catch (e) {
        console.log(`ERROR: Failed to load index: ${e}`);
      }
      continue;
    }

    if (query.startsWith("@export")) {
      const outputPath = query.slice("@export".length).trim() || "fawn-index-export.json";

      // Build index data
      const semanticRefs = conversation.semanticRefs?.getAll() || [];
      let indexData: ITermToSemanticRefIndexData = { items: [] };

      if (conversation.semanticRefIndex) {
        const terms = conversation.semanticRefIndex.getTerms();
        indexData = {
          items: terms.map(term => ({
            term,
            semanticRefOrdinals: conversation.semanticRefIndex!.lookupTerm(term) || []
          }))
        };
      }

      const messages = conversation.messages.getAll().map((msg, index) => ({
        ordinal: index,
        content: msg.textChunks.join(''),
        timestamp: msg.timestamp
      }));

      const exportData = {
        indexData,
        semanticRefs,
        messages,
        stats: {
          termCount: indexData.items.length,
          refCount: semanticRefs.length,
          messageCount: messages.length
        }
      };

      writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      console.log(`Exported to: ${outputPath}`);
      console.log(`  Terms: ${indexData.items.length}`);
      console.log(`  Semantic Refs: ${semanticRefs.length}`);
      console.log(`  Messages: ${messages.length}`);
      continue;
    }

    if (query === "@lemmatize") {
      const result = conversation.lemmatize();
      console.log(`Lemmatization complete:`);
      console.log(`  Terms processed: ${result.termsProcessed}`);
      console.log(`  Lemmas added: ${result.lemmasAdded}`);
      continue;
    }

    if (query.startsWith("@related")) {
      const parts = query.split(" ");
      const weight = parts[1] ? parseFloat(parts[1]) : 0.9;
      const maxTerms = parts[2] ? parseInt(parts[2]) : undefined;

      console.log(`Expanding related terms with LLM (weight: ${weight}${maxTerms ? `, maxTerms: ${maxTerms}` : ''})...`);
      const result = await conversation.expandRelatedTerms({
        relatedTermWeight: weight,
        maxTerms
      });
      console.log(`Related terms expansion complete:`);
      console.log(`  Terms processed: ${result.termsProcessed}`);
      console.log(`  Related terms added: ${result.relatedTermsAdded}`);
      continue;
    }

    if (query.startsWith("@wordnet")) {
      const parts = query.split(" ");
      const weight = parts[1] ? parseFloat(parts[1]) : 0.9;
      const maxTerms = parts[2] ? parseInt(parts[2]) : undefined;

      console.log(`Expanding related terms with WordNet (weight: ${weight}${maxTerms ? `, maxTerms: ${maxTerms}` : ''})...`);
      const result = await conversation.expandWithWordNet({
        relatedTermWeight: weight,
        maxTerms
      });
      console.log(`WordNet expansion complete:`);
      console.log(`  Terms processed: ${result.termsProcessed}`);
      console.log(`  Related terms added: ${result.relatedTermsAdded}`);
      continue;
    }

    if (query === 'quit' || query === 'exit') {
      quit = true;
      break;
    }
    console.log(await conversation.query(query));
  }
  readline.close();
}
