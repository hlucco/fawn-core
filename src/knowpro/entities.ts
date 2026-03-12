import { stringEquals } from "../utils/string.js";
import { debug } from "./debug.js";
import type { SemanticRef, Topic } from "./interfaces.js";
import type { Action, ConcreteEntity, Facet } from "./knowledgeSchema.js";

export function facetMatch(x: Facet, y: Facet): boolean {
    if (!stringEquals(x.name, y.name, false)) {
        return false;
    }
    if (typeof x.value === "object") {
        if (typeof y.value === "object") {
            return (
                x.value.amount === y.value.amount &&
                x.value.units === y.value.units
            );
        } else {
            return false;
        }
    } else {
        return x.value === y.value;
    }
}

export function mergeEntityFacet(entity: ConcreteEntity, facet: Facet) {
    entity.facets ??= [];
    // Look for an equal facet
    for (const f of entity.facets) {
        if (facetMatch(f, facet)) {
            break;
        }
    }
    entity.facets.push(facet);
}

export function printEntity(entity: ConcreteEntity) {
    debug("ENTITY: ", entity.name, entity.type);
    if(entity.facets) {
        debug("Facets: ");
        entity.facets.forEach((facet) => {
            debug("  - ", facet.name, facet.value);
        });
    }
}

export function printAction(action: Action) {
    debug(
        "ACTION: ",
        action.objectEntityName,
        action.verbs,
        action.subjectEntityName,
        action.indirectObjectEntityName,
        action.subjectEntityFacet,
        action.params
    );
}

export function printTopic(topic: Topic) {
    debug("TOPIC: ", topic.text);
}

export function printRef(ref: SemanticRef) {
    switch(ref.knowledgeType) {
        case "action": {
            printAction(ref.knowledge as Action);
            break;
        }
        case "entity": {
            printEntity(ref.knowledge as ConcreteEntity);
            break;
        }
        case "topic": {
            printTopic(ref.knowledge as Topic);
            break;
        }
        default: {
            break;
        }
    }
}