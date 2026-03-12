import type { Result, TypeChatJsonTranslator, TypeChatLanguageModel } from "typechat";
import { createJsonTranslator } from "typechat";
import type { KnowledgeExtractor, KnowledgeExtractorSettings } from "./interfaces.js";
import type { KnowledgeResponse } from "./knowledgeSchema.js";
import { loadSchema } from "./schema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { mergeEntityFacet } from "./entities.js";
import { getResultWithRetry } from "../utils/async.js";


export function createKnowledgeTranslator(
    model: TypeChatLanguageModel,
): TypeChatJsonTranslator<KnowledgeResponse> {
    const schema = loadSchema(["knowledgeSchema.ts"], import.meta.url);
    const typeName = "KnowledgeResponse";
    const validator = createTypeScriptJsonValidator<KnowledgeResponse>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<KnowledgeResponse>(
        model,
        validator,
    );
    translator.createRequestPrompt = createRequestPrompt;
    return translator;

    function createRequestPrompt(request: string) {
        return (
            `You are a service that translates user messages in a conversation into JSON objects of type "${typeName}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following are messages in a conversation:\n` +
            `"""\n${request}\n"""\n` +
            `The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

/**
 * Return default settings
 * @param maxCharsPerChunk (optional)
 * @returns
 */
export function createKnowledgeExtractorSettings(
    maxCharsPerChunk: number = 2048,
): KnowledgeExtractorSettings {
    return {
        maxContextLength: maxCharsPerChunk,
        mergeActionKnowledge: true,
    };
}

/**
 * Create a new knowledge extractor
 * @param model
 * @param extractorSettings
 * @param knowledgeTranslator (optional) knowledge translator to use
 * @returns
 */
export function createKnowledgeExtractor(
    model: TypeChatLanguageModel,
    extractorSettings?: KnowledgeExtractorSettings | undefined,
    knowledgeTranslator?: TypeChatJsonTranslator<KnowledgeResponse> | undefined,
): KnowledgeExtractor {
    const settings = extractorSettings ?? createKnowledgeExtractorSettings();
    const translator = knowledgeTranslator ?? createKnowledgeTranslator(model);
    const extractor: KnowledgeExtractor = {
        settings,
        extract,
        extractWithRetry,
        translator,
    };
    return extractor;

    async function extract(
        message: string,
    ): Promise<KnowledgeResponse | undefined> {
        const result = await extractKnowledge(message);
        if (!result.success) {
            return undefined;
        }
        return result.data;
    }

    function extractWithRetry(
        message: string,
        maxRetries: number,
    ): Promise<Result<KnowledgeResponse>> {
        return getResultWithRetry(
            () => extractKnowledge(message),
            maxRetries,
        );
    }

    async function extractKnowledge(
        message: string,
    ): Promise<Result<KnowledgeResponse>> {
        const result = await (extractor.translator ?? translator).translate(
            message,
        );
        if (result.success) {
            if (settings.mergeActionKnowledge || settings.mergeEntityFacets) {
                mergeActionKnowledge(result.data);
            }
        }
        return result;
    }

    //
    // Some knowledge found via actions is actually meant for entities...
    //
    function mergeActionKnowledge(knowledge: KnowledgeResponse) {
        if (knowledge.actions === undefined) {
            knowledge.actions = [];
        }
        if (settings.mergeActionKnowledge) {
            // Merge all inverse actions into regular actions.
            if (
                knowledge.inverseActions &&
                knowledge.inverseActions.length > 0
            ) {
                knowledge.actions.push(...knowledge.inverseActions);
                knowledge.inverseActions = [];
            }
        }
        if (settings.mergeActionKnowledge || settings.mergeEntityFacets) {
            // Also merge in any facets into
            for (const action of knowledge.actions) {
                if (action.subjectEntityFacet) {
                    const entity = knowledge.entities.find(
                        (c) => c.name === action.subjectEntityName,
                    );
                    if (entity) {
                        mergeEntityFacet(entity, action.subjectEntityFacet);
                    }
                    action.subjectEntityFacet = undefined;
                }
            }
        }
    }
}