/**
 * Tool registry.
 * Manages available tools and generates system prompt documentation.
 */

import type { Tool, ToolResult, ParsedToolCall } from './types.js';

/**
 * Tool registry interface
 */
export interface ToolRegistry {
  /** Register a tool */
  register(tool: Tool): void;

  /** Get a tool by name */
  get(name: string): Tool | undefined;

  /** Get all registered tools */
  getAll(): Tool[];

  /** Generate tool documentation for system prompt */
  generateToolDocs(): string;

  /** Execute a parsed tool call */
  execute(call: ParsedToolCall): Promise<{ name: string; result: ToolResult }>;
}

/**
 * Create a tool registry
 */
export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();

  function register(tool: Tool): void {
    if (tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    tools.set(tool.name, tool);
  }

  function get(name: string): Tool | undefined {
    return tools.get(name);
  }

  function getAll(): Tool[] {
    return Array.from(tools.values());
  }

  function generateToolDocs(): string {
    const lines: string[] = [
      '## Tool Use Protocol',
      '',
      'To use a tool, wrap a JSON object in <tool_call></tool_call> tags:',
      '',
      '```',
      '<tool_call>',
      '{"name": "tool_name", "arguments": {"param": "value"}}',
      '</tool_call>',
      '```',
      '',
      'You may use multiple tool calls in a single response.',
      'After tool execution, results appear in <tool_result> tags.',
      'Continue reasoning with the results until you can give a final answer.',
      '',
      '## Available Tools',
      ''
    ];

    for (const tool of tools.values()) {
      lines.push(`### ${tool.name}`);
      lines.push('');
      lines.push(tool.description);
      lines.push('');
      lines.push('**Parameters:**');

      const paramEntries = Object.entries(tool.parameters);
      if (paramEntries.length === 0) {
        lines.push('- None');
      } else {
        for (const [name, spec] of paramEntries) {
          const required = spec.required !== false ? '(required)' : '(optional)';
          lines.push(`- \`${name}\` (${spec.type}) ${required}: ${spec.description}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  async function execute(
    call: ParsedToolCall
  ): Promise<{ name: string; result: ToolResult }> {
    const tool = tools.get(call.name);

    if (!tool) {
      return {
        name: call.name,
        result: {
          success: false,
          output: '',
          error: `Unknown tool: ${call.name}`
        }
      };
    }

    try {
      const result = await tool.execute(call.arguments);
      return { name: call.name, result };
    } catch (error) {
      return {
        name: call.name,
        result: {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  return {
    register,
    get,
    getAll,
    generateToolDocs,
    execute
  };
}
