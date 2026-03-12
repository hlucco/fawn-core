/**
 * XML tool call parser.
 * Parses <tool_call> tags from LLM responses.
 */

import type { ParseResult, ParsedToolCall, ToolResult } from './types.js';

/** Supported opening tags for tool calls */
const TOOL_CALL_OPEN_TAGS = ['<tool_call>', '<toolcall>', '<tool-call>', '<invoke>'] as const;

/** Map opening tags to their closing counterparts */
const CLOSE_TAG_MAP: Record<string, string> = {
  '<tool_call>': '</tool_call>',
  '<toolcall>': '</toolcall>',
  '<tool-call>': '</tool-call>',
  '<invoke>': '</invoke>'
};

/**
 * Find the first matching open tag in the text
 */
function findFirstOpenTag(text: string): { index: number; tag: string } | null {
  let earliest: { index: number; tag: string } | null = null;

  for (const tag of TOOL_CALL_OPEN_TAGS) {
    const index = text.indexOf(tag);
    if (index !== -1 && (earliest === null || index < earliest.index)) {
      earliest = { index, tag };
    }
  }

  return earliest;
}

/**
 * Extract JSON from inside a tool call tag
 */
function extractJson(content: string): ParsedToolCall | null {
  // Try to find JSON object in the content
  const trimmed = content.trim();

  // Remove markdown code blocks if present
  let jsonStr = trimmed;
  if (jsonStr.startsWith('```')) {
    const endFence = jsonStr.indexOf('```', 3);
    if (endFence !== -1) {
      // Skip the first line (```json or similar)
      const firstNewline = jsonStr.indexOf('\n');
      jsonStr = jsonStr.slice(firstNewline + 1, endFence).trim();
    }
  }

  // Find the JSON object
  const jsonStart = jsonStr.indexOf('{');
  if (jsonStart === -1) {
    return null;
  }

  // Find matching closing brace
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let jsonEnd = -1;

  for (let i = jsonStart; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (jsonEnd === -1) {
    return null;
  }

  try {
    const json = JSON.parse(jsonStr.slice(jsonStart, jsonEnd));

    // Handle OpenAI function format: { function: { name, arguments } }
    if (json.function && typeof json.function === 'object') {
      const fn = json.function;
      const args = typeof fn.arguments === 'string'
        ? JSON.parse(fn.arguments)
        : fn.arguments || {};
      return { name: fn.name, arguments: args };
    }

    // Standard format: { name, arguments }
    if (typeof json.name === 'string') {
      const args = typeof json.arguments === 'string'
        ? JSON.parse(json.arguments)
        : json.arguments || {};
      return { name: json.name, arguments: args };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse tool calls from LLM response text.
 *
 * Supports multiple tag formats:
 * - <tool_call>...</tool_call>
 * - <toolcall>...</toolcall>
 * - <tool-call>...</tool-call>
 * - <invoke>...</invoke>
 */
export function parseToolCalls(response: string): ParseResult {
  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];
  let remaining = response;

  while (true) {
    const openTag = findFirstOpenTag(remaining);
    if (!openTag) {
      // No more tool calls, rest is text
      if (remaining.trim()) {
        textParts.push(remaining.trim());
      }
      break;
    }

    // Text before the tag
    const before = remaining.slice(0, openTag.index).trim();
    if (before) {
      textParts.push(before);
    }

    // Find closing tag
    const closeTag = CLOSE_TAG_MAP[openTag.tag];
    const afterOpen = remaining.slice(openTag.index + openTag.tag.length);
    const closeIndex = afterOpen.indexOf(closeTag);

    if (closeIndex === -1) {
      // No closing tag found, treat rest as text
      textParts.push(remaining.slice(openTag.index).trim());
      break;
    }

    // Extract content between tags
    const content = afterOpen.slice(0, closeIndex);
    const parsed = extractJson(content);

    if (parsed) {
      toolCalls.push(parsed);
    }

    // Continue after the closing tag
    remaining = afterOpen.slice(closeIndex + closeTag.length);
  }

  return {
    text: textParts.join('\n'),
    toolCalls
  };
}

/**
 * Format tool results as XML for the next LLM turn
 */
export function formatToolResults(
  results: Array<{ name: string; result: ToolResult }>
): string {
  const parts: string[] = ['[Tool Results]'];

  for (const { name, result } of results) {
    const status = result.success ? 'success' : 'error';
    const content = result.success ? result.output : (result.error || result.output);
    parts.push(`<tool_result name="${name}" status="${status}">\n${content}\n</tool_result>`);
  }

  return parts.join('\n\n');
}
