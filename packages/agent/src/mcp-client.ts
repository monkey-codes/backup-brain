import type { ToolDefinition } from "./llm-provider.js";

// ---------------------------------------------------------------------------
// Thin MCP client — JSON-RPC over HTTP
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private url: string;
  private nextId = 1;

  constructor(url: string) {
    this.url = url;
  }

  private async rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: "2.0", method, params, id };

    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as JsonRpcResponse;

    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      clientInfo: { name: "backup-brain-agent", version: "1.0.0" },
      capabilities: {},
    });
    // Send initialized notification (fire-and-forget)
    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
  }

  async listTools(): Promise<ToolDefinition[]> {
    const result = (await this.rpc("tools/list")) as {
      tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
    };

    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };

    const text = result.content.map((c) => c.text).join("\n");

    if (result.isError) {
      throw new Error(`Tool ${name} failed: ${text}`);
    }

    return text;
  }
}
