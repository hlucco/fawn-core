/**
 * Agent tool system types.
 * Extensible tool interface for the agent loop.
 */

/**
 * Parameter specification for a tool argument
 */
export interface ParameterSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Tool interface - implement this to create new tools
 */
export interface Tool {
  /** Unique tool name */
  readonly name: string;

  /** Human-readable description of what the tool does */
  readonly description: string;

  /** Parameter specifications */
  readonly parameters: Record<string, ParameterSpec>;

  /** Execute the tool with the given arguments */
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Parsed tool call from LLM response
 */
export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of parsing LLM response for tool calls
 */
export interface ParseResult {
  /** Text content outside of tool calls */
  text: string;
  /** Parsed tool calls */
  toolCalls: ParsedToolCall[];
}

/**
 * Chat message for conversation history
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Logger interface for agent loop
 */
export interface AgentLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Agent loop options
 */
export interface AgentLoopOptions {
  /** Maximum iterations before stopping (default: 10) */
  maxIterations?: number;
  /** Optional logger for debugging */
  logger?: AgentLogger;
  /** Optional conversation history to prepend */
  conversationHistory?: ChatMessage[];
}

/**
 * System prompt builder function type
 */
export type SystemPromptBuilder = (toolDocs: string) => string;
