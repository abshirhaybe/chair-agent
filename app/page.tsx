"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** What the server streams back, one JSON object per NDJSON line. */
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; tool: "web_search" | "fetch_url"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** A single rendered row in the transcript. */
type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "status"; tool: "web_search" | "fetch_url"; message: string }
  | { id: string; kind: "error"; message: string };

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Turn a raw server status message into a compact, human label. */
function statusLabel(item: Extract<ChatItem, { kind: "status" }>): string {
  if (item.tool === "web_search") {
    const query = item.message.match(/"([^"]*)"/)?.[1] ?? item.message;
    return `🔍 Searching: ${query}`;
  }
  const url = item.message
    .replace(/^Fetching\s+/i, "")
    .replace(/\.\.\.$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return `📄 Reading ${url}`;
}

export default function Home() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // ID of the assistant bubble currently being streamed into. Reset to null
  // whenever a tool-call status arrives, so text after it starts a fresh bubble.
  const bottomRef = useRef<HTMLDivElement>(null);

  // Show a "working" indicator while the agent runs but isn't actively typing
  // (i.e. before the first token, or between tool calls and the next turn).
  const last = items[items.length - 1];
  const showWorking = loading && (!last || last.kind !== "assistant");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, showWorking]);

  const appendText = useCallback((delta: string) => {
  setItems((prev) => {
    const last = prev[prev.length - 1];
    if (last && last.kind === "assistant") {
      return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
    }
    return [...prev, { id: newId(), kind: "assistant", text: delta }];
  });
}, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      console.log("handleEvent:", event);
      switch (event.type) {
        case "text":
          appendText(event.text);
          break;
        case "status":
          setItems((prev) => [
            ...prev,
            { id: newId(), kind: "status", tool: event.tool, message: event.message },
          ]);
          break;
        case "error":
          setItems((prev) => [...prev, { id: newId(), kind: "error", message: event.message }]);
          break;
        case "done":
          break;
      }
    },
    [appendText],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const history = [...items, { id: newId(), kind: "user" as const, text }];
    setItems(history);
    setInput("");
    setLoading(true);

    const messages = history
      .filter(
        (it): it is Extract<ChatItem, { kind: "user" | "assistant" }> =>
          (it.kind === "user" || it.kind === "assistant") && it.text.trim().length > 0,
      )
      .map((it) => ({ role: it.kind, content: it.text }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        handleEvent({
          type: "error",
          message: detail?.error ?? `Request failed (${res.status}).`,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        console.log("buffer after chunk:", JSON.stringify(buffer));
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as StreamEvent;
            handleEvent(parsed);
          } catch (parseErr) {
            console.error("Failed to parse line:", line, parseErr);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handleEvent({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }, [input, items, loading, handleEvent]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <main className="flex h-dvh flex-col bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-base font-semibold tracking-tight">Chair Agent</h1>
          <p className="text-xs text-stone-500">Office-chair research assistant</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          {items.length === 0 && !loading && (
            <div className="mt-24 text-center text-sm text-stone-400">
              Ask me to find the right office chair — e.g.{" "}
              <span className="text-stone-600">
                &ldquo;best ergonomic chair for tall users under $1000&rdquo;
              </span>
            </div>
          )}

          {items.map((item) => {
            if (item.kind === "user") {
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-stone-900 px-4 py-2 text-sm text-white">
                    {item.text}
                  </div>
                </div>
              );
            }

            if (item.kind === "status") {
              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[90%] truncate rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">
                    {statusLabel(item)}
                  </div>
                </div>
              );
            }

            if (item.kind === "error") {
              return (
                <div key={item.id} className="flex justify-start">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {item.message}
                  </div>
                </div>
              );
            }

            // assistant
            return (
              <div key={item.id} className="flex justify-start">
                <div className="prose prose-sm prose-stone max-w-none rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-3 prose-pre:bg-stone-100 prose-pre:text-stone-800">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </div>
              </div>
            );
          })}

          {showWorking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-2 text-xs text-stone-500">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                <span className="ml-1">Working…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask about office chairs…"
              className="max-h-40 flex-1 resize-none rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </form>
          <p className="mt-1.5 text-center text-[11px] text-stone-400">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </main>
  );
}