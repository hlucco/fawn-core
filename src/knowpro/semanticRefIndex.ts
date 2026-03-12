import type { ISemanticRefCollection, ITermToSemanticRefIndex, ScoredSemanticRefOrdinal, SemanticRef, SemanticRefOrdinal, Topic } from "./interfaces.js";
import type { Action, ConcreteEntity, Facet } from "./knowledgeSchema.js";
import lemmatizer from "wink-lemmatizer";
import type { TypeChatLanguageModel } from "typechat";
import { createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "./schema.js";
import type { RelatedTermsResponse } from "./relatedTermsSchema.js";
import natural from "natural";
import { debug } from "./debug.js";

export interface RelatedTermsExpansionOptions {
    /** Weight for related terms (0-1, default 0.9) */
    relatedTermWeight?: number;
    /** Batch size as percentage of total terms (0-1, default 0.1 = 10%) */
    batchSizePercent?: number;
    /** Maximum terms per batch (default 50) */
    maxBatchSize?: number;
    /** Minimum terms per batch (default 5) */
    minBatchSize?: number;
    /** Maximum total terms to process (default: all eligible terms) */
    maxTerms?: number;
}

export interface RelatedTermsExpansionResult {
    termsProcessed: number;
    relatedTermsAdded: number;
    /** Map of original term -> related terms added */
    expansionMap: Map<string, string[]>;
}

export interface WordNetExpansionOptions {
    /** Weight for related terms (0-1, default 0.9) */
    relatedTermWeight?: number;
    /** Maximum total terms to process (default: all eligible terms) */
    maxTerms?: number;
}

export interface InMemorySemanticRefIndex extends ITermToSemanticRefIndex {
    addEntity: (entity: ConcreteEntity, refOrdinal: SemanticRefOrdinal) => void;
    addFacet: (facet: Facet, refOrdinal: SemanticRefOrdinal) => void;
    addAction: (action: Action, refOrdinal: SemanticRefOrdinal) => void;
    addTopic: (topic: Topic, refOrdinal: SemanticRefOrdinal) => void;
    buildIndex: (semanticRefCollection: ISemanticRefCollection) => void;
    lemmatizeIndex: () => LemmatizationResult;
    expandWithRelatedTerms: (model: TypeChatLanguageModel, options?: RelatedTermsExpansionOptions) => Promise<RelatedTermsExpansionResult>;
    expandWithWordNet: (options?: WordNetExpansionOptions) => Promise<RelatedTermsExpansionResult>;
    loadFromExport: (items: Array<{ term: string; semanticRefOrdinals: ScoredSemanticRefOrdinal[] }>) => void;
}

export interface LemmatizationResult {
    termsProcessed: number;
    lemmasAdded: number;
    lemmaMap: Map<string, string>;
}

export function createInMemorySemanticRefIndex(): InMemorySemanticRefIndex {

    const map = new Map<string, ScoredSemanticRefOrdinal[]>();

    return {
        getTerms,
        addTerm,
        removeTerm,
        lookupTerm,
        addEntity,
        addFacet,
        addAction,
        addTopic,
        buildIndex,
        lemmatizeIndex,
        expandWithRelatedTerms,
        expandWithWordNet,
        loadFromExport
    }

    // what is a term?
    // - entity name
    // - every type in entity
    // - every facet in entity
    // - every topic
    // - every action verbs joined
    // - action subject entity name
    // - action object entity name
    // - action inderect object entity name
    // - action params

    function getTerms(): string[] {
        return [...map.keys()];
    }

    function lookupTerm(term: string): ScoredSemanticRefOrdinal[] | undefined {
        return map.get(term);
    }

    function removeTerm(term: string) {
        map.delete(term);
    }

    function addTerm(term: string, semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal): string {
        if (!term) {
            return term;
        }

        term = term.toLowerCase();
        const existing = map.get(term);

        // Handle both SemanticRefOrdinal (number) and ScoredSemanticRefOrdinal (object with score)
        let scoredOrdinal: ScoredSemanticRefOrdinal;
        if (typeof semanticRefOrdinal === 'number') {
            scoredOrdinal = {
                semanticRefOrdinal,
                score: 1.0
            };
        } else {
            scoredOrdinal = semanticRefOrdinal;
        }

        if (!existing) {
            map.set(term, [scoredOrdinal]);
        } else {
            map.set(term, [...existing, scoredOrdinal]);
        }

        return term;
    }

    function addEntity(entity: ConcreteEntity, refOrdinal: SemanticRefOrdinal) {
        // console.log("ADDING ENTITY", entity)
        if (!entity.type) {
            // TODO this is a hack we need to add some sort of validation
            // to the fine tuning output so we don't get malformed objects
            return;
        }
        addTerm(entity.name, refOrdinal);

        entity.type.forEach((subType) => {
            addTerm(subType, refOrdinal);
        })

        if(entity.facets) {
            entity.facets.forEach(facet => {
                addFacet(facet, refOrdinal);
            });
        }
    }

    function addFacet(facet: Facet, refOrdinal: SemanticRefOrdinal) {
        addTerm(facet.name, refOrdinal);
        if (facet.value) {
            addTerm(facet.value.toString(), refOrdinal);
        }
    }

    function addAction(action: Action, refOrdinal: SemanticRefOrdinal) {
        // console.log("ADDING ACTION", action)
        const actionTerm = action.verbs.join(" ");
        addTerm(actionTerm, refOrdinal);
        addTerm(action.objectEntityName, refOrdinal);
        addTerm(action.indirectObjectEntityName, refOrdinal);
        addTerm(action.subjectEntityName, refOrdinal);

        if (action.params) {
            action.params.forEach((param) => {
                if (typeof(param) === "string") {
                    addTerm(param, refOrdinal);
                } else {
                    addTerm(param.name, refOrdinal);

                    // same here this is a crutch for malformed llm output
                    if (param.value) {
                        addTerm(param.value.toString(), refOrdinal);
                    }
                }
            })
        }
    }

    function addTopic(topic: Topic, refOrdinal: SemanticRefOrdinal) {
        addTerm(topic.text, refOrdinal);
    }

    function buildIndex(semanticRefs: ISemanticRefCollection) {
        semanticRefs.getAll().forEach((ref: SemanticRef) => {
            switch(ref.knowledgeType) {
                case "entity": {
                    addEntity(ref.knowledge as ConcreteEntity, ref.semanticRefOrdinal);
                    break;
                }
                case "action": {
                    addAction(ref.knowledge as Action, ref.semanticRefOrdinal);
                    break;
                }
                case "topic" : {
                    addTopic(ref.knowledge as Topic, ref.semanticRefOrdinal);
                    break;
                }
                default: {
                    break;
                }
            }
        });
    }

    function loadFromExport(items: Array<{ term: string; semanticRefOrdinals: ScoredSemanticRefOrdinal[] }>) {
        // Clear existing index
        map.clear();

        // Load all terms with their scored ordinals
        for (const item of items) {
            map.set(item.term.toLowerCase(), item.semanticRefOrdinals);
        }
    }

    function lemmatizeIndex(): LemmatizationResult {
        const terms = getTerms();
        const lemmaMap = new Map<string, string>();
        let lemmasAdded = 0;

        for (const term of terms) {
            // Skip very short terms or terms with spaces (phrases)
            if (term.length < 3 || term.includes(" ")) {
                continue;
            }

            // Get the semantic refs for this term
            const refs = map.get(term);
            if (!refs || refs.length === 0) {
                continue;
            }

            // Try lemmatizing as different parts of speech
            const nounLemma = lemmatizer.noun(term);
            const verbLemma = lemmatizer.verb(term);
            const adjLemma = lemmatizer.adjective(term);

            // Collect unique lemmas that differ from the original
            const lemmas = new Set<string>();
            if (nounLemma !== term) lemmas.add(nounLemma);
            if (verbLemma !== term) lemmas.add(verbLemma);
            if (adjLemma !== term) lemmas.add(adjLemma);

            // Add each lemma to the index pointing to the same refs
            for (const lemma of lemmas) {
                // Skip if lemma is already in the index with the same refs
                const existingRefs = map.get(lemma);

                if (!existingRefs) {
                    // New lemma - add all refs
                    map.set(lemma, [...refs]);
                    lemmasAdded++;
                    lemmaMap.set(term, lemma);
                } else {
                    // Lemma exists - merge refs (avoid duplicates)
                    const existingOrdinals = new Set(existingRefs.map(r => r.semanticRefOrdinal));
                    const newRefs = refs.filter(r => !existingOrdinals.has(r.semanticRefOrdinal));
                    if (newRefs.length > 0) {
                        map.set(lemma, [...existingRefs, ...newRefs]);
                    }
                }
            }
        }

        return {
            termsProcessed: terms.length,
            lemmasAdded,
            lemmaMap
        };
    }

    async function expandWithRelatedTerms(
        model: TypeChatLanguageModel,
        options?: RelatedTermsExpansionOptions
    ): Promise<RelatedTermsExpansionResult> {
        const {
            relatedTermWeight = 0.9,
            batchSizePercent = 0.1,
            maxBatchSize = 50,
            minBatchSize = 5,
            maxTerms
        } = options ?? {};

        const terms = getTerms();
        const expansionMap = new Map<string, string[]>();
        let relatedTermsAdded = 0;

        // Filter terms: skip very short terms, phrases, and common stop words
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'it', 'its']);

        let eligibleTerms = terms.filter(term =>
            term.length >= 3 &&
            !term.includes(' ') &&
            !stopWords.has(term)
        );

        // Limit total terms if maxTerms is specified
        if (maxTerms !== undefined && maxTerms < eligibleTerms.length) {
            eligibleTerms = eligibleTerms.slice(0, maxTerms);
        }

        if (eligibleTerms.length === 0) {
            return { termsProcessed: 0, relatedTermsAdded: 0, expansionMap };
        }

        // Calculate batch size
        const calculatedBatchSize = Math.floor(eligibleTerms.length * batchSizePercent);
        const batchSize = Math.max(minBatchSize, Math.min(maxBatchSize, calculatedBatchSize));

        // Create translator for related terms
        const schema = loadSchema(["relatedTermsSchema.ts"], import.meta.url);
        const validator = createTypeScriptJsonValidator<RelatedTermsResponse>(schema, "RelatedTermsResponse");
        const translator = createJsonTranslator<RelatedTermsResponse>(model, validator);

        translator.createRequestPrompt = (request: string) => {
            return (
                `You are a service that finds semantically related words for search index expansion.\n` +
                `Given a list of terms, return synonyms and semantically related words for each.\n\n` +
                `IMPORTANT RULES:\n` +
                `- Do NOT include morphological variants (plurals, verb tenses, etc.) - only semantically different words\n` +
                `- Focus on words that users might use interchangeably when searching\n` +
                `- Include synonyms, near-synonyms, and closely related concepts\n` +
                `- Keep related terms to 2-5 per term (quality over quantity)\n` +
                `- Skip proper nouns (names of people, places, brands)\n\n` +
                `Examples:\n` +
                `- book -> [novel, publication, text, volume]\n` +
                `- buy -> [purchase, acquire, obtain]\n` +
                `- happy -> [joyful, pleased, glad, content]\n` +
                `- psychology -> [mental health, counseling, therapy]\n\n` +
                `The following TypeScript definitions describe the expected response format:\n` +
                `\`\`\`\n${schema}\`\`\`\n` +
                `Input terms:\n${request}\n\n` +
                `Return a JSON object of type RelatedTermsResponse with related terms for each input term:\n`
            );
        };

        // Process in batches
        for (let i = 0; i < eligibleTerms.length; i += batchSize) {
            const batch = eligibleTerms.slice(i, i + batchSize);
            debug(`Expanding terms batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eligibleTerms.length / batchSize)} (${batch.length} terms)`);

            try {
                const request = batch.join(', ');
                const result = await translator.translate(request);

                if (!result.success) {
                    console.warn(`Failed to expand batch: ${result.message}`);
                    continue;
                }

                // Process the response
                for (const termWithRelated of result.data.terms) {
                    const originalTerm = termWithRelated.term.toLowerCase();
                    const refs = map.get(originalTerm);

                    if (!refs || refs.length === 0) {
                        continue;
                    }

                    const addedRelated: string[] = [];

                    for (const relatedTerm of termWithRelated.relatedTerms) {
                        const normalizedRelated = relatedTerm.toLowerCase();

                        // Skip if it's the same as the original
                        if (normalizedRelated === originalTerm) {
                            continue;
                        }

                        // Add the related term pointing to the same refs with lower weight
                        for (const ref of refs) {
                            const weightedRef: ScoredSemanticRefOrdinal = {
                                semanticRefOrdinal: ref.semanticRefOrdinal,
                                score: ref.score * relatedTermWeight
                            };

                            // Check if this term already exists with this ref
                            const existingRefs = map.get(normalizedRelated);
                            if (existingRefs) {
                                const alreadyHasRef = existingRefs.some(r => r.semanticRefOrdinal === ref.semanticRefOrdinal);
                                if (!alreadyHasRef) {
                                    map.set(normalizedRelated, [...existingRefs, weightedRef]);
                                }
                            } else {
                                map.set(normalizedRelated, [weightedRef]);
                            }
                        }

                        addedRelated.push(normalizedRelated);
                        relatedTermsAdded++;
                    }

                    if (addedRelated.length > 0) {
                        expansionMap.set(originalTerm, addedRelated);
                    }
                }
            } catch (error) {
                console.error(`Error expanding batch:`, error);
            }
        }

        return {
            termsProcessed: eligibleTerms.length,
            relatedTermsAdded,
            expansionMap
        };
    }

    async function expandWithWordNet(
        options?: WordNetExpansionOptions
    ): Promise<RelatedTermsExpansionResult> {
        const {
            relatedTermWeight = 0.9,
            maxTerms
        } = options ?? {};

        const wordnet = new natural.WordNet();
        const terms = getTerms();
        const expansionMap = new Map<string, string[]>();
        let relatedTermsAdded = 0;

        // Filter terms: skip very short terms, phrases, and common stop words
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'it', 'its']);

        let eligibleTerms = terms.filter(term =>
            term.length >= 3 &&
            !term.includes(' ') &&
            !stopWords.has(term)
        );

        // Limit total terms if maxTerms is specified
        if (maxTerms !== undefined && maxTerms < eligibleTerms.length) {
            eligibleTerms = eligibleTerms.slice(0, maxTerms);
        }

        if (eligibleTerms.length === 0) {
            return { termsProcessed: 0, relatedTermsAdded: 0, expansionMap };
        }

        // Helper to get synonyms from WordNet (promisified)
        const getSynonyms = (word: string): Promise<string[]> => {
            return new Promise((resolve) => {
                const synonyms = new Set<string>();
                wordnet.lookup(word, (results) => {
                    if (results && results.length > 0) {
                        for (const result of results) {
                            // Add synonyms from the synset
                            if (result.synonyms) {
                                for (const syn of result.synonyms) {
                                    const normalized = syn.toLowerCase().replace(/_/g, ' ');
                                    // Skip multi-word phrases and the original word
                                    if (!normalized.includes(' ') && normalized !== word) {
                                        synonyms.add(normalized);
                                    }
                                }
                            }
                        }
                    }
                    resolve([...synonyms].slice(0, 5)); // Limit to 5 synonyms per term
                });
            });
        };

        debug(`Expanding ${eligibleTerms.length} terms using WordNet...`);
        let processed = 0;

        for (const term of eligibleTerms) {
            const refs = map.get(term);
            if (!refs || refs.length === 0) {
                continue;
            }

            const synonyms = await getSynonyms(term);
            const addedRelated: string[] = [];

            for (const synonym of synonyms) {
                // Add the related term pointing to the same refs with lower weight
                for (const ref of refs) {
                    const weightedRef: ScoredSemanticRefOrdinal = {
                        semanticRefOrdinal: ref.semanticRefOrdinal,
                        score: ref.score * relatedTermWeight
                    };

                    // Check if this term already exists with this ref
                    const existingRefs = map.get(synonym);
                    if (existingRefs) {
                        const alreadyHasRef = existingRefs.some(r => r.semanticRefOrdinal === ref.semanticRefOrdinal);
                        if (!alreadyHasRef) {
                            map.set(synonym, [...existingRefs, weightedRef]);
                        }
                    } else {
                        map.set(synonym, [weightedRef]);
                    }
                }

                addedRelated.push(synonym);
                relatedTermsAdded++;
            }

            if (addedRelated.length > 0) {
                expansionMap.set(term, addedRelated);
            }

            processed++;
            if (processed % 100 === 0) {
                debug(`  Processed ${processed}/${eligibleTerms.length} terms...`);
            }
        }

        debug(`WordNet expansion complete: ${relatedTermsAdded} related terms added`);

        return {
            termsProcessed: eligibleTerms.length,
            relatedTermsAdded,
            expansionMap
        };
    }

}