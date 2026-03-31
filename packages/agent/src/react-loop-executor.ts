import type {
  LLMProvider,
  LLMMessage,
  ToolDefinition,
  EmbeddingProvider,
} from "./llm-provider.js";
import type { ToolExecutor } from "./mcp-client.js";

const DEFAULT_MAX_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ReactLoopParams {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  toolFilter?: Set<string>;
  argInjections?: Record<
    string,
    (args: Record<string, unknown>) => Promise<void> | void
  >;
  maxRounds?: number;
}

export interface ReactLoopResult {
  content: string;
  rounds: number;
}

// ---------------------------------------------------------------------------
// Tool schema rewriting — hides infrastructure params from the LLM
// ---------------------------------------------------------------------------

function rewriteToolsForLLM(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((t) => {
    if (t.name === "capture_thought") {
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The synthesized thought content",
            },
            decisions: {
              type: "array",
              description: "Decisions to attach to the thought",
              items: {
                type: "object",
                properties: {
                  decision_type: {
                    type: "string",
                    enum: ["classification", "entity", "reminder", "tag"],
                  },
                  value: {
                    type: "object",
                    description:
                      'Decision payload. For classification: {"category": "..."}, ' +
                      'for entity: {"name": "...", "type": "..."}, ' +
                      'for reminder: {"due_at": "ISO date", "message": "..."}, ' +
                      'for tag: {"tag": "..."}',
                  },
                  confidence: { type: "number", description: "0-1" },
                  reasoning: { type: "string" },
                },
                required: ["decision_type", "value", "confidence", "reasoning"],
              },
            },
          },
          required: ["content", "decisions"],
        },
      };
    }
    if (t.name === "search_thoughts") {
      return {
        name: t.name,
        description:
          "Search thoughts by semantic similarity. Provide a natural-language query describing what to find.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language search query",
            },
            match_threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1, default 0.5)",
            },
            match_count: {
              type: "number",
              description: "Maximum results to return (1-50, default 10)",
            },
            include_decisions: {
              type: "boolean",
              description:
                "When true, fetch and nest decisions for each matched thought (default false)",
            },
          },
          required: ["query"],
        },
      };
    }
    if (t.name === "set_session_title") {
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short, descriptive title for the chat session",
            },
          },
          required: ["title"],
        },
      };
    }
    return t;
  });
}

// ---------------------------------------------------------------------------
// ReactLoopExecutor
// ---------------------------------------------------------------------------

export class ReactLoopExecutor {
  constructor(
    private llm: LLMProvider,
    private embedding: EmbeddingProvider,
    private toolExecutor: ToolExecutor
  ) {}

  async run(params: ReactLoopParams): Promise<ReactLoopResult> {
    const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;

    // Apply tool filter if provided
    let tools = params.tools;
    if (params.toolFilter) {
      tools = tools.filter((t) => params.toolFilter!.has(t.name));
    }

    // Rewrite tool schemas for LLM consumption
    const llmTools = rewriteToolsForLLM(tools);

    // Build initial message list
    const messages: LLMMessage[] = [
      { role: "system", content: params.systemPrompt },
      ...params.messages,
    ];

    for (let round = 0; round < maxRounds; round++) {
      const response = await this.llm.chat(messages, llmTools);

      if (
        response.finish_reason === "stop" ||
        response.tool_calls.length === 0
      ) {
        return { content: response.content ?? "", rounds: round + 1 };
      }

      // Record the assistant's tool-call message
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const tc of response.tool_calls) {
        let result: string;
        try {
          const args = JSON.parse(tc.arguments) as Record<string, unknown>;

          // Built-in embedding injection for capture_thought
          if (tc.name === "capture_thought" && args.content) {
            args.embedding = await this.embedding.embed(args.content as string);
          }

          // Built-in embedding injection for search_thoughts (query → vector)
          if (tc.name === "search_thoughts" && args.query) {
            args.embedding = await this.embedding.embed(args.query as string);
            delete args.query;
          }

          // Caller-provided arg injections (run after built-in)
          if (params.argInjections?.[tc.name]) {
            await params.argInjections[tc.name](args);
          }

          result = await this.toolExecutor.callTool(tc.name, args);
        } catch (error) {
          result = JSON.stringify({ error: String(error) });
        }

        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
    }

    return {
      content: "I'm sorry, I got stuck in a processing loop. Please try again.",
      rounds: maxRounds,
    };
  }
}
