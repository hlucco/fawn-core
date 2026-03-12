import { debug } from "./debug.js";
import type { ISemanticRefCollection, SemanticRef } from "./interfaces.js";
import type { KnowledgeResponse } from "./knowledgeSchema.js";

export function populateSemanticRef(
    semanticRefs: ISemanticRefCollection,
    knowledgeResponse: KnowledgeResponse,
    baseSemanticRefOrdinal: number,
    messageOrdinal: number
): ISemanticRefCollection {
    let semanticRefOrdinalModifier = baseSemanticRefOrdinal;
    // create semantic refs from the extracted knowledge here
    try {

        knowledgeResponse.entities.forEach((entity) => {
            const newSemanticRef: SemanticRef = {
                semanticRefOrdinal: semanticRefOrdinalModifier,
                knowledgeType: "entity",
                range: {
                    start: {
                        messageOrdinal
                    },
                    end: {
                        messageOrdinal
                    }
                },
                knowledge: entity
            }
            semanticRefs.append(newSemanticRef);
            semanticRefOrdinalModifier += 1;
        });

        knowledgeResponse.actions.forEach((action) => {
            const newSemanticRef: SemanticRef = {
                semanticRefOrdinal: semanticRefOrdinalModifier,
                knowledgeType: "action",
                knowledge: action,
                range: {
                    start: {
                        messageOrdinal
                    },
                    end: {
                        messageOrdinal
                    }
                },
            }
            semanticRefs.append(newSemanticRef);
            semanticRefOrdinalModifier += 1;
        });

        knowledgeResponse.topics.forEach((topic) => {
            const newSemanticRef: SemanticRef = {
                semanticRefOrdinal: semanticRefOrdinalModifier,
                knowledgeType: "topic",
                knowledge: { text: topic },
                range: {
                    start: {
                        messageOrdinal
                    },
                    end: {
                        messageOrdinal
                    }
                },
            }
            semanticRefs.append(newSemanticRef);
            semanticRefOrdinalModifier += 1;
        });

    } catch (error) {
        debug(error);
    }

    return semanticRefs;
}
