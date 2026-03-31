import OpenAI from "openai";

// ---------------------------------------------------------------------------
// LLMProvider abstraction
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: "stop" | "tool_calls";
}

export interface LLMProvider {
  chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// OpenAI implementation
// ---------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content ?? "",
          tool_call_id: m.tool_call_id!,
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: m.content,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return { role: m.role, content: m.content ?? "" };
    });

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter(
        (
          tc
        ): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } =>
          tc.type === "function"
      )
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

    return {
      content: choice.message.content,
      tool_calls: toolCalls,
      finish_reason:
        choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI embedding implementation
// ---------------------------------------------------------------------------

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }
}
