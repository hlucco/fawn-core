/**
 * Debug logging configuration.
 * Debug output is disabled by default.
 *
 * Enable via:
 * - Environment variable: FAWN_DEBUG=1
 * - Programmatically: setDebug(true)
 */

let debugEnabled = process.env.FAWN_DEBUG === '1' || process.env.FAWN_DEBUG === 'true';

/**
 * Enable or disable debug logging.
 */
export function setDebug(enabled: boolean): void {
    debugEnabled = enabled;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
    return debugEnabled;
}

/**
 * Log a debug message. Only outputs when debug mode is enabled.
 */
export function debug(...args: unknown[]): void {
    if (debugEnabled) {
        console.log('[fawn]', ...args);
    }
}
