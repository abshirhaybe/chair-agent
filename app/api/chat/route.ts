import Anthropic from "@anthropic-ai/sdk";
import { tools, executeFetchUrl } from "@/lib/tools";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

export const runtime = "nodejs";
// The agent loop can run several model turns + web fetches. Raise if your host
// allows it (Vercel: depends on plan); lower if you want a tighter ceiling.
export const maxDuration = 300;

/** Latest, most capable model. Adaptive thinking is the only thinking mode here. */
const MODEL = "claude-opus-4-8";
/** Streaming, so we can afford a generous output ceiling without HTTP timeouts. */
const MAX_TOKENS = 64_000;
/** Safety cap on the agent loop so a misbehaving turn can't run forever. */
const MAX_ITERATIONS = 15;

/** A chat message as sent by the client. */
type Message = { role: "user" | "assistant"; content: string };

/** One line of the NDJSON stream sent back to the client. */
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; tool: "web_search" | "fetch_url"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

function isValidMessages(value: unknown): value is Message[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

export async function POST(req: Request): Promise<Response> {
  // --- Parse & validate the request body -----------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!isValidMessages(messages)) {
    return Response.json(
      { error: "Body must be { messages: { role, content }[] } with role 'user' | 'assistant'." },
      { status: 400 },
    );
  }

  // Fail fast with a clear message if the key is missing, rather than a cryptic SDK error.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
  }

  const client = new Anthropic();

  // Cache the system prompt (+ tools, which render before it) once it's large
  // enough to cache. Skipped while SYSTEM_PROMPT is still the empty placeholder.
  const system: Anthropic.TextBlockParam[] | undefined = SYSTEM_PROMPT
    ? [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]
    : undefined;

  // Running conversation the agent loop appends to (assistant turns + tool results).
  const conversation: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Controller already closed (e.g. client disconnected) — stop emitting.
          closed = true;
        }
      };

      try {
        await runAgent(client, conversation, system, send, req.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: `Agent error: ${message}` });
      } finally {
        send({ type: "done" });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * The agent loop. Streams each model turn's text and tool-call status to the
 * client, dispatches `fetch_url` calls (the only client-side tool), and lets the
 * server-side `web_search` tool resume itself via `pause_turn`.
 */
async function runAgent(
  client: Anthropic,
  conversation: Anthropic.MessageParam[],
  system: Anthropic.TextBlockParam[] | undefined,
  send: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) return;

    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        ...(system ? { system } : {}),
        messages: conversation,
        tools,
      },
      { signal },
    );

    // Accumulate streaming tool inputs by content-block index so we can emit a
    // status line ("Searching for X...", "Fetching Y...") once each block closes.
    const blocks = new Map<number, { name?: string; json: string }>();

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const cb = event.content_block;
        blocks.set(event.index, { name: "name" in cb ? cb.name : undefined, json: "" });
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          send({ type: "text", text: delta.text });
        } else if (delta.type === "input_json_delta") {
          const block = blocks.get(event.index);
          if (block) block.json += delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (block?.name === "web_search") {
          const query = String(safeParse(block.json).query ?? "");
          send({ type: "status", tool: "web_search", message: `Searching for "${query}"...` });
        } else if (block?.name === "fetch_url") {
          const url = String(safeParse(block.json).url ?? "");
          send({ type: "status", tool: "fetch_url", message: `Fetching ${url}...` });
        }
      }
    }

    const final = await stream.finalMessage();
    // Always append the full content (text + thinking + tool_use blocks) — the
    // thinking blocks are required when continuing a tool-use or paused turn.
    conversation.push({ role: "assistant", content: final.content });

    // Server-side tool (web_search) needs more turns — re-send to resume it.
    if (final.stop_reason === "pause_turn") continue;

    // Anything other than a client tool request means we're done (end_turn,
    // max_tokens, refusal, etc.). Text/refusal has already been streamed.
    if (final.stop_reason !== "tool_use") return;

    // Dispatch client-side fetch_url calls. (web_search ran server-side already.)
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type === "tool_use" && block.name === "fetch_url") {
        const url = (block.input as { url?: string })?.url ?? "";
        const result = await executeFetchUrl(url); // never throws — returns error text on failure
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    // tool_use with no fetch_url blocks shouldn't happen (only client tool), but
    // guard against an infinite loop just in case.
    if (toolResults.length === 0) return;

    conversation.push({ role: "user", content: toolResults });
  }

  send({
    type: "error",
    message: `Reached the maximum of ${MAX_ITERATIONS} reasoning steps without a final answer.`,
  });
}
