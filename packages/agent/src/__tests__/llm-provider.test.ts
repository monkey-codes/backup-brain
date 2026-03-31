import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../llm-provider.js";
import type { LLMMessage, ToolDefinition } from "../llm-provider.js";

// Mock the OpenAI SDK
vi.mock("openai", () => {
  const mockCreate = vi.fn();
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
    },
    __mockCreate: mockCreate,
  };
});

async function getMockCreate() {
  const mod = await import("openai");
  return (mod as unknown as { __mockCreate: ReturnType<typeof vi.fn> })
    .__mockCreate;
}

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreate = await getMockCreate();
    mockCreate.mockReset();
    provider = new OpenAIProvider("test-key", "gpt-4o");
  });

  it("formats messages correctly for a simple chat", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Hello!", tool_calls: null },
          finish_reason: "stop",
        },
      ],
    });

    const messages: LLMMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];

    const result = await provider.chat(messages, []);

    expect(result.content).toBe("Hello!");
    expect(result.tool_calls).toEqual([]);
    expect(result.finish_reason).toBe("stop");

    expect(mockCreate).toHaveBeenCalledWith({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      tools: undefined,
    });
  });

  it("serializes tool definitions correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Done", tool_calls: null },
          finish_reason: "stop",
        },
      ],
    });

    const tools: ToolDefinition[] = [
      {
        name: "capture_thought",
        description: "Create a thought",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string" },
          },
          required: ["content"],
        },
      },
    ];

    await provider.chat([{ role: "user", content: "test" }], tools);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: "function",
            function: {
              name: "capture_thought",
              description: "Create a thought",
              parameters: tools[0].parameters,
            },
          },
        ],
      })
    );
  });

  it("parses tool call responses", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "capture_thought",
                  arguments: '{"content":"test thought"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const result = await provider.chat([{ role: "user", content: "test" }], []);

    expect(result.content).toBeNull();
    expect(result.finish_reason).toBe("tool_calls");
    expect(result.tool_calls).toEqual([
      {
        id: "call_123",
        name: "capture_thought",
        arguments: '{"content":"test thought"}',
      },
    ]);
  });

  it("formats tool result messages correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Got it", tool_calls: null },
          finish_reason: "stop",
        },
      ],
    });

    const messages: LLMMessage[] = [
      { role: "user", content: "test" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: '{"content":"x"}',
          },
        ],
      },
      {
        role: "tool",
        content: '{"thought_id":"abc"}',
        tool_call_id: "call_1",
      },
    ];

    await provider.chat(messages, []);

    const calledMessages = mockCreate.mock.calls[0][0].messages;

    expect(calledMessages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "capture_thought", arguments: '{"content":"x"}' },
        },
      ],
    });

    expect(calledMessages[2]).toEqual({
      role: "tool",
      content: '{"thought_id":"abc"}',
      tool_call_id: "call_1",
    });
  });

  it("handles API errors by propagating them", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(
      provider.chat([{ role: "user", content: "test" }], [])
    ).rejects.toThrow("API rate limit exceeded");
  });
});
