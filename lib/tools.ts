import type Anthropic from "@anthropic-ai/sdk";

/** Max characters of fetched page text to return, to avoid blowing the context window. */
const MAX_CHARS = 50_000;

/**
 * Custom `fetch_url` tool, in Anthropic tool format.
 * Lets the model fetch a web page and read its (markdown-ified) text content.
 */
export const fetchUrlTool: Anthropic.Tool = {
  name: "fetch_url",
  description:
    "Fetch the contents of a web page by URL and return its text content as " +
    "clean, readable markdown. Use this when you have a specific URL and need " +
    "to read what is on that page (articles, docs, etc.). The returned text may " +
    "be truncated for very long pages.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The absolute URL of the page to fetch, e.g. " +
          "'https://example.com/article'. Include the scheme (http/https).",
      },
    },
    required: ["url"],
  },
};

/** Anthropic's built-in server-side web search tool. */
export const webSearchTool: Anthropic.Messages.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

/** The full set of tools passed to the Anthropic Messages API. */
export const tools: Anthropic.Messages.ToolUnion[] = [fetchUrlTool, webSearchTool];

/**
 * Execute the `fetch_url` tool: fetch a URL via the Jina Reader proxy
 * (https://r.jina.ai/{url}), which returns readable markdown.
 *
 * Always resolves to a string (never throws): on failure it returns a short
 * human-readable error message so it can be fed straight back to the model as
 * the tool result. Output is truncated to ~50k chars.
 */
export async function executeFetchUrl(url: string): Promise<string> {
  if (!url || typeof url !== "string") {
    return "Error: a non-empty 'url' string is required.";
  }

  const target = `https://r.jina.ai/${url}`;

  try {
    const res = await fetch(target, {
      headers: { Accept: "text/plain" },
    });

    if (!res.ok) {
      return `Error fetching ${url}: ${res.status} ${res.statusText}`;
    }

    const text = await res.text();

    if (text.length > MAX_CHARS) {
      return (
        text.slice(0, MAX_CHARS) +
        `\n\n[...truncated, ${text.length - MAX_CHARS} more characters omitted]`
      );
    }

    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error fetching ${url}: ${message}`;
  }
}
