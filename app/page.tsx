"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProductImage } from "@/components/ProductImage";
import { PRODUCTS } from "@/lib/products";

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

/**
 * Markdown renderer overrides. Buy/source links open in a new tab and pick up
 * the brand accent so recommendations are obviously clickable.
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[var(--brand)] underline decoration-indigo-300 underline-offset-2 transition-colors hover:decoration-[var(--brand)]"
    >
      {children}
    </a>
  ),
};

/**
 * Pull the purchase link out of an assistant answer. The agent formats buy links
 * as `[Buy the … at Retailer — $X](url)`, so we prefer a link whose text mentions
 * "buy"; otherwise the first link after a "where to buy" heading. Returns null
 * when the message has no buy link yet (e.g. clarifying questions, mid-stream).
 */
function extractBuyLink(text: string): { label: string; url: string } | null {
  const links = Array.from(text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g));
  if (links.length === 0) return null;

  const buy = links.find((m) => /\bbuy\b/i.test(m[1]));
  if (buy) return { label: buy[1], url: buy[2] };

  const whereIdx = text.search(/where to buy/i);
  if (whereIdx !== -1) {
    const after = links.find((m) => (m.index ?? 0) > whereIdx);
    if (after) return { label: after[1], url: after[2] };
  }
  return null;
}

/** One-tap prompts shown on the empty state. */
const SUGGESTIONS = [
  "Best ergonomic chair for tall users under $1000",
  "Mesh task chair vs. leather executive — which for back pain?",
  "Quietest office chair for a small apartment",
];

/** Herman Miller Embody close-up — the iconic ergonomic "spine" backrest. */
const ERGONOMIC_IMAGE =
  "https://images.unsplash.com/photo-1671063125680-a2ebbebfbae5?auto=format&fit=crop&w=600&q=80";

/** Gaming chairs — local asset in /public (Secretlab Titan studio shot). */
const GAMING_IMAGE = "/gaming-chair.jpg";

/** Look up a curated product photo by id, falling back to the ergonomic shot. */
const productImage = (id: string) => PRODUCTS.find((p) => p.id === id)?.image ?? ERGONOMIC_IMAGE;

/**
 * Visual "browse by" cards on the empty state. Each shows a chair photo but
 * sends a real, searchable question to the agent (the curated product names are
 * illustrative, so we ask about the category instead). `imageClass` lets a wide
 * photo bias its square-crop toward the chair.
 */
const PICKS: { title: string; query: string; image: string; imageClass?: string }[] = [
  {
    title: "Ergonomic",
    query: "Recommend the best ergonomic office chair for all-day work — is a Herman Miller worth it, new or refurbished?",
    image: ERGONOMIC_IMAGE,
  },
  {
    title: "Executive",
    query: "Recommend a premium high-back executive office chair for long workdays.",
    image: productImage("regent-executive"),
  },
  {
    title: "Lounge & accent",
    query: "What's a comfortable lounge chair for a home-office reading corner?",
    image: productImage("aria-swivel-lounge"),
  },
  {
    title: "Gaming chairs",
    query: "What's the best gaming chair for long sessions with strong lower-back support, under $500?",
    image: GAMING_IMAGE,
  },
];

export default function Home() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasStarted = items.length > 0;
  const last = items[items.length - 1];
  const showWorking = loading && (!last || last.kind !== "assistant");

  useEffect(() => {
    if (hasStarted) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, showWorking, hasStarted]);

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

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
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
          handleEvent({ type: "error", message: detail?.error ?? `Request failed (${res.status}).` });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              handleEvent(JSON.parse(line) as StreamEvent);
            } catch {
              /* ignore partial / malformed line */
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        handleEvent({ type: "error", message });
      } finally {
        setLoading(false);
      }
    },
    [input, items, loading, handleEvent],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <main className="flex h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
      {/* Brand bar */}
      <header className="border-b border-[var(--border)] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--brand)] text-white shadow-sm">
            <ChairGlyph className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Chair Agent</h1>
            <p className="text-[11px] text-[var(--muted)]">Your personal chair researcher</p>
          </div>
        </div>
      </header>

      {/* Scroll area: hero (empty) or transcript (active) */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          {!hasStarted ? (
            <section className="mt-8 sm:mt-14">
              <h2 className="text-center text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Find the chair you&rsquo;ll never{" "}
                <span className="bg-gradient-to-r from-[#635bff] to-[#36c5f0] bg-clip-text text-transparent">
                  want to leave.
                </span>
              </h2>
              <p className="mx-auto mt-3 max-w-md text-center text-[15px] leading-relaxed text-[var(--muted)]">
                Tell me how you work and what you need. I&rsquo;ll research real specs, prices, and
                reviews across the web and recommend the right fit.
              </p>

              {/* Suggestion chips */}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-[var(--border)] bg-white px-3.5 py-1.5 text-sm text-[var(--muted)] shadow-sm transition-pop hover:-translate-y-0.5 hover:border-indigo-200 hover:text-[var(--brand)] hover:shadow-md"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Browse-by image cards */}
              <p className="mt-10 text-center text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Or start with a style
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {PICKS.map((pick) => (
                  <button
                    key={pick.title}
                    onClick={() => void send(pick.query)}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white text-left shadow-sm transition-pop hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl"
                  >
                    <div className="relative aspect-square overflow-hidden bg-stone-100">
                      <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-105">
                        <ProductImage src={pick.image} alt={pick.title} className={pick.imageClass} />
                      </div>
                    </div>
                    <span className="px-3 py-2.5 text-sm font-medium transition-pop group-hover:text-[var(--brand)]">
                      {pick.title}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                if (item.kind === "user") {
                  return (
                    <div key={item.id} className="flex justify-end">
                      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--brand)] px-4 py-2.5 text-sm text-white shadow-sm transition-pop hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-200/60">
                        {item.text}
                      </div>
                    </div>
                  );
                }
                if (item.kind === "status") {
                  return (
                    <div key={item.id} className="flex justify-start">
                      <div className="max-w-[90%] cursor-default truncate rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs text-[var(--muted)] shadow-sm transition-pop hover:-translate-y-0.5 hover:border-indigo-200 hover:text-[var(--brand)] hover:shadow-md">
                        {statusLabel(item)}
                      </div>
                    </div>
                  );
                }
                if (item.kind === "error") {
                  return (
                    <div key={item.id} className="flex justify-start">
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm transition-pop hover:-translate-y-0.5 hover:border-red-300 hover:shadow-md">
                        {item.message}
                      </div>
                    </div>
                  );
                }
                const buy = extractBuyLink(item.text);
                return (
                  <div key={item.id} className="flex flex-col items-start gap-2">
                    <div className="prose prose-sm prose-stone max-w-none rounded-2xl rounded-bl-sm border border-[var(--border)] bg-white px-4 py-3 shadow-sm transition-pop hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md prose-pre:bg-stone-100 prose-pre:text-stone-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                        {item.text}
                      </ReactMarkdown>
                    </div>
                    {buy && <ShareBuyLink url={buy.url} label={buy.label} />}
                  </div>
                );
              })}

              {showWorking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)] shadow-sm">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--brand)] [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--brand)] [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--brand)]" />
                    <span className="ml-1">Researching…</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--border)] bg-white">
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
              className="max-h-40 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5 text-sm outline-none transition-pop placeholder:text-stone-400 focus:border-[var(--brand)] focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,91,255,0.12)]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-pop hover:-translate-y-0.5 hover:bg-[var(--brand-dark)] hover:shadow-lg hover:shadow-indigo-200/60 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-[var(--brand)] disabled:hover:shadow-sm"
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

/**
 * Share button shown under a recommendation. Uses the native share sheet when
 * available (mobile / supported browsers), otherwise copies the buy link to the
 * clipboard with brief "Copied!" feedback.
 */
function ShareBuyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const data: ShareData = { title: "Chair recommendation", text: label, url };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch {
        // user cancelled or share failed — fall through to clipboard copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (e.g. insecure context) — nothing else to do
    }
  };

  return (
    <button
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3.5 py-1.5 text-xs font-medium text-[var(--brand)] shadow-sm transition-pop hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md active:translate-y-0"
    >
      <ShareGlyph className="h-3.5 w-3.5" />
      {copied ? "Link copied!" : "Share this chair"}
    </button>
  );
}

function ShareGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" strokeLinecap="round" />
    </svg>
  );
}

function ChairGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path d="M7 4v8m10-8v8M6 12h12M8 12l-1 6m9-6l1 6M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
