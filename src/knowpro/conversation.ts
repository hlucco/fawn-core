import type { DateRange, DeletionInfo, IConversation, IConversationSecondaryIndexes, IMessage, IMessageCollection, IMessageMetadata, IStorageProvider, MessageTag, SemanticRef } from "./interfaces.js";
import type { KnowledgeResponse } from "./knowledgeSchema.js";
import type { PromptSection } from 'typechat';
import { createInMemorySemanticRefIndex, type InMemorySemanticRefIndex, type LemmatizationResult, type RelatedTermsExpansionOptions, type RelatedTermsExpansionResult, type WordNetExpansionOptions } from "./semanticRefIndex.js";
import { createLLMProviderFromEnv, type LLMProvider } from './llmProvider.js';
import { debug } from "./debug.js";
import { createSearchQueryTranslator } from "./searchQueryTranslator.js";
import { createInMemoryStorageProvider } from "./storageProvider.js";
import { createAnswerTranslator } from "./answerTranslator.js";
import { compileContext, generateAnswer } from "./search.js";
import type { SearchQuery } from "./searchQuerySchema.js";
import { createKnowledgeExtractor } from "./knowledge.js";
import { populateSemanticRef } from "./semanticRef.js";
import { readFileSync } from "node:fs";
import { createTimestampIndexExtended } from "./timestampIndex.js";

export interface Message extends IMessage {
    setKnowledge: (knowledge: KnowledgeResponse) => void
};

export function createMessage(
    content: string,
    tags : MessageTag[],
    timestamp?: string | undefined,
    deletionInfo?: DeletionInfo | undefined,
    metadata?: IMessageMetadata | undefined,
): Message {

    // create semantic ref here? doesn't make sense since need it to be seperate
    // going back to thinking knowledge creation should happen outside of message and then
    // be passed in but then why the getKnowledge()
    let knowledge: KnowledgeResponse | undefined;

    function getKnowledge(): KnowledgeResponse | undefined {
        return knowledge;
    }

    function setKnowledge(knowledgeResponse: KnowledgeResponse) {
        knowledge = knowledgeResponse;
    }

    return {
        textChunks: [content],
        timestamp,
        tags,
        deletionInfo,
        metadata,
        getKnowledge,
        setKnowledge
    }
}

export interface Conversation extends IConversation {
    query: (question: string) => Promise<string>;
    queryTerms: (terms: string[]) => Promise<string>;
    getAllTopics: () => SemanticRef[];
    addMessageAsync: (message: Message, rebuild?: boolean) => Promise<boolean>;
    /**
     * Load conversation from a file. Only available when using InMemoryStorageProvider.
     */
    loadFromFile?: (filePath: string, rebuild?: boolean) => void;
    lemmatize: () => LemmatizationResult;
    expandRelatedTerms: (options?: RelatedTermsExpansionOptions) => Promise<RelatedTermsExpansionResult>;
    expandWithWordNet: (options?: WordNetExpansionOptions) => Promise<RelatedTermsExpansionResult>;
}

export interface ConversationOptions {
    /**
     * Optional custom LLM provider.
     * If not provided, falls back to createLLMProviderFromEnv().
     */
    llmProvider?: LLMProvider;

    /**
     * Optional custom storage provider.
     * If not provided, falls back to createInMemoryStorageProvider().
     */
    storageProvider?: IStorageProvider;
}

export function createConversation(
    messages: IMessageCollection<Message>,
    name: string,
    options?: ConversationOptions
): Conversation {

    const nameTag = name;
    const tags: string[] = [];

    const storageProvider = options?.storageProvider ?? createInMemoryStorageProvider();
    const llmProvider = options?.llmProvider ?? createLLMProviderFromEnv();
    const languageModel = llmProvider.getLanguageModel();

    const queryTranslator = createSearchQueryTranslator(languageModel);
    const answerTranslator = createAnswerTranslator(languageModel);
    const knowledgeExtractor = createKnowledgeExtractor(languageModel);
    const semanticRefs = storageProvider.createSemanticRefCollection();

    async function query(question: string): Promise<string> {
        const translatedQuery = await queryTranslator.translate(question);
        if (!translatedQuery.success) {
            debug(translatedQuery);
            return "Error: Failed to translate query.";
        }

        const searchQuery = translatedQuery.data;
        debug(searchQuery);

        const compiledContex = compileContext(
            searchQuery,
            semanticRefIndex,
            semanticRefs,
            messages,
            secondaryIndexes,
            question
        );

        const answerResponse = await generateAnswer(
            question, 
            compiledContex, 
            answerTranslator
        );


        if (!answerResponse.success) {
            debug(answerResponse);
            return "ERROR: Failed to generate an answer.";
        }

        const rawResponse = answerResponse.data;
        if (rawResponse.whyNoAnswer) {
            debug(answerResponse);
            return rawResponse.whyNoAnswer;
        }

        if (!rawResponse.answer) {
            debug(rawResponse);
            return "ERROR: Failed to generate an answer.";
        }

        return rawResponse.answer;
    }

    async function queryTerms(terms: string[]): Promise<string> {
        const searchQuery: SearchQuery = {
            searchExpressions: [
                {
                    rewrittenQuery: terms.join(" "),
                    filters: [
                        {
                            searchTerms: terms
                        }
                    ]
                }
            ]
        };

        const compiledContex = compileContext(
            searchQuery,
            semanticRefIndex,
            semanticRefs,
            messages,
            secondaryIndexes,
            terms.join(' ')
        );

        const answerResponse = await generateAnswer(
            terms.join(" "), 
            compiledContex, 
            answerTranslator
        );


        if (!answerResponse.success) {
            debug(answerResponse);
            return "ERROR: Failed to generate an answer.";
        }

        const rawResponse = answerResponse.data;
        if (rawResponse.whyNoAnswer) {
            debug(answerResponse);
            return rawResponse.whyNoAnswer;
        }

        if (!rawResponse.answer) {
            debug(rawResponse);
            return "ERROR: Failed to generate an answer.";
        }

        return rawResponse.answer;
    }

    debug("Building Index...");
    const semanticRefIndex = createInMemorySemanticRefIndex();
    semanticRefIndex.buildIndex(semanticRefs);
    const terms = semanticRefIndex.getTerms();
    debug("Index Complete, Terms: ", terms.length);

    // Create timestamp index (implements ITimestampToTextRangeIndex)
    const timestampIndex = createTimestampIndexExtended();

    function buildTimestampIndex() {
        // Populate timestamp index from messages
        for (let i = 0; i < messages.length; i++) {
            const message = messages.get(i);
            if (message?.timestamp) {
                timestampIndex.addTimestamp(i, message.timestamp);
            }
        }
        debug(`Timestamp index: ${timestampIndex.size()} entries`);
    }

    // Build timestamp index initially
    buildTimestampIndex();

    // Secondary indexes
    const secondaryIndexes: IConversationSecondaryIndexes = {
        timestampIndex
    };

    function getAllTopics() {
        return semanticRefs.getAll().filter((ref) => ref.knowledgeType === "topic");
    }

    // loadFromFile is only available if storage provider supports it
    const loadFromFile = 'loadFromFile' in storageProvider
        ? (filePath: string, rebuild = true): void => {
            (storageProvider as { loadFromFile: (path: string, refs: typeof semanticRefs, msgs: typeof messages) => void })
                .loadFromFile(filePath, semanticRefs, messages);
            if (rebuild) {
                debug("Rebuilding index...");
                semanticRefIndex.buildIndex(semanticRefs);
                buildTimestampIndex();
            }
        }
        : undefined;

    async function extractAndSaveRefsFromMessage(message: Message) {
        const knowledgeResponse = await knowledgeExtractor.extract(message.textChunks[0]);
        if (!knowledgeResponse) {
            return;
        }
        message.setKnowledge(knowledgeResponse)
        // Update the semanticRefs collection with the new knowledgeResponse
        populateSemanticRef(
            semanticRefs, 
            knowledgeResponse, 
            semanticRefs.length, 
            messages.length - 1 // we have already added the new message
        );
    }

    async function addMessageAsync(message: Message, rebuild = true): Promise<boolean> {
        messages.append(message);
        if (rebuild) {
            await extractAndSaveRefsFromMessage(message);
            semanticRefIndex.buildIndex(semanticRefs);
            buildTimestampIndex();
        }
        return true;
    }

    function lemmatize(): LemmatizationResult {
        return semanticRefIndex.lemmatizeIndex();
    }

    async function expandRelatedTerms(options?: RelatedTermsExpansionOptions): Promise<RelatedTermsExpansionResult> {
        return semanticRefIndex.expandWithRelatedTerms(languageModel, options);
    }

    async function expandWithWordNet(options?: WordNetExpansionOptions): Promise<RelatedTermsExpansionResult> {
        return semanticRefIndex.expandWithWordNet(options);
    }

    return {
        nameTag,
        tags,
        messages,
        semanticRefs,
        semanticRefIndex,
        secondaryIndexes,
        query,
        queryTerms,
        getAllTopics,
        addMessageAsync,
        loadFromFile,
        lemmatize,
        expandRelatedTerms,
        expandWithWordNet
    };
}

/**
 * Returns the time range for a conversation: the timestamps of the first and last messages
 * If messages have no timestamps (which are optional), returns undefined
 * @param conversation
 * @returns {DateRange}
 */
export function getTimeRangeForConversation(
    conversation: IConversation,
): DateRange | undefined {
    const messages = conversation.messages;
    if (messages.length > 0) {
        const start = messages.get(0).timestamp;
        const end = messages.get(messages.length - 1).timestamp;
        if (start !== undefined) {
            return {
                start: new Date(start),
                end: end ? new Date(end) : undefined,
            };
        }
    }
    return undefined;
}

export function getTimeRangePromptSectionForConversation(
    conversation: IConversation,
): PromptSection[] {
    const timeRange = getTimeRangeForConversation(conversation);
    if (timeRange) {
        return [
            {
                role: "system",
                content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.start} to ${timeRange.end}"`,
            },
        ];
    }
    return [];
}

/**
 * Exported index format (from @export command or benchmark export)
 */
export interface ExportedIndex {
    indexData: {
        items: Array<{
            term: string;
            semanticRefOrdinals: Array<{ semanticRefOrdinal: number; score: number }>;
        }>;
    };
    semanticRefs: SemanticRef[];
    messages: Array<{
        ordinal: number;
        content: string;
        timestamp?: string;
    }>;
    stats?: {
        termCount: number;
        refCount: number;
        messageCount: number;
    };
}

/**
 * Load a conversation from an exported index JSON file.
 * This allows querying a pre-built index without re-extracting knowledge.
 */
export function loadConversationFromExport(
    exportPath: string,
    name?: string,
    options?: ConversationOptions
): Conversation {
    const content = readFileSync(exportPath, 'utf-8');
    const exported: ExportedIndex = JSON.parse(content);
    return loadConversationFromExportData(exported, name || exportPath, options);
}

/**
 * Load a conversation from exported index data.
 */
export function loadConversationFromExportData(
    exported: ExportedIndex,
    name: string = "imported",
    options?: ConversationOptions
): Conversation {
    const storageProvider = options?.storageProvider ?? createInMemoryStorageProvider();
    const messages = storageProvider.createMessageCollection<Message>();
    const semanticRefs = storageProvider.createSemanticRefCollection();

    // Load messages
    for (const msg of exported.messages) {
        const message = createMessage(
            msg.content,
            [],
            msg.timestamp
        );
        messages.append(message);
    }

    // Load semantic refs
    for (const ref of exported.semanticRefs) {
        semanticRefs.append(ref);
    }

    // Create conversation
    const conversation = createConversation(messages, name, { ...options, storageProvider });

    // Load index from exported data (preserves related terms and weights)
    if (conversation.semanticRefIndex) {
        const index = conversation.semanticRefIndex as InMemorySemanticRefIndex;
        index.loadFromExport(exported.indexData.items);
    }

    // Copy refs to conversation's semanticRefs collection
    for (const ref of semanticRefs.getAll()) {
        conversation.semanticRefs?.append(ref);
    }

    debug(`Loaded: ${exported.messages.length} messages, ${exported.semanticRefs.length} refs, ${exported.indexData.items.length} terms`);

    return conversation;
}