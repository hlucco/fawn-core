/**
 * Agent module - reusable agent loop with tool support
 *
 * This module provides a generic agent loop that:
 * - Iteratively calls an LLM with tool documentation
 * - Parses tool calls from LLM responses
 * - Executes tools and feeds results back to the LLM
 * - Continues until a final response is reached
 *
 * Usage:
 * ```typescript
 * import { createToolRegistry, createAgent } from 'fawn/agent';
 *
 * const registry = createToolRegistry();
 * registry.register({
 *   name: 'my_tool',
 *   description: 'Does something',
 *   parameters: { input: { type: 'string', description: 'The input' } },
 *   execute: async (args) => ({ success: true, output: `Got: ${args.input}` })
 * });
 *
 * const agent = createAgent(registry, languageModel, (toolDocs) => `
 *   You are a helpful assistant.
 *   ${toolDocs}
 * `);
 *
 * const response = await agent.processMessage('Hello!');
 * ```
 */

// Types
export type {
  Tool,
  ToolResult,
  ParameterSpec,
  ParsedToolCall,
  ParseResult,
  ChatMessage,
  AgentLogger,
  AgentLoopOptions,
  SystemPromptBuilder
} from './types.js';

// Tool registry
export { createToolRegistry } from './registry.js';
export type { ToolRegistry } from './registry.js';

// Parser utilities
export { parseToolCalls, formatToolResults } from './parser.js';

// Agent loop
export { runAgentLoop, createAgent } from './loop.js';
export type { Agent } from './loop.js';
