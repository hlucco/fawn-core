import type { IMessage, IMessageCollection, ISemanticRefCollection, MessageOrdinal, SemanticRef, SemanticRefOrdinal } from "./interfaces.js";

export function createInMemoryCollection<T, TOrdinal>(
    createOrdinal?: (index: number, item: T) => TOrdinal
){
    const entries = new Map<TOrdinal, T>();
    const order: TOrdinal[] = [];

    function get(ordinal: TOrdinal): T {
        const value = entries.get(ordinal);
        if (value === undefined) {
            throw new RangeError(`No item at ordinal ${ordinal}`);
        }
        return value;
    }

    // could be optimized look at what ms team does
    function getMultiple(ordinals: TOrdinal[]): T[] {
        return ordinals.map((ordinal) => {
            return get(ordinal);
        })
    }

    function getSlice(start: number, end: number): T[] {
        return order.slice(start, end).map((ordinal) => entries.get(ordinal)!);
    }

    function getAll(): T[] {
        return [...entries.values()];
    }

    function append(...items: T[]): void {
        items.forEach((value, idx) => {
            // ask about this cast here
            const ordinal = createOrdinal ? createOrdinal(idx, value) : order.length as TOrdinal;
            order.push(ordinal);
            entries.set(ordinal, value);
        });
    }

    return {
        isPersistent: false,
        get length() {
            return order.length;
        },
        get,
        getMultiple,
        getSlice,
        getAll,
        append,
        [Symbol.iterator]() {
            return entries.values()[Symbol.iterator]();
        }
    }
}

export function createMessageCollection<TMessage extends IMessage = IMessage>(): IMessageCollection<TMessage> {
    return createInMemoryCollection<TMessage, MessageOrdinal>();
}

export function createSemanticRefCollection(): ISemanticRefCollection {
    return createInMemoryCollection<SemanticRef, SemanticRefOrdinal>();
}