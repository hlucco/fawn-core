import type {
    DateRange,
    ITimestampToTextRangeIndex,
    ListIndexingResult,
    MessageOrdinal,
    TimestampedTextRange
} from "./interfaces.js";

/** Helper to get day key (YYYY-MM-DD) from a date */
function getDayKey(date: Date): string {
    return date.toISOString().split('T')[0];
}

/** Helper to get start of day */
function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Helper to get end of day */
function endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

/**
 * Creates an in-memory implementation of ITimestampToTextRangeIndex
 */
export function createTimestampIndex(): ITimestampToTextRangeIndex {
    // Message ordinal -> timestamp string
    const messageToTimestamp = new Map<MessageOrdinal, string>();

    // Day-level index: "YYYY-MM-DD" -> message ordinals
    const dayIndex = new Map<string, Set<MessageOrdinal>>();

    // Sorted array for range queries (maintained on demand)
    let sortedEntries: Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }> | null = null;

    function invalidateSortedCache() {
        sortedEntries = null;
    }

    function addTimestamp(messageOrdinal: MessageOrdinal, timestamp: string): boolean {
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return false;
            }

            messageToTimestamp.set(messageOrdinal, timestamp);

            const dayKey = getDayKey(date);
            let dayMessages = dayIndex.get(dayKey);
            if (!dayMessages) {
                dayMessages = new Set();
                dayIndex.set(dayKey, dayMessages);
            }
            dayMessages.add(messageOrdinal);

            invalidateSortedCache();
            return true;
        } catch {
            return false;
        }
    }

    function addTimestamps(
        messageTimestamps: [MessageOrdinal, string][]
    ): ListIndexingResult {
        let numberCompleted = 0;
        for (const [messageOrdinal, timestamp] of messageTimestamps) {
            if (addTimestamp(messageOrdinal, timestamp)) {
                numberCompleted++;
            }
        }
        return { numberCompleted };
    }

    function ensureSorted(): Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }> {
        if (sortedEntries === null) {
            sortedEntries = [];
            for (const [messageOrdinal, timestamp] of messageToTimestamp) {
                sortedEntries.push({ messageOrdinal, timestamp: new Date(timestamp) });
            }
            sortedEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        }
        return sortedEntries;
    }

    function lookupRange(dateRange: DateRange): TimestampedTextRange[] {
        const sorted = ensureSorted();
        const startTime = dateRange.start.getTime();
        const endTime = dateRange.end ? dateRange.end.getTime() : Infinity;

        const results: TimestampedTextRange[] = [];
        for (const entry of sorted) {
            const time = entry.timestamp.getTime();
            if (time >= startTime && time <= endTime) {
                results.push({
                    timestamp: messageToTimestamp.get(entry.messageOrdinal)!,
                    range: {
                        start: { messageOrdinal: entry.messageOrdinal }
                    }
                });
            } else if (time > endTime) {
                break; // Past the end, no need to continue
            }
        }
        return results;
    }

    return {
        addTimestamp,
        addTimestamps,
        lookupRange
    };
}

/**
 * Extended timestamp index with additional query methods for search ranking.
 * This extends the base ITimestampToTextRangeIndex with semantic-ref aware methods.
 */
export interface TimestampIndexExtended extends ITimestampToTextRangeIndex {
    /** Get timestamp for a specific message */
    getMessageTimestamp(messageOrdinal: MessageOrdinal): Date | undefined;

    /** Get all messages on a specific day */
    getMessagesOnDay(date: Date): MessageOrdinal[];

    /** Get all messages before a date */
    getMessagesBefore(date: Date): MessageOrdinal[];

    /** Get all messages after a date */
    getMessagesAfter(date: Date): MessageOrdinal[];

    /** Get all timestamps sorted chronologically */
    getAllSorted(): Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }>;

    /** Get the date range of all indexed messages */
    getDateRange(): { earliest: Date; latest: Date } | undefined;

    /** Get count of indexed timestamps */
    size(): number;
}

/**
 * Creates an extended timestamp index with additional query methods
 */
export function createTimestampIndexExtended(): TimestampIndexExtended {
    // Message ordinal -> timestamp string
    const messageToTimestamp = new Map<MessageOrdinal, string>();

    // Day-level index: "YYYY-MM-DD" -> message ordinals
    const dayIndex = new Map<string, Set<MessageOrdinal>>();

    // Sorted array for range queries (maintained on demand)
    let sortedEntries: Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }> | null = null;

    function invalidateSortedCache() {
        sortedEntries = null;
    }

    function addTimestamp(messageOrdinal: MessageOrdinal, timestamp: string): boolean {
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return false;
            }

            messageToTimestamp.set(messageOrdinal, timestamp);

            const dayKey = getDayKey(date);
            let dayMessages = dayIndex.get(dayKey);
            if (!dayMessages) {
                dayMessages = new Set();
                dayIndex.set(dayKey, dayMessages);
            }
            dayMessages.add(messageOrdinal);

            invalidateSortedCache();
            return true;
        } catch {
            return false;
        }
    }

    function addTimestamps(
        messageTimestamps: [MessageOrdinal, string][]
    ): ListIndexingResult {
        let numberCompleted = 0;
        for (const [messageOrdinal, timestamp] of messageTimestamps) {
            if (addTimestamp(messageOrdinal, timestamp)) {
                numberCompleted++;
            }
        }
        return { numberCompleted };
    }

    function ensureSorted(): Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }> {
        if (sortedEntries === null) {
            sortedEntries = [];
            for (const [messageOrdinal, timestamp] of messageToTimestamp) {
                sortedEntries.push({ messageOrdinal, timestamp: new Date(timestamp) });
            }
            sortedEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        }
        return sortedEntries;
    }

    function lookupRange(dateRange: DateRange): TimestampedTextRange[] {
        const sorted = ensureSorted();
        const startTime = dateRange.start.getTime();
        const endTime = dateRange.end ? dateRange.end.getTime() : Infinity;

        const results: TimestampedTextRange[] = [];
        for (const entry of sorted) {
            const time = entry.timestamp.getTime();
            if (time >= startTime && time <= endTime) {
                results.push({
                    timestamp: messageToTimestamp.get(entry.messageOrdinal)!,
                    range: {
                        start: { messageOrdinal: entry.messageOrdinal }
                    }
                });
            } else if (time > endTime) {
                break;
            }
        }
        return results;
    }

    function getMessageTimestamp(messageOrdinal: MessageOrdinal): Date | undefined {
        const ts = messageToTimestamp.get(messageOrdinal);
        return ts ? new Date(ts) : undefined;
    }

    function getMessagesOnDay(date: Date): MessageOrdinal[] {
        const dayKey = getDayKey(date);
        const messages = dayIndex.get(dayKey);
        return messages ? [...messages] : [];
    }

    function getMessagesBefore(date: Date): MessageOrdinal[] {
        const sorted = ensureSorted();
        const targetTime = date.getTime();

        const results: MessageOrdinal[] = [];
        for (const entry of sorted) {
            if (entry.timestamp.getTime() < targetTime) {
                results.push(entry.messageOrdinal);
            } else {
                break;
            }
        }
        return results;
    }

    function getMessagesAfter(date: Date): MessageOrdinal[] {
        const sorted = ensureSorted();
        const targetTime = date.getTime();

        const results: MessageOrdinal[] = [];
        for (const entry of sorted) {
            if (entry.timestamp.getTime() > targetTime) {
                results.push(entry.messageOrdinal);
            }
        }
        return results;
    }

    function getAllSorted(): Array<{ messageOrdinal: MessageOrdinal; timestamp: Date }> {
        return [...ensureSorted()];
    }

    function getDateRange(): { earliest: Date; latest: Date } | undefined {
        const sorted = ensureSorted();
        if (sorted.length === 0) {
            return undefined;
        }
        return {
            earliest: sorted[0].timestamp,
            latest: sorted[sorted.length - 1].timestamp
        };
    }

    function size(): number {
        return messageToTimestamp.size;
    }

    return {
        addTimestamp,
        addTimestamps,
        lookupRange,
        getMessageTimestamp,
        getMessagesOnDay,
        getMessagesBefore,
        getMessagesAfter,
        getAllSorted,
        getDateRange,
        size
    };
}

/** Parse common temporal expressions to date ranges */
export function parseTemporalExpression(
    expression: string,
    referenceDate: Date = new Date()
): { start: Date; end: Date } | undefined {
    const lower = expression.toLowerCase().trim();
    const ref = new Date(referenceDate);

    // Today
    if (lower === 'today') {
        return { start: startOfDay(ref), end: endOfDay(ref) };
    }

    // Yesterday
    if (lower === 'yesterday') {
        const yesterday = new Date(ref);
        yesterday.setDate(yesterday.getDate() - 1);
        return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }

    // Last week
    if (lower === 'last week') {
        const end = new Date(ref);
        const start = new Date(ref);
        start.setDate(start.getDate() - 7);
        return { start: startOfDay(start), end: endOfDay(end) };
    }

    // Last month
    if (lower === 'last month') {
        const end = new Date(ref);
        const start = new Date(ref);
        start.setMonth(start.getMonth() - 1);
        return { start: startOfDay(start), end: endOfDay(end) };
    }

    // Last N days
    const lastNDaysMatch = lower.match(/last (\d+) days?/);
    if (lastNDaysMatch) {
        const days = parseInt(lastNDaysMatch[1]);
        const end = new Date(ref);
        const start = new Date(ref);
        start.setDate(start.getDate() - days);
        return { start: startOfDay(start), end: endOfDay(end) };
    }

    // This week (start of week to now)
    if (lower === 'this week') {
        const start = new Date(ref);
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek); // Go to Sunday
        return { start: startOfDay(start), end: endOfDay(ref) };
    }

    // This month
    if (lower === 'this month') {
        const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
        return { start: startOfDay(start), end: endOfDay(ref) };
    }

    // Month names (e.g., "in January", "January 2024")
    const months = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < months.length; i++) {
        if (lower.includes(months[i])) {
            const yearMatch = lower.match(/\d{4}/);
            const year = yearMatch ? parseInt(yearMatch[0]) : ref.getFullYear();
            const start = new Date(year, i, 1);
            const end = new Date(year, i + 1, 0); // Last day of month
            return { start: startOfDay(start), end: endOfDay(end) };
        }
    }

    // Specific date formats (try to parse)
    const dateAttempt = new Date(expression);
    if (!isNaN(dateAttempt.getTime())) {
        return { start: startOfDay(dateAttempt), end: endOfDay(dateAttempt) };
    }

    return undefined;
}

/** Check if a query contains temporal references */
export function hasTemporalReference(query: string): boolean {
    const lower = query.toLowerCase();

    const temporalKeywords = [
        'when', 'today', 'yesterday', 'last week', 'last month', 'this week',
        'this month', 'last year', 'this year', 'ago', 'before', 'after',
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'morning', 'afternoon', 'evening', 'night',
        'recently', 'earlier', 'later', 'during'
    ];

    // Check for year patterns (4 digits)
    if (/\b(19|20)\d{2}\b/.test(lower)) {
        return true;
    }

    // Check for date patterns
    if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(lower)) {
        return true;
    }

    return temporalKeywords.some(keyword => lower.includes(keyword));
}
