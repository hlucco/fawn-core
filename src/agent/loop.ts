/**
 * Agent reasoning loop.
 * Iteratively calls LLM, parses tool calls, executes tools, until final response.
 */

import type { TypeChatLanguageModel } from 'typechat';
import type { ToolRegistry } from './registry.js';
import type { ChatMessage, AgentLoopOptions, SystemPromptBuilder, ToolResult } from './types.js';
import { parseToolCalls, formatToolResults } from './parser.js';

/** Maximum iterations to prevent runaway loops */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Format a concise status message for a tool call
 */
function formatToolStatus(toolName: string, args: Record<string, unknown>): string {
  // Common tool patterns - customize based on tool name
  switch (toolName) {
    case 'read_file':
    case 'readFile':
      return `Reading ${shortenPath(String(args.path || args.file || ''))}`;
    case 'write_file':
    case 'writeFile':
      return `Writing ${shortenPath(String(args.path || args.file || ''))}`;
    case 'edit_file':
    case 'editFile':
      return `Editing ${shortenPath(String(args.path || args.file || ''))}`;
    case 'list_dir':
    case 'listDir':
    case 'ls':
      return `Listing ${shortenPath(String(args.path || args.dir || '.'))}`;
    case 'search':
    case 'grep':
      return `Searching for "${String(args.pattern || args.query || '').slice(0, 30)}"`;
    case 'shell':
    case 'run':
    case 'exec':
      return `Running: ${String(args.command || args.cmd || '').slice(0, 40)}`;
    case 'fetch_issue':
    case 'fetchIssue':
      return `Fetching issue #${args.issue_number || args.issueNumber || ''}`;
    case 'create_branch':
    case 'createBranch':
      return `Creating branch: ${args.name || args.branch || ''}`;
    case 'commit':
      return `Committing: ${String(args.message || '').slice(0, 40)}`;
    case 'push':
      return `Pushing to remote`;
    case 'create_pr':
    case 'createPR':
      return `Creating pull request`;
    default:
      // Generic format for unknown tools
      const argSummary = Object.entries(args)
        .slice(0, 2)
        .map(([k, v]) => `${k}=${String(v).slice(0, 20)}`)
        .join(', ');
      return `${toolName}${argSummary ? `: ${argSummary}` : ''}`;
  }
}

/**
 * Shorten a file path for display
 */
function shortenPath(path: string): string {
  if (!path) return '';
  // Get just filename or last 2 parts
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return '.../' + parts.slice(-2).join('/');
}

/** Default system prompt builder - just includes tool docs */
const defaultSystemPromptBuilder: SystemPromptBuilder = (toolDocs: string) => {
  return `You are a helpful AI assistant with access to tools.

${toolDocs}`;
};

/**
 * Run the agent loop for a single user message.
 *
 * @param userMessage - The user's message
 * @param toolRegistry - Available tools
 * @param languageModel - LLM to use for completions
 * @param systemPromptBuilder - Function to build system prompt from tool docs
 * @param options - Optional configuration
 * @returns The final response text
 */
export async function runAgentLoop(
  userMessage: string,
  toolRegistry: ToolRegistry,
  languageModel: TypeChatLanguageModel,
  systemPromptBuilder: SystemPromptBuilder = defaultSystemPromptBuilder,
  options: AgentLoopOptions = {}
): Promise<string> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const logger = options.logger;
  const conversationHistory = options.conversationHistory ?? [];

  // Build conversation history
  const toolDocs = toolRegistry.generateToolDocs();
  const systemPrompt = systemPromptBuilder(toolDocs);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    logger?.debug(`Agent loop iteration ${iteration + 1}`);

    // Call LLM
    const result = await languageModel.complete(
      messages.map(m => ({ role: m.role, content: m.content }))
    );

    if (!result.success) {
      logger?.error('LLM completion failed', { error: result.message });
      throw new Error(`LLM error: ${result.message}`);
    }

    const response = result.data;
    logger?.debug('LLM response received', { length: response.length });
    logger?.debug('LLM raw response', { response: response.slice(0, 500) });

    // Parse tool calls
    const { text, toolCalls } = parseToolCalls(response);

    // No tool calls? Return final response
    if (toolCalls.length === 0) {
      logger?.info('Agent completed');
      return text || response;
    }

    // Only execute the first tool call to enforce step-by-step execution
    const call = toolCalls[0];
    const status = formatToolStatus(call.name, call.arguments);
    logger?.info(status);

    if (toolCalls.length > 1) {
      logger?.debug(`Ignoring ${toolCalls.length - 1} additional tool calls to enforce step-by-step execution`);
    }

    // Execute single tool
    logger?.debug(`Executing tool: ${call.name}`, { arguments: call.arguments });
    const toolResult = await toolRegistry.execute(call);

    if (toolResult.result.success) {
      logger?.debug(`Tool ${call.name} succeeded`, { output: toolResult.result.output.slice(0, 100) });
    } else {
      logger?.info(`Tool ${call.name} failed: ${toolResult.result.error}`);
    }

    const results = [toolResult];

    // Add assistant response and tool results to history
    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: formatToolResults(results) });
  }

  // Max iterations exceeded
  logger?.warn('Agent loop exceeded max iterations');
  throw new Error(`Agent exceeded maximum iterations (${maxIterations})`);
}

/**
 * Agent that can process messages
 */
export interface Agent {
  /** Process a user message and return a response */
  processMessage(userMessage: string): Promise<string>;
}

/**
 * Create an agent bound to a tool registry and language model
 *
 * @param toolRegistry - The tools available to the agent
 * @param languageModel - The LLM to use for completions
 * @param systemPromptBuilder - Function to build system prompt from tool docs
 * @param options - Optional configuration
 */
export function createAgent(
  toolRegistry: ToolRegistry,
  languageModel: TypeChatLanguageModel,
  systemPromptBuilder: SystemPromptBuilder = defaultSystemPromptBuilder,
  options: AgentLoopOptions = {}
): Agent {
  return {
    async processMessage(userMessage: string): Promise<string> {
      return runAgentLoop(userMessage, toolRegistry, languageModel, systemPromptBuilder, options);
    }
  };
}
