// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    PromptSection,
    Result,
    TypeChatLanguageModel,
    TypeChatJsonTranslator} from "typechat";
import {
    createJsonTranslator
} from "typechat";
import type * as querySchema from "./searchQuerySchema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import type { IConversation } from "./interfaces.js";
import { loadSchema } from "./schema.js";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";

/**
 * A TypeChat Translator that turns natural language into structured queries
 * of type: {@link SearchQuery}
 */
export interface SearchQueryTranslator {
    translate(
        request: string,
        promptPreamble?: string | PromptSection[],
    ): Promise<Result<querySchema.SearchQuery>>;
}

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @returns {SearchQueryTranslator}
 */
export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const translator = createSearchQueryJsonTranslator<querySchema.SearchQuery>(
        model,
        "searchQuerySchema.ts",
    );
    return {
        translate(request, promptPreamble) {
            return translator.translate(request, promptPreamble);
        },
    };
}

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @param schemaFilePath Relative path to schema file
 * @returns {SearchQueryTranslator}
 */
export function createSearchQueryJsonTranslator<
    T extends querySchema.SearchQuery
>(
    model: TypeChatLanguageModel,
    schemaFilePath: string,
): TypeChatJsonTranslator<T> {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", schemaFilePath],
        import.meta.url,
    );
    return createJsonTranslator<T>(
        model,
        createTypeScriptJsonValidator<T>(searchActionSchema, typeName),
    );
}

/**
 * Translate natural language query into a SearchQuery expression
 * @param conversation
 * @param queryTranslator
 * @param text
 * @param promptPreamble
 * @returns
 */
export async function searchQueryFromLanguage(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    text: string,
    promptPreamble?: PromptSection[],
): Promise<Result<querySchema.SearchQuery>> {
    const timeRange = getTimeRangePromptSectionForConversation(conversation);
    const queryContext: PromptSection[] =
        promptPreamble && promptPreamble.length > 0
            ? [...promptPreamble, ...timeRange]
            : timeRange;
    const result = await queryTranslator.translate(text, queryContext);
    return result;
}