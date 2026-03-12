import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { TypeChatLanguageModel, PromptSection, Result } from 'typechat';
import { createOpenAILanguageModel, success, error } from 'typechat';

// Re-export typechat types for custom provider implementations
export type { TypeChatLanguageModel, PromptSection, Result };
export { success, error };

/**
 * Built-in provider types. Custom providers can use any string.
 */
export type BuiltInLLMProviderType = 'openai' | 'claude' | 'claude-agent-sdk';

export interface LLMProviderConfig {
  provider: string;
  apiKey?: string;
  model?: string;
}

/**
 * LLM Provider interface.
 * Implement this interface to create custom LLM providers.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  getLanguageModel(): TypeChatLanguageModel;
}

/**
 * Creates an OpenAI LLM provider.
 */
export function createOpenAIProvider(
  apiKey: string,
  model: string = 'gpt-4o'
): LLMProvider {
  const languageModel = createOpenAILanguageModel(apiKey, model);
  return {
    name: 'openai',
    model,
    getLanguageModel: () => languageModel
  };
}

/**
 * Helper function to extract string content from a PromptSection.
 * Useful for custom provider implementations.
 */
export function getContentAsString(content: PromptSection['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content.map(c => {
    if (typeof c === 'string') {
      return c;
    }
    if (c.type === 'text') {
      return c.text;
    }
    return '';
  }).join('');
}

/**
 * Creates a Claude/Anthropic LLM provider.
 */
export function createClaudeProvider(
  apiKey: string,
  model: string = 'claude-sonnet-4-20250514'
): LLMProvider {
  const client = new Anthropic({ apiKey });

  const languageModel: TypeChatLanguageModel = {
    retryMaxAttempts: 3,
    retryPauseMs: 1000,
    async complete(prompt: string | PromptSection[]): Promise<Result<string>> {
      try {
        let systemMessage: string | undefined;
        let userMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        if (typeof prompt === 'string') {
          userMessages = [{ role: 'user', content: prompt }];
        } else {
          for (const section of prompt) {
            const contentStr = getContentAsString(section.content);
            if (section.role === 'system') {
              systemMessage = systemMessage
                ? `${systemMessage}\n\n${contentStr}`
                : contentStr;
            } else if (section.role === 'user' || section.role === 'assistant') {
              userMessages.push({
                role: section.role,
                content: contentStr
              });
            }
          }
        }

        if (userMessages.length === 0) {
          userMessages = [{ role: 'user', content: '' }];
        }

        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: systemMessage,
          messages: userMessages
        });

        const textContent = response.content.find(block => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          return error('No text response from Claude');
        }

        return success(textContent.text);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return error(`Claude API error: ${message}`);
      }
    }
  };

  return {
    name: 'claude',
    model,
    getLanguageModel: () => languageModel
  };
}

/**
 * Creates a Claude Agent SDK provider.
 * Uses the Claude Agent SDK for LLM completions, which provides access to
 * Claude Code's capabilities including extended thinking and tool use.
 *
 * Note: This requires Claude Code CLI to be installed.
 */
export function createClaudeAgentSDKProvider(
  model: string = 'sonnet'
): LLMProvider {
  const languageModel: TypeChatLanguageModel = {
    retryMaxAttempts: 3,
    retryPauseMs: 1000,
    async complete(prompt: string | PromptSection[]): Promise<Result<string>> {
      try {
        let systemMessage: string | undefined;
        let userMessage = '';

        if (typeof prompt === 'string') {
          userMessage = prompt;
        } else {
          // Build system and user messages from prompt sections
          const userParts: string[] = [];
          for (const section of prompt) {
            const contentStr = getContentAsString(section.content);
            if (section.role === 'system') {
              systemMessage = systemMessage
                ? `${systemMessage}\n\n${contentStr}`
                : contentStr;
            } else if (section.role === 'user') {
              userParts.push(contentStr);
            } else if (section.role === 'assistant') {
              // Include assistant messages in the conversation context
              userParts.push(`Previous assistant response:\n${contentStr}`);
            }
          }
          userMessage = userParts.join('\n\n');
        }

        if (!userMessage) {
          userMessage = 'Continue.';
        }

        // Use Claude Agent SDK query() to get completion
        let responseText = '';

        for await (const message of query({
          prompt: userMessage,
          options: {
            model,
            systemPrompt: systemMessage,
            // Disable SDK's built-in tools - we use our own tool system
            tools: [],
            // Don't persist sessions for simple completions
            persistSession: false,
            // Single turn - no multi-turn conversation
            maxTurns: 1,
            // Accept edits automatically (though we don't use file tools)
            permissionMode: 'acceptEdits'
          }
        })) {
          if (message.type === 'assistant') {
            // Extract text content from assistant message
            for (const block of message.message.content) {
              if (block.type === 'text') {
                responseText += block.text;
              }
            }
          } else if (message.type === 'result') {
            // Use the final result if available
            if (message.subtype === 'success' && message.result) {
              responseText = message.result;
            }
          }
        }

        if (!responseText) {
          return error('No response from Claude Agent SDK');
        }

        return success(responseText);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return error(`Claude Agent SDK error: ${message}`);
      }
    }
  };

  return {
    name: 'claude-agent-sdk',
    model,
    getLanguageModel: () => languageModel
  };
}

/**
 * Creates a built-in LLM provider based on configuration.
 * For custom providers, implement the LLMProvider interface directly.
 */
export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI provider requires apiKey');
      }
      return createOpenAIProvider(config.apiKey, config.model);
    case 'claude':
      if (!config.apiKey) {
        throw new Error('Claude provider requires apiKey');
      }
      return createClaudeProvider(config.apiKey, config.model);
    case 'claude-agent-sdk':
      // Claude Agent SDK uses Claude Code CLI which handles auth separately
      return createClaudeAgentSDKProvider(config.model);
    default:
      throw new Error(`Unknown built-in provider: ${config.provider}. For custom providers, implement LLMProvider directly.`);
  }
}

/**
 * Creates a built-in LLM provider from environment variables.
 * For custom providers, implement the LLMProvider interface directly.
 *
 * Environment variables:
 *   LLM_PROVIDER: 'openai' | 'claude' | 'claude-agent-sdk' (default: 'openai')
 *   LLM_MODEL: Model name override (optional)
 *
 * For OpenAI:
 *   OPENAI_API_KEY or OPENAI_SDK_KEY: API key
 *
 * For Claude:
 *   ANTHROPIC_API_KEY: API key
 *
 * For Claude Agent SDK:
 *   No API key needed - uses Claude Code CLI authentication
 */
export function createLLMProviderFromEnv(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || 'openai') as BuiltInLLMProviderType;
  const model = process.env.LLM_MODEL;

  // Claude Agent SDK uses Claude Code CLI which handles auth separately
  if (provider === 'claude-agent-sdk') {
    return createLLMProvider({ provider, model });
  }

  let apiKey: string | undefined;
  if (provider === 'claude') {
    apiKey = process.env.ANTHROPIC_API_KEY;
  } else {
    apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_SDK_KEY;
  }

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  return createLLMProvider({ provider, apiKey, model });
}

/**
 * Creates a custom TypeChatLanguageModel with default retry settings.
 * Use this helper when implementing custom LLM providers.
 *
 * @param completeFn - The completion function that calls your LLM
 * @param options - Optional retry configuration
 */
export function createCustomLanguageModel(
  completeFn: (prompt: string | PromptSection[]) => Promise<Result<string>>,
  options?: {
    retryMaxAttempts?: number;
    retryPauseMs?: number;
  }
): TypeChatLanguageModel {
  return {
    retryMaxAttempts: options?.retryMaxAttempts ?? 3,
    retryPauseMs: options?.retryPauseMs ?? 1000,
    complete: completeFn,
  };
}
