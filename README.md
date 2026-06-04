# Chair Agent

Chair Agent is an AI office-chair research assistant. You describe what you're after — body type, budget, use case — and the agent does live research on the open web (searching, then reading the most relevant pages) before recommending specific chairs with reasoning. It's a small Next.js 14 app built around the Anthropic API: a streaming agent loop (Claude Opus 4.8 with adaptive thinking) drives two tools — Anthropic's built-in `web_search` and a custom `fetch_url` tool that pulls clean page text — and the UI renders the answer as markdown while showing each tool call as a live status line.

<!-- SCREENSHOT: drop a screenshot of the chat interface here -->

## Setup

Requires Node.js 18.17+ (Node 20+ recommended) and an [Anthropic API key](https://console.anthropic.com/).

```bash
# 1. Clone
git clone <your-repo-url> chair-agent
cd chair-agent

# 2. Install dependencies
npm install

# 3. Configure your API key
cp .env.local.example .env.local
# then edit .env.local and set:
#   ANTHROPIC_API_KEY=sk-ant-...

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start asking.

> The system prompt lives in `lib/system-prompt.ts` and ships as an empty placeholder. Fill it in before deploying — it's what encodes the agent's persona and the source-trust rules described below.

## Deploy (Vercel)

1. Push the repo to GitHub/GitLab/Bitbucket.
2. In [Vercel](https://vercel.com/new), import the repository. The framework preset is detected automatically (Next.js); no build settings to change.
3. Under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` with your key (for Production, Preview, and Development as needed).
4. Deploy.

The chat route (`app/api/chat/route.ts`) runs on the Node.js runtime and streams responses. It sets `maxDuration = 300` so the multi-step agent loop has room to finish; honoring a duration that high requires a Vercel plan that allows it (Hobby caps function duration lower — drop `maxDuration` or upgrade if you hit the limit).

## Design notes

### Two tools, two trust levels

The agent is given exactly two tools, and the split is deliberate:

- **`web_search`** (Anthropic's server-side tool) is for *discovery* — finding which pages are worth looking at. It runs on Anthropic's infrastructure, so the loop doesn't manage it directly; the model issues a query and gets back results, and the turn resumes automatically (`pause_turn`).
- **`fetch_url`** (a custom client-side tool) is for *reading* — pulling the full text of a specific page the model decided is worth opening. It fetches through the [Jina Reader](https://jina.ai/reader/) proxy (`https://r.jina.ai/{url}`), which returns clean, readable markdown instead of raw HTML, and truncates to ~50k characters so a single long page can't blow out the context window.

Keeping these separate mirrors how a careful human researches: search broadly, then read deeply from the few sources that actually matter — rather than answering from search snippets alone.

### Source-trust approach (encoded in the system prompt)

The recommendation quality of an agent like this is mostly a function of *which sources it believes*. The system prompt (`lib/system-prompt.ts`) is where that policy is encoded. The intended approach:

- **Prefer independent, hands-on review sites** over marketing copy. Sites that physically test chairs and publish measured specs and long-term durability notes are weighted above content that exists to sell.
- **Treat manufacturer pages as authoritative for specs, not for judgement.** Use the maker's own page to confirm dimensions, weight ratings, warranty, and materials — but not to decide whether a chair is actually good.
- **Discount affiliate-heavy "best of" listicles and undated content.** SEO roundups optimized for commissions, and pages with no clear publish/update date, are low-trust.
- **Corroborate before recommending.** A specific recommendation should be backed by reading at least one real page (via `fetch_url`), and ideally agree across more than one independent source — not asserted from the model's prior knowledge.
- **Be explicit about uncertainty and cite what it read.** When sources disagree or information is thin, the answer should say so rather than projecting false confidence.

Because the prompt ships empty, these are the rules to (re)state when you fill it in — they're the contract the rest of the system is built to support.

### Streaming UX

The route streams newline-delimited JSON (NDJSON) — one `{type, ...}` object per line (`text`, `status`, `error`, `done`). The client splits on newlines and dispatches by type, so the user sees the answer token-by-token and watches each search/fetch happen in real time as small collapsed status lines, instead of staring at a spinner during a multi-step run.
