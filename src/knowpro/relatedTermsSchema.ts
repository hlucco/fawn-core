/**
 * Schema for LLM-based related terms expansion.
 * Given a list of terms, the LLM returns semantically related words.
 */

/**
 * A term and its semantically related words.
 */
export interface TermWithRelated {
    /** The original term */
    term: string;
    /** Semantically related words (synonyms, near-synonyms, conceptually related).
     * Do NOT include morphological variants (plurals, verb tenses) - only semantically different words.
     * Examples: book -> [novel, publication, text], buy -> [purchase, acquire], happy -> [joyful, pleased]
     */
    relatedTerms: string[];
}

/**
 * Response containing related terms for a batch of input terms.
 */
export interface RelatedTermsResponse {
    /** Array of terms with their related words */
    terms: TermWithRelated[];
}
