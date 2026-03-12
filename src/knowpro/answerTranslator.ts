import type { TypeChatJsonTranslator, TypeChatLanguageModel } from "typechat";
import { createJsonTranslator } from "typechat";
import type * as answerSchema from "./answerResponseSchema.js";
import { loadSchema } from "./schema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";

export type AnswerTranslator =
    TypeChatJsonTranslator<answerSchema.AnswerResponse>;

export function createAnswerTranslator(
    model: TypeChatLanguageModel,
): AnswerTranslator {
    const typeName = "AnswerResponse";
    const schema = loadSchema(["answerResponseSchema.ts"], import.meta.url);

    const translator = createJsonTranslator<answerSchema.AnswerResponse>(
        model,
        createTypeScriptJsonValidator<answerSchema.AnswerResponse>(
            schema,
            typeName,
        ),
    );
    return translator;
}
