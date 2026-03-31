import { Hono } from "hono";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z, ZodObject, ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

const supabase: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface McpTool<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: ZodObject<S>;
  handler: (args: z.infer<ZodObject<S>>) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
}

// deno-lint-ignore no-explicit-any
const tools: McpTool<any>[] = [];

function tool<S extends ZodRawShape>(
  name: string,
  description: string,
  schema: ZodObject<S>,
  handler: McpTool<S>["handler"]
) {
  tools.push({ name, description, schema, handler });
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function err(message: string) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message }) },
    ],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// 1. capture_thought — atomically create thought + decisions
tool(
  "capture_thought",
  "Create a thought with its decisions atomically. Returns the thought ID and decision IDs.",
  z.object({
    content: z.string().describe("The synthesized thought content"),
    session_id: z
      .string()
      .uuid()
      .describe("Chat session ID that produced this thought"),
    created_by: z.string().uuid().describe("User ID who created the thought"),
    embedding: z
      .array(z.number())
      .length(1536)
      .describe("Pre-computed embedding vector (1536 dimensions)"),
    decisions: z
      .array(
        z.object({
          decision_type: z.enum([
            "classification",
            "entity",
            "reminder",
            "tag",
          ]),
          value: z
            .record(z.unknown())
            .describe("Decision value (shape depends on decision_type)"),
          confidence: z.number().min(0).max(1),
          reasoning: z.string(),
        })
      )
      .describe("Decisions to attach to the thought"),
  }),
  async ({ content, session_id, created_by, embedding, decisions }) => {
    // Insert thought
    const { data: thought, error: tErr } = await supabase
      .from("thoughts")
      .insert({
        content,
        session_id,
        created_by,
        embedding: `[${embedding.join(",")}]`,
      })
      .select("id")
      .single();

    if (tErr) return err(tErr.message);

    // Insert decisions
    if (decisions.length > 0) {
      const rows = decisions.map((d) => ({
        thought_id: thought.id,
        decision_type: d.decision_type,
        value: d.value,
        confidence: d.confidence,
        reasoning: d.reasoning,
      }));

      const { data: decs, error: dErr } = await supabase
        .from("thought_decisions")
        .insert(rows)
        .select("id, decision_type, value");

      if (dErr) {
        // Rollback: delete the thought we just created
        await supabase.from("thoughts").delete().eq("id", thought.id);
        return err(dErr.message);
      }

      return ok({ thought_id: thought.id, decisions: decs });
    }

    return ok({ thought_id: thought.id, decisions: [] });
  }
);

// 2. update_thought — modify content and optionally re-embed
tool(
  "update_thought",
  "Update an existing thought's content and optionally its embedding.",
  z.object({
    thought_id: z.string().uuid(),
    content: z.string(),
    embedding: z
      .array(z.number())
      .length(1536)
      .optional()
      .describe("Updated embedding vector"),
  }),
  async ({ thought_id, content, embedding }) => {
    const update: Record<string, unknown> = {
      content,
      updated_at: new Date().toISOString(),
    };
    if (embedding) {
      update.embedding = `[${embedding.join(",")}]`;
    }

    const { data, error } = await supabase
      .from("thoughts")
      .update(update)
      .eq("id", thought_id)
      .select("id, content, updated_at")
      .single();

    if (error) return err(error.message);
    return ok(data);
  }
);

// 3. search_thoughts — semantic similarity search with pre-computed embedding
tool(
  "search_thoughts",
  "Search thoughts by semantic similarity using a pre-computed embedding vector.",
  z.object({
    embedding: z
      .array(z.number())
      .length(1536)
      .describe("Pre-computed query embedding vector"),
    match_threshold: z.number().min(0).max(1).default(0.5),
    match_count: z.number().int().min(1).max(50).default(10),
  }),
  async ({ embedding, match_threshold, match_count }) => {
    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: `[${embedding.join(",")}]`,
      match_threshold,
      match_count,
    });

    if (error) return err(error.message);
    return ok(data);
  }
);

// 4. list_thoughts — browse / filter thoughts
tool(
  "list_thoughts",
  "List thoughts, optionally filtered by session.",
  z.object({
    session_id: z.string().uuid().optional().describe("Filter by session"),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  async ({ session_id, limit, offset }) => {
    let query = supabase
      .from("thoughts")
      .select("id, content, session_id, created_by, created_at, updated_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (session_id) query = query.eq("session_id", session_id);

    const { data, error } = await query;
    if (error) return err(error.message);
    return ok(data);
  }
);

// 5. create_decision — add a decision to an existing thought
tool(
  "create_decision",
  "Add a decision to an existing thought.",
  z.object({
    thought_id: z.string().uuid(),
    decision_type: z.enum(["classification", "entity", "reminder", "tag"]),
    value: z
      .record(z.unknown())
      .describe("Decision value (shape depends on decision_type)"),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  async (args) => {
    const { data, error } = await supabase
      .from("thought_decisions")
      .insert(args)
      .select(
        "id, thought_id, decision_type, value, confidence, reasoning, review_status, created_at"
      )
      .single();

    if (error) return err(error.message);
    return ok(data);
  }
);

// 6. update_decision — accept, correct, or patch a decision's value
tool(
  "update_decision",
  "Update a decision's review status, apply a correction, or patch the value directly. Use `value` for user-initiated changes (e.g. rescheduling a reminder) — it shallow-merges into the existing value without affecting review_status. Use `corrected_value` + `review_status: corrected` for agent corrections.",
  z.object({
    decision_id: z.string().uuid(),
    review_status: z.enum(["pending", "accepted", "corrected"]).optional(),
    corrected_value: z
      .record(z.unknown())
      .optional()
      .describe("New value if correcting"),
    corrected_by: z
      .string()
      .uuid()
      .optional()
      .describe("User applying the correction"),
    value: z
      .record(z.unknown())
      .optional()
      .describe(
        "Partial JSON patch to shallow-merge into the existing value column (e.g. update due_at without losing description)"
      ),
  }),
  async ({
    decision_id,
    review_status,
    corrected_value,
    corrected_by,
    value,
  }) => {
    const update: Record<string, unknown> = {};
    if (review_status !== undefined) update.review_status = review_status;
    if (corrected_value !== undefined) update.corrected_value = corrected_value;
    if (corrected_by !== undefined) {
      update.corrected_by = corrected_by;
      update.corrected_at = new Date().toISOString();
    }

    // Shallow-merge value patch: read current value, spread patch on top
    if (value !== undefined) {
      const { data: current, error: fetchErr } = await supabase
        .from("thought_decisions")
        .select("value")
        .eq("id", decision_id)
        .single();
      if (fetchErr) return err(fetchErr.message);
      update.value = {
        ...(current.value as Record<string, unknown>),
        ...value,
      };
    }

    const { data, error } = await supabase
      .from("thought_decisions")
      .update(update)
      .eq("id", decision_id)
      .select(
        "id, thought_id, decision_type, value, confidence, reasoning, review_status, corrected_value, corrected_by, corrected_at"
      )
      .single();

    if (error) return err(error.message);
    return ok(data);
  }
);

// 7. list_decisions — query decisions with filters
tool(
  "list_decisions",
  "Query decisions with optional filters for thought, type, status, and confidence range.",
  z.object({
    thought_id: z.string().uuid().optional(),
    decision_type: z
      .enum(["classification", "entity", "reminder", "tag"])
      .optional(),
    review_status: z.enum(["pending", "accepted", "corrected"]).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    max_confidence: z.number().min(0).max(1).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async ({
    thought_id,
    decision_type,
    review_status,
    min_confidence,
    max_confidence,
    limit,
  }) => {
    let query = supabase
      .from("thought_decisions")
      .select(
        "id, thought_id, decision_type, value, confidence, reasoning, review_status, corrected_value, corrected_by, corrected_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (thought_id) query = query.eq("thought_id", thought_id);
    if (decision_type) query = query.eq("decision_type", decision_type);
    if (review_status) query = query.eq("review_status", review_status);
    if (min_confidence !== undefined)
      query = query.gte("confidence", min_confidence);
    if (max_confidence !== undefined)
      query = query.lte("confidence", max_confidence);

    const { data, error } = await query;
    if (error) return err(error.message);
    return ok(data);
  }
);

// 8. create_group — create a thought group and add members
tool(
  "create_group",
  "Create a thought group and optionally add thoughts to it.",
  z.object({
    name: z.string(),
    description: z.string(),
    thought_ids: z
      .array(z.string().uuid())
      .describe("Thought IDs to add to the group"),
  }),
  async ({ name, description, thought_ids }) => {
    const { data: group, error: gErr } = await supabase
      .from("thought_groups")
      .insert({ name, description })
      .select("id")
      .single();

    if (gErr) return err(gErr.message);

    if (thought_ids.length > 0) {
      const members = thought_ids.map((tid) => ({
        thought_id: tid,
        group_id: group.id,
      }));

      const { error: mErr } = await supabase
        .from("thought_group_members")
        .insert(members);

      if (mErr) {
        // Rollback: delete the group
        await supabase.from("thought_groups").delete().eq("id", group.id);
        return err(mErr.message);
      }
    }

    return ok({ group_id: group.id, name, description, thought_ids });
  }
);

// 9. create_notification — surface a notification to a user
tool(
  "create_notification",
  "Create a notification (reminder, suggestion, or insight) for a user.",
  z.object({
    user_id: z.string().uuid(),
    type: z.enum(["reminder", "suggestion", "insight"]),
    title: z.string(),
    body: z.string(),
    thought_id: z
      .string()
      .uuid()
      .optional()
      .describe("Related thought, if any"),
    decision_id: z
      .string()
      .uuid()
      .optional()
      .describe("Related decision, if any"),
  }),
  async (args) => {
    const { data, error } = await supabase
      .from("notifications")
      .insert(args)
      .select(
        "id, user_id, type, title, body, thought_id, decision_id, created_at"
      )
      .single();

    if (error) return err(error.message);
    return ok(data);
  }
);

// 10. set_session_title — update a chat session's title
tool(
  "set_session_title",
  "Set or update the title of a chat session.",
  z.object({
    session_id: z.string().uuid(),
    title: z.string(),
  }),
  async ({ session_id, title }) => {
    const { data, error } = await supabase
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", session_id)
      .select("id, title, updated_at")
      .single();

    if (error) return err(error.message);
    return ok(data);
  }
);

// ---------------------------------------------------------------------------
// MCP JSON-RPC protocol handler
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "backup-brain", version: "1.0.0" };

function jsonrpc(id: string | number | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(
  id: string | number | null,
  code: number,
  message: string
): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolsListPayload() {
  return tools.map((t) => {
    const raw = zodToJsonSchema(t.schema, { $refStrategy: "none" });
    // Remove the $schema wrapper — MCP wants a plain JSON Schema object
    const { $schema: _, ...inputSchema } = raw as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema };
  });
}

// deno-lint-ignore no-explicit-any
async function handleJsonRpc(body: any): Promise<Response> {
  const { method, params, id } = body;
  const isNotification = !("id" in body);

  switch (method) {
    case "initialize":
      return jsonrpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return jsonrpc(id, {});

    case "tools/list":
      return jsonrpc(id, { tools: toolsListPayload() });

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};

      const match = tools.find((t) => t.name === toolName);
      if (!match) {
        return jsonrpcError(id, -32602, `Unknown tool: ${toolName}`);
      }

      const parsed = match.schema.safeParse(toolArgs);
      if (!parsed.success) {
        return jsonrpc(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: parsed.error.format() }),
            },
          ],
          isError: true,
        });
      }

      try {
        const result = await match.handler(parsed.data);
        return jsonrpc(id, result);
      } catch (error) {
        return jsonrpc(id, {
          content: [
            { type: "text", text: JSON.stringify({ error: String(error) }) },
          ],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return new Response(null, { status: 202 });
      return jsonrpcError(id ?? null, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

app.post("/*", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonrpcError(null, -32700, "Parse error");
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(handleJsonRpc));
    const jsonBodies = await Promise.all(results.map((r) => r.json()));
    return c.json(jsonBodies);
  }

  return handleJsonRpc(body);
});

app.get("/*", (c) => {
  return c.text("Backup Brain MCP Server v1.0.0");
});

app.delete("/*", (c) => {
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

Deno.serve(app.fetch);
