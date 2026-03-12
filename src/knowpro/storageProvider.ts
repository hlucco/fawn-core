import type { IMessageCollection, ISemanticRefCollection, IStorageProvider } from "./interfaces.js";
import { createMessageCollection, createSemanticRefCollection } from "./collections.js";
import { readFileSync } from "node:fs";
import { createMessage, type Message } from "./conversation.js";
import { populateSemanticRef } from "./semanticRef.js";
import { debug } from "./debug.js";

export interface InMemoryStorageProvider extends IStorageProvider {
    loadFromFile: (
        filePath: string,
        semanticRefs: ISemanticRefCollection,
        messages: IMessageCollection<Message>
    ) => void;
}

const SEPERATOR = "================================================================================";

export function createInMemoryStorageProvider(): InMemoryStorageProvider {

    function loadFromFile(
        filePath: string,
        semanticRefs: ISemanticRefCollection,
        messages: IMessageCollection<Message>
    ): void {
        const knowledgeFile = readFileSync(filePath, "utf-8");
        const sections = knowledgeFile.split(SEPERATOR);
        let lossCount = 0;
        sections.forEach((section) => {
            // if (semanticRefOrdinal != semanticRefs.length) {
            //     console.log("ERROR", semanticRefOrdinal, semanticRefs.length);
            //     throw Error("HELP SOMETHING WENT WRONG THESE MUST BE THE SAME LENGTH");
            // }
            const jsonStart = section.indexOf("{");

            // Get and add message
            const content = section.substring(0, jsonStart);
            const message = createMessage(content, []);

            // filter our the empty chunks
            if (content.length < 10) {
                return;
            }

            // 1. merge entities and actions
            // 2. make a token limit
            // 3. decide how to preseent merged e & a
            //    into the answer propmt densely

            // what did julia do in the forest?
            // how did julia meet winston?
            // what color is julia's sash?
            // what is the book winston gets from obrien about?
            // what is the uniform of the inner party?

            // Get knowledge and add semantic refs
            const jsonString = section.substring(jsonStart).split("\n")[0];
            try {
                const knowledgeResponse = JSON.parse(jsonString);
                if (knowledgeResponse) {
                    semanticRefs = populateSemanticRef(
                        semanticRefs, 
                        knowledgeResponse, 
                        semanticRefs.length,
                        messages.length
                    );
                    // semanticRefOrdinal += ordinalModifier;
                    messages.append(message);
                }
            } catch {
                lossCount += 1;
            }
        });

        debug("LOSS COUNT: ", lossCount, lossCount / sections.length, sections.length);
        debug(messages.length, semanticRefs.length);
    }

    function close() {
        debug("Closing storage provider.");
        return;
    }

    return {
        createMessageCollection,
        createSemanticRefCollection,
        loadFromFile,
        close
    }
}
