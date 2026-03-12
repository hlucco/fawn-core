import { writeFileSync } from "node:fs";
import type * as contextSchema from "./answerContextSchema.js";
import type { AnswerTranslator } from "./answerTranslator.js";
import type { Message } from "./conversation.js";
import { debug, isDebugEnabled } from "./debug.js";
import { printRef } from "./entities.js";
import type { IConversationSecondaryIndexes, IMessageCollection, ISemanticRefCollection, ITermToSemanticRefIndex, SemanticRef, Topic } from "./interfaces.js";
import type { Action, ConcreteEntity, Facet } from "./knowledgeSchema.js";
import { loadSchema } from "./schema.js";
import type { SearchQuery } from "./searchQuerySchema.js";
import { type TimestampIndexExtended, hasTemporalReference, parseTemporalExpression } from "./timestampIndex.js";

function processTerm(term: string): string {
    return term.toLowerCase();
}

function createQuestionPrompt(question: string): string {
    const prompt: string[] = [
        "The following is a user question:",
        "===",
        question,
        "",
        "===",
        "- The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
        "- Answer the user question PRECISELY using ONLY information EXPLICITLY provided in the topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT]",
        "- Return 'NoAnswer' if you are unsure, , if the answer is not explicitly in [ANSWER CONTEXT], or if the topics or {entity names, types and facets} in the question are not found in [ANSWER CONTEXT].",
        "- Use the 'name', 'type' and 'facets' properties of the provided JSON entities to identify those highly relevant to answering the question.",
        "- 'origin' and 'audience' fields contain the names of entities involved in communication about the knowledge",
        "**Important:** Communicating DOES NOT imply associations such as authorship, ownership etc. E.g. origin: [X] telling audience [Y, Z] communicating about a book does not imply authorship.",
        "- When asked for lists, ensure the list contents answer the question and nothing else. E.g. for the question 'List all books': List only the books in [ANSWER CONTEXT].",
        "- Use direct quotes only when needed or asked. Otherwise answer in your own words.",
        "- Your answer is readable and complete, with appropriate formatting: line breaks, numbered lists, bullet points etc.",
    ];
    return prompt.join("\n");
}

function createContextPrompt(
    typeName: string,
    schema: string,
    context: string,
): string {
    let content =
        schema && schema.length > 0
            ? `[ANSWER CONTEXT] for answering user questions is a JSON object of type ${typeName} according to the following TypeScript definitions:\n` +
              `\`\`\`\n${schema}\`\`\`\n`
            : "";
    content += `[ANSWER CONTEXT]\n` + `===\n${context}\n===\n`;
    return content;
}

export function generateAnswer(
    rawQuery: string, 
    compiledQuery: contextSchema.AnswerContext,
    answerTranslator: AnswerTranslator
) {
    const prompt: string[] = [];
    const questionPrompt = createQuestionPrompt(rawQuery);
    const contextSchema = loadSchema(["answerContextSchema.ts"], import.meta.url);
    const contextContent = JSON.stringify(compiledQuery);

    prompt.push(questionPrompt);
    prompt.push(
        createContextPrompt(
            "AnswerContext", // TODO figure out if this is the intended use for this param
            contextSchema,
            contextContent,
        ),
    );
    const promptText = prompt.join("\n\n");
    debug("ANSWER PROMPT");
    debug(promptText, promptText.length);
    if (isDebugEnabled()) {
        writeFileSync("answerPrompt.txt", promptText);
    }
    return answerTranslator.translate(
        promptText
    );
}

function scoreFacet(
    masterTerms: string[], 
    facet: Facet
) {
    let facetScore = 0;

    if (!facet.name) {
        return facetScore;
    }

    if (masterTerms.includes(facet.name.toLowerCase())) { facetScore += 1 };
    if (masterTerms.includes(facet.value.toString().toLowerCase())) { facetScore += 1 };
    return facetScore;
}

function scoreEntity(
    masterTerms: string[],
    scoreMap: Map<SemanticRef, number>,
    ref: SemanticRef,
) {
    const entity = ref.knowledge as ConcreteEntity;
    let entityScore = 0;

    if (masterTerms.includes(entity.name.toLowerCase())) { entityScore += 1 };

    entity.type.forEach((type) => {
        if (masterTerms.includes(type.toLowerCase())) { entityScore += 1 };
    })

    if (entity.facets) {
        entity.facets.forEach((facet) => {
            entityScore += scoreFacet(masterTerms, facet);
        })
    }

    scoreMap.set(ref, entityScore);
}

function scoreTopic(
    masterTerms: string[],
    scoreMap: Map<SemanticRef, number>,
    ref: SemanticRef,
) {
    const topic = ref.knowledge as Topic;
    const tokens = topic.text.split(" ");
    let topicScore = 0;
    tokens.forEach((token) => {
        if (masterTerms.includes(token.toLowerCase())) { topicScore += 1 };
    })
    scoreMap.set(ref, topicScore);
}

function scoreAction(
    masterTerms: string[],
    scoreMap: Map<SemanticRef, number>,
    ref: SemanticRef,
) {
    const action = ref.knowledge as Action;
    let actionScore = 0;

    if (action.indirectObjectEntityName && masterTerms.includes(action.indirectObjectEntityName.toLowerCase())) { actionScore += 1 };
    if (action.objectEntityName && masterTerms.includes(action.objectEntityName.toLowerCase())) { actionScore += 1 };
    if (action.subjectEntityName && masterTerms.includes(action.subjectEntityName.toLowerCase())) { actionScore += 1 };
    if (action.verbTense && masterTerms.includes(action.verbTense.toLowerCase())) { actionScore += 1 };

    if (action.subjectEntityFacet) {
        actionScore += scoreFacet(
            masterTerms,
            action.subjectEntityFacet
        )
    }

    action.verbs.forEach((verb) => {
        if (masterTerms.includes(verb.toLowerCase())) { actionScore += 1 };
    })

    scoreMap.set(ref, actionScore);
}

function scoreRef(
    masterTerms: string[],
    scoreMap: Map<SemanticRef, number>,
    ref: SemanticRef
) {
    switch(ref.knowledgeType) {
        case "entity" : {
            scoreEntity(
                masterTerms,
                scoreMap,
                ref
            );
            break;
        }
        case "topic" : {
            scoreTopic(
                masterTerms,
                scoreMap,
                ref
            );
            break;
        }
        case "action" : {
            scoreAction(
                masterTerms,
                scoreMap,
                ref
            );
            break;
        }
        default: {
            break;
        }
    }
}

export function compileContext(
    query: SearchQuery,
    semanticRefIndex: ITermToSemanticRefIndex,
    semanticRefs: ISemanticRefCollection,
    messages: IMessageCollection<Message>,
    secondaryIndexes?: IConversationSecondaryIndexes,
    originalQuery?: string
): contextSchema.AnswerContext {
    // Get timestamp index from secondary indexes if available
    const timestampIndex = secondaryIndexes?.timestampIndex as TimestampIndexExtended | undefined;
    const termList = new Set<string>();

    // Check if query has temporal reference for ranking
    const hasTimeReference = originalQuery ? hasTemporalReference(originalQuery) : false;

    // Extract time range from query if present
    let queryTimeRange: { start: Date; end: Date } | undefined;
    if (hasTimeReference && originalQuery) {
        // Try to parse temporal expression from the query
        const temporalTerms = ['today', 'yesterday', 'last week', 'last month', 'this week', 'this month'];
        for (const term of temporalTerms) {
            if (originalQuery.toLowerCase().includes(term)) {
                queryTimeRange = parseTemporalExpression(term);
                break;
            }
        }
    }

    // Also check if the structured query has a time range
    let structuredTimeRange: { start: Date; end: Date } | undefined;
    query.searchExpressions.forEach((expression) => {
        expression.filters.forEach((filter) => {
            if (filter.scopeSubQuery?.timeRange) {
                const tr = filter.scopeSubQuery.timeRange;
                structuredTimeRange = {
                    start: new Date(tr.startDate.date.year, tr.startDate.date.month - 1, tr.startDate.date.day),
                    end: tr.stopDate
                        ? new Date(tr.stopDate.date.year, tr.stopDate.date.month - 1, tr.stopDate.date.day, 23, 59, 59)
                        : new Date(tr.startDate.date.year, tr.startDate.date.month - 1, tr.startDate.date.day, 23, 59, 59)
                };
            }
        });
    });

    // Use structured time range if available, otherwise use parsed temporal expression
    const effectiveTimeRange = structuredTimeRange || queryTimeRange;

    // TODO: this code can definitely be cleaned up
    query.searchExpressions.forEach((expression) => {
        expression.filters.forEach((filter) => {
            // Entities
            debug(filter);
            debug("ENTITY SEARCH TERM ", filter.entitySearchTerms);
            if (filter.entitySearchTerms) {
                filter.entitySearchTerms.forEach((entity) => {
                    termList.add(processTerm(entity.name));

                    if (entity.facets) {
                        entity.facets.forEach((facet) => {
                            termList.add(processTerm(facet.facetName));
                            termList.add(processTerm(facet.facetValue));
                        });
                    }

                    if (entity.type) {
                        entity.type.forEach((token) => {
                            termList.add(processTerm(token));
                        })
                    }
                })
            }

            // Actions
            debug("ACTION SEARCH TRERM", filter.actionSearchTerm);
            if (filter.actionSearchTerm) {
                if (filter.actionSearchTerm.actionVerbs) {
                    filter.actionSearchTerm.actionVerbs.words.forEach((word) => {
                        termList.add(processTerm(word));
                    });
                }

                debug("ACTOR ENTITIES", filter.actionSearchTerm.actorEntities);
                if (filter.actionSearchTerm.actorEntities !== "*") {
                    filter.actionSearchTerm.actorEntities.forEach((entity) => {
                        termList.add(processTerm(entity.name));
                        
                        if (entity.facets) {
                            entity.facets.forEach((facet) => {
                                termList.add(processTerm(facet.facetName));
                                termList.add(processTerm(facet.facetValue));
                            });
                        }

                        if (entity.type) {
                            entity.type.forEach((token) => {
                                termList.add(processTerm(token));
                            })
                        }
                    })
                }
            }

            debug("SCOPE QUERY ", filter.scopeSubQuery);
            // Query Scope
            if (filter.scopeSubQuery) {
                // TBD later as we refine search
            }

            // Additional Search Terms
            debug("SEARCH TERMS ", filter.searchTerms);
            if (filter.searchTerms) {
                filter.searchTerms.forEach((term) => {
                    termList.add(processTerm(term));
                })
            }
        })
    });
    debug("QUERY EXPRESSION");
    debug(termList);

    // 1. get all the terms then lookup all the refs for each term
    // 2. merge refs and order ref groups by highest ranked term (by ref count)
    // 3. TODO create a ranking heuristic for the merged refs LETS GET SEARCH WORKING BEFORE PLAYING WITH THIS
    // 4. stick into answer translator, in addition create a heuristic for ranking chunks
    //    add these chunks in the remaining context window (but not in JSON as this uses
    //    too many tokens)

    const refCountMap = new Map<string, number>();
    const refsAccumMap = new Map<string, SemanticRef[]>();
    // Track the weight/score for each ref from the index lookup
    const refWeightMap = new Map<number, number>(); // semanticRefOrdinal -> max weight

    termList.forEach((term) => {
        const termOrdinals = semanticRefIndex.lookupTerm(term);
        if (termOrdinals) {
            const refs = semanticRefs.getMultiple(
                termOrdinals.map((ordinal) => ordinal.semanticRefOrdinal)
            );
            refCountMap.set(term, refs.length);
            refsAccumMap.set(term, refs);

            // Track the weight for each ref (use max if seen multiple times)
            for (const ordinal of termOrdinals) {
                const currentWeight = refWeightMap.get(ordinal.semanticRefOrdinal) ?? 0;
                refWeightMap.set(ordinal.semanticRefOrdinal, Math.max(currentWeight, ordinal.score));
            }
        }
    });

    // let finalRefs: SemanticRef[] = [];
    // const sortedCountTermPairs = [...refCountMap.entries()].sort((a, b) => b[1] - a[1]);
    // sortedCountTermPairs.forEach((pair) => {
    //     finalRefs = finalRefs.concat(refsAccumMap.get(pair[0]) || []);
    // });

    // Note:
    // Merging of duplicate entities needs to happen at some point in this process but
    // unsure if it should happen at the beginning or after
    // the ranking has been completed.
    //
    // to start we are going to merge after we pull all the refs for the search
    // terms

    // OR MAX WITH TOKEN LIMIT:
    // 1. get all the refs for all of the search terms, merge duplicate entities
    //    and actions
    // 2. find the refs that match all the terms, then some, then one
    //    rank the refs in that order
    // 3. take the token limit and divide it by two, put the top n ranked
    //    refs into the answer context up to token limit/2 tokens
    // 4. for the refs in the answer context, fetch the chunk they were pulled
    //    from
    // 5. merge duplicate chunks
    // 6. fill the remaning limit/2 tokens with as many chunks as possible to fit
    //    in the token limit

    // console.log(finalRefs);

    // if an entity doesn't have facets is it even worth
    // considering? yes because of its text chunk reference

    // Ref Ranking
    // 1. For each ref, do a dfs traversal over the ref's values
    //    looking for other terms
    // 2. score the ref based on how many of the found terms in the
    //    refs leaves are found in the query expression
    // 3. assign the score to this ref and sort it in with the other
    //    refs
    // 4. Factor in the index weight (from related term expansion) -
    //    related terms have lower weight than original terms
    const refScoreMap = new Map<SemanticRef, number>();
    refsAccumMap.forEach((semanticRefs, term) => {
        semanticRefs.forEach((ref) => {
            scoreRef([...termList], refScoreMap, ref);

            // Apply index weight to the score (related terms have weight < 1.0)
            const indexWeight = refWeightMap.get(ref.semanticRefOrdinal) ?? 1.0;
            const currentScore = refScoreMap.get(ref) ?? 0;
            refScoreMap.set(ref, currentScore * indexWeight);
        });
        debug("TERM:", term, "COUNT:", semanticRefs.length);
    });

    // Apply temporal filtering and ranking
    if (timestampIndex && effectiveTimeRange) {
        // Get messages in the time range
        const messagesInRange = timestampIndex.lookupRange({ start: effectiveTimeRange.start, end: effectiveTimeRange.end });
        const messageOrdinalsInRange = new Set(messagesInRange.map(m => m.range.start.messageOrdinal));
        debug(`Temporal filter: ${messageOrdinalsInRange.size} messages in range ${effectiveTimeRange.start.toISOString()} to ${effectiveTimeRange.end.toISOString()}`);

        // Filter or boost based on time range (check ref's source message)
        for (const [ref, score] of refScoreMap) {
            const messageOrdinal = ref.range.start.messageOrdinal;
            if (messageOrdinalsInRange.has(messageOrdinal)) {
                // Boost refs that match time range
                refScoreMap.set(ref, score * 1.5);
            } else if (hasTimeReference) {
                // If query explicitly mentions time, penalize refs outside range
                refScoreMap.set(ref, score * 0.3);
            }
        }
    } else if (hasTimeReference && timestampIndex) {
        // Query mentions time but no specific range parsed - add timestamp to context
        // Boost refs that have timestamps so they can be used in the answer
        for (const [ref, score] of refScoreMap) {
            const messageOrdinal = ref.range.start.messageOrdinal;
            const timestamp = timestampIndex.getMessageTimestamp(messageOrdinal);
            if (timestamp) {
                // Slightly boost refs with timestamps for "when" queries
                refScoreMap.set(ref, score * 1.1);
            }
        }
    }

    const entities: contextSchema.RelevantKnowledge[] = [];
    const topics: contextSchema.RelevantKnowledge[] = [];
    let contextLength = computeContextLength(entities, topics);

    const CHAR_LIMIT = 30_000;
    const REF_LIMIT = CHAR_LIMIT / 2;
    const MESSAGE_LIMIT = CHAR_LIMIT / 2;

    // print our score map
    const sortedRefs = [...refScoreMap.entries()].sort((a,b) => b[1] - a[1]);
    const selectedRefs = [];
    for (const entry of sortedRefs) {
        printRef(entry[0]);
        debug(`${entry[0].knowledgeType}, ${entry[1]}`);

        // Get timestamp for this ref if available (via its source message)
        let refTimestamp: Date | undefined;
        if (timestampIndex) {
            const messageOrdinal = entry[0].range.start.messageOrdinal;
            refTimestamp = timestampIndex.getMessageTimestamp(messageOrdinal);
        }

        const newKnowledge: contextSchema.RelevantKnowledge = {
            knowledge: entry[0].knowledge,
            // Include time range if we have a timestamp
            timeRange: refTimestamp ? { start: refTimestamp, end: refTimestamp } : undefined
        }

        if (entry[0].knowledgeType === "topic") {
            topics.push(newKnowledge);
        } else {
            entities.push(newKnowledge);
        }
        selectedRefs.push(entry[0]);

        contextLength = computeContextLength(entities, topics);
        if (contextLength >= REF_LIMIT) {
            debug("Ref token limit has been reached");
            break;
        }
    }

    // Message Scoring
    // 1. take the top refs that have filled up the context
    // 2. rank the messages in those ref's ranges in terms of
    //    hit count
    // 3. put the messages with the highest hit count up to
    //    MESSAGE_LIMIT into the message side of the context
    const referencedMergedMessages = new Map<number, number>();
    selectedRefs.forEach((ref) => {
        const chunkOrdinal = ref.range.start.messageOrdinal;
        if (!referencedMergedMessages.has(chunkOrdinal)) {
            referencedMergedMessages.set(chunkOrdinal, 1);
            return;
        }
        const previousValue = referencedMergedMessages.get(chunkOrdinal)!;
        referencedMergedMessages.set(chunkOrdinal, previousValue + 1);
    });

    let messageLength = 0;
    const selectedMessages: contextSchema.RelevantMessage[] = [];
    const seenOrdinals: number[] = [];
    selectedRefs.forEach((ref) => {
        const chunkOrdinal = ref.range.start.messageOrdinal;
        if (seenOrdinals.includes(chunkOrdinal)) {
            // message is already in so we skip
            return;
        }
        seenOrdinals.push(chunkOrdinal);

        const message = messages.get(chunkOrdinal);
        if (messageLength <= MESSAGE_LIMIT) {
            selectedMessages.push({
                messageText: message.textChunks,
                timestamp: message.timestamp ? new Date(message.timestamp) : undefined
            });
            printRef(ref);
            debug(message.textChunks);
        }
        messageLength = computeMessageLength(selectedMessages);
    })
    // const sortedEntries = Array.from(referencedMergedMessages.entries()).sort((a, b) => b[1] - a[1]);
    // sortedEntries.forEach(([ordinal, score]) => {
    //     const message = messages.get(ordinal);
    //     // todo this should be converted to a loop we can break out of
    //     // inefecient code
    //     if (messageLength <= MESSAGE_LIMIT) {
    //         selectedMessages.push({
    //             messageText: message.textChunks
    //         });
    //     }
    //     messageLength = computeMessageLength(selectedMessages);
    // });


    const compiledContext = {
        entities,
        topics,
        messages: selectedMessages
    };
    return compiledContext;
}

function computeContextLength(entities: contextSchema.RelevantKnowledge[], topics: contextSchema.RelevantKnowledge[]): number {
    return JSON.stringify({
        entities,
        topics
    }).length;
}

function computeMessageLength(messsages: contextSchema.RelevantMessage[]): number {
    return JSON.stringify({
        messsages
    }).length;
}