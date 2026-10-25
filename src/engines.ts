// Engine adapters — ported from Avowd's production measurement worker (avowd.ai), so this tool asks
// each engine exactly the way Avowd's monthly measurement does: web search / grounding on, sources
// returned. Keys are read from the environment; an engine without a key is skipped.
//
// MIT licensed. Original: Avowd measure-worker/src/engines.ts.
// AI-engine clients for visibility measurement.
//
// Each engine answers a target prompt WITH web search / grounding enabled, and
// returns the answer text plus any cited source URLs. An engine is only "active"
// when its API key is present in the environment — add the key + redeploy and it
// turns itself on (no code change). Today: OpenAI. Tomorrow: add the other keys.


export interface EngineAnswer {
  text: string;
  links: string[];
  /** Tokens the provider says this call consumed. Measured, not estimated — a run's cost is
   *  reported from these, so an engine that does not report usage contributes 0 rather than a
   *  guess, and shows up as such.
   *
   *  `searches` is the count of web searches the provider ran and bills SEPARATELY from tokens
   *  (Anthropic: $10/1,000). Reading it was the missing piece behind a month where the invoice
   *  carried $10.94 of search charges our own report did not contain a line for. */
  usage?: { in: number; out: number; searches?: number;
    /** Pages the provider reports having read for this answer (xAI `num_sources_used`). Not billed
     *  directly, but it is the number that explains Grok's input bill: every page read is context. */
    sources?: number;
    /** Model id the provider reports having served (Gemini `modelVersion`, others `model`). */
    model?: string;
    /** Input tokens served from the provider's prompt cache — billed at a fraction of the input rate. */
    cached?: number;
    /** Set when the call landed in the provider's peak-price window (DeepSeek, offpeak.ts) —
     *  cost.ts books these tokens at double. Stamped here, at call time, so every caller agrees. */
    peak?: boolean;
    /** Set when the call went through the provider's Batch API (grok-batch.ts) — cost.ts books its
     *  tokens at the batch discount. Tool fees (searches) are not discounted and stay at list. */
    batch?: boolean };
}

/* ── Scheduled instrument change ──────────────────────────────────────────────
 * Swapping a model changes the instrument, so it is never done mid-series: the new models are
 * written into config AHEAD of time as <NAME>_NEXT, and take effect by themselves at
 * MODEL_SWITCH_AT (a month boundary). Nobody has to be awake at 13:00 UTC on the 1st for the
 * change to land cleanly on a new month, and a manual run before then still measures on the old
 * models. `next` forces the post-switch config — used only by the self-test, so the new models
 * can be probed BEFORE they carry any client's numbers.
 *
 * 2026-10-01 switch: OpenAI gpt-5.4-mini → gpt-6-luna ($0.25/$2.00 → $0.10/$0.50),
 * Gemini gemini-3.5-flash → gemini-3.8-flash ($1.50/$9.00 → $0.75/$3.75 intro, $1.50/$7.50 from
 * 2027-01-01), and Muse (Meta) joins as an eleventh engine. Grok, Kimi, Claude stay: their
 * newer models cost 2–5× more, and Grok's history says a price change is not a free upgrade. */
export function instrumentSwitched(next = false): boolean {
  if (next) return true;
  const at = process.env.MODEL_SWITCH_AT;
  return !!at && Date.now() >= Date.parse(at);
}
export function modelFor(name: string, fallback: string, next = false): string {
  const upcoming = process.env[`${name}_NEXT`];
  // A per-engine switch date (e.g. CLAUDE_MODEL_SWITCH_AT) overrides the global MODEL_SWITCH_AT, so one
  // engine can change on the next month boundary without touching the others.
  const own = process.env[`${name}_SWITCH_AT`];
  const switched = next || (own ? Date.now() >= Date.parse(own) : instrumentSwitched(false));
  if (upcoming && switched) return upcoming;
  return process.env[name] || fallback;
}

/** Every provider here is OpenAI-shaped except Anthropic and Google; read whichever it is. */
function readUsage(d: unknown): { in: number; out: number; searches?: number; sources?: number; model?: string; cached?: number } | undefined {
  const u = get(d, "usage") ?? get(d, "usageMetadata");
  if (!u) return undefined;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  // Gemini splits what it bills across FOUR counters, and this function used to read two of them.
  // `thoughtsTokenCount` (thinking, billed as OUTPUT) and `toolUsePromptTokenCount` (the search
  // results fed back in, billed as INPUT) were invisible — so on 2026-09-16 our books said Gemini
  // had cost $3.79 lifetime while AI Studio showed $42.68 for the last 28 days alone. Same disease
  // Grok had: the expensive tokens are the ones the provider adds, not the ones we send.
  const i = n(get(u, "prompt_tokens")) || n(get(u, "input_tokens"))
    || (n(get(u, "promptTokenCount")) + n(get(u, "toolUsePromptTokenCount")));
  const o = n(get(u, "completion_tokens")) || n(get(u, "output_tokens"))
    || (n(get(u, "candidatesTokenCount")) + n(get(u, "thoughtsTokenCount")));
  // Anthropic reports searches at usage.server_tool_use.web_search_requests; other providers
  // either bury the fee in tokens or do not report it, in which case this stays undefined and
  // the cost model flags the engine rather than pricing its searches at zero.
  const st = get(u, "server_tool_use");
  // xAI reports them at usage.server_side_tool_usage_details.{web_search_calls,x_search_calls}
  // and bills each at $5/1k — a fee that was invisible in every Grok cost line until 2026-09-06,
  // because this function only knew Anthropic's field name.
  const xt = get(u, "server_side_tool_usage_details");
  const searches = n(get(st, "web_search_requests")) || (n(get(xt, "web_search_calls")) + n(get(xt, "x_search_calls")));
  const sources = n(get(u, "num_sources_used"));
  // xAI and OpenAI report cache hits inside input_tokens_details; xAI bills them at $0.20 instead
  // of $1.25, and pricing them at full rate had Grok's books 12% OVER the console (2026-09-17).
  const cached = n(get(get(u, "input_tokens_details"), "cached_tokens")) || n(get(get(u, "prompt_tokens_details"), "cached_tokens"));
  if (!i && !o && !searches) return undefined;
  // The model the PROVIDER says it served — not the one we asked for. Aliases get re-pointed
  // without notice (qwen-plus → a newer snapshot on 2026-10-10), and a changed instrument should
  // show up in the cost email the day it happens rather than in a trend line two months later.
  const served = get(d, "modelVersion") ?? get(d, "model");
  const model = typeof served === "string" && served ? served.slice(0, 80) : undefined;
  return { in: i, out: o, ...(searches ? { searches } : {}), ...(sources ? { sources } : {}), ...(model ? { model } : {}), ...(cached ? { cached } : {}) };
}
export interface Engine {
  id: string;
  label: string;
  region: "west" | "cn"; // which market this engine serves
  // Whether this engine's API returns the sources behind its answer. The CN engines answer from
  // the model with no retrieval surfaced, so links[] is ALWAYS empty for them — that is a limit
  // of the API, not a finding about the brand. Scoring must exclude these answers from the
  // citation denominator, or every bilingual client looks half as cited as an English-only one.
  citesSources: boolean;
  query: (prompt: string) => Promise<EngineAnswer>;
}

// ── tiny safe-access helpers (avoid `any`, tolerate shape drift) ──────────
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function get(o: unknown, k: string): unknown {
  return o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
}

// Every engine calls the live web — a single hung request must never be able to eat the
// whole serverless time budget (Vercel Hobby hard-caps functions at 60s). Cap each fetch.
// Default per-call ceiling. Engines run fully concurrently (one wave), so wall time is the
// single slowest call, not the sum — but that call must ABORT with room to spare, because the
// abort is what lets the request return JSON instead of being killed by the platform.
//
// This was 54s against Vercel's 60s cap, which cannot work: a call that actually reaches its
// timeout leaves ~6s to score and serialize, and any start-up delay pushes the whole batch past
// the cap. The symptom is brutal to diagnose — the platform returns its own HTML error page, so
// the caller sees a JSON parse error and every cell in that batch is lost, not just the slow one.
// 35s is still generous for Grok's Agent Tools API and OpenAI/Claude web_search, and guarantees
// the function finishes. Raise via ENGINE_TIMEOUT_MS only alongside a higher function cap.
const DEFAULT_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS) || 35000;
// Per-engine patience, for engines whose SUCCESSFUL calls routinely outlive the global timeout.
// The 2026-08 re-run: every engine hit 44/44 except deepseek (29/44, 43/44) and kimi (34/44),
// all "timed out after 120000ms" — deepseek writes ~4.5k-token answers with no search to shorten
// them, and one kimi search turn can run long. These are real answers arriving slowly, not hangs;
// retrying them just re-times-out. ⚠️ Values must stay under CELL_MS (210s, measure.ts) or the
// backstop kills the cell before the fetch can finish.
// Engines that are slow because they are genuinely working, not because they hung.
//
// Grok belongs here for a reason that costs real money: it is the only agentic engine of the nine.
// Its web_search does not just retrieve snippets — it browses pages, and every tool round re-sends
// the accumulated context as input (121k input tokens per call on one client, 14× OpenAI on the
// same questions). That does not fit in 35s, so it timed out, got retried up to CELL_TRIES times,
// and each attempt kept running and billing on xAI's side after we aborted our end. Paying three
// times for one answer, recording one, is how the xAI invoices ran to roughly double what the cost
// emails reported. Waiting is cheaper than retrying.
const SLOW_TIMEOUT_MS: Record<string, number> = { deepseek: 180000, kimi: 170000, grok: 150000, doubao: 150000 };
async function fetchWithTimeout(url: string, opts: RequestInit, ms = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error(`timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ── OpenAI / ChatGPT — Responses API + web_search (VERIFIED) ──────────────
 * POST /v1/responses  { model, tools:[{type:"web_search"}], input }
 * answer  → output[].type==="message" → content[].text
 * sources → content[].annotations[].url   (type "url_citation")           */
async function openai(prompt: string, model = modelFor("OPENAI_MODEL", "gpt-5.5")): Promise<EngineAnswer> {
  const key = process.env.OPENAI_API_KEY as string;
  const r = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    // max_output_tokens counts the model's hidden reasoning too. At 700, gpt-6-luna often spent the
    // whole budget thinking after reading ~30k tokens of search results and returned NO text
    // (2026-10 run: 14 of 38 detail answers empty, 12 of them at exactly
    // 700). Empty answers drop out of the denominator, so they hide the hardest questions rather
    // than score as misses. 6000 leaves room to reason and still write the list.
    body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt, max_output_tokens: 6000 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  let text = "";
  const links: string[] = [];
  for (const item of arr(get(d, "output"))) {
    if (get(item, "type") !== "message") continue;
    for (const c of arr(get(item, "content"))) {
      const t = str(get(c, "text"));
      if (t) text += (text ? "\n" : "") + t;
      for (const a of arr(get(c, "annotations"))) {
        const url = str(get(a, "url"));
        if (url) links.push(url);
      }
    }
  }
  if (!text) text = str(get(d, "output_text"));
  // OpenAI bills the web_search tool per call ($10/1k on the gpt-5 family) and does NOT put the
  // count in `usage` — it is the number of web_search_call items in the output. 173 of them on
  // 2026-09-16 were the difference between our $1.18 and the console's $2.87.
  const searches = arr(get(d, "output")).filter((it) => get(it, "type") === "web_search_call").length;
  const usage = readUsage(d);
  return { text, links, ...(usage ? { usage: { ...usage, ...(searches ? { searches } : {}) } } : {}) };
}

/* ── Muse (Meta) — Responses API + web_search ─────────────────────────────
 * POST https://api.meta.ai/v1/responses  { model, input, tools:[{type:"web_search"}] }
 * Same response shape as OpenAI's Responses API (dev.meta.ai/docs/search-grounding, 2026-09-23):
 * answer  → output[].type==="message" → content[].text
 * sources → content[].annotations[].url   (type "url_citation")
 * Billing: $1.25 in / $4.25 out per 1M, web search $2.50 per 1k (standard tier — prompts are NOT
 * used for training; the "-contributor" ids are ~12× cheaper but train on what we send).
 * Muse Spark always reasons ("none" is a 400); reasoning counts toward max_output_tokens, so the
 * budget is far above OpenAI's 700 or long answers would come back empty. */
async function muse(prompt: string): Promise<EngineAnswer> {
  const key = process.env.META_API_KEY as string;
  const model = process.env.MUSE_MODEL || "muse-spark-1.3";
  const r = await fetchWithTimeout(ENGINE_ENDPOINTS.muse, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }], reasoning: { effort: "low" }, max_output_tokens: 4000 }),
  });
  if (!r.ok) throw new Error(`Muse ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  let text = "";
  const links: string[] = [];
  for (const item of arr(get(d, "output"))) {
    if (get(item, "type") !== "message") continue;
    for (const c of arr(get(item, "content"))) {
      const t = str(get(c, "text"));
      if (t) text += (text ? "\n" : "") + t;
      for (const a of arr(get(c, "annotations"))) {
        const url = str(get(a, "url"));
        if (url) links.push(url);
      }
    }
  }
  if (!text) text = str(get(d, "output_text"));
  const searches = arr(get(d, "output")).filter((it) => get(it, "type") === "web_search_call").length;
  const usage = readUsage(d);
  return { text, links, ...(usage ? { usage: { ...usage, ...(searches ? { searches } : {}) } } : {}) };
}

/* ── Perplexity — chat completions (OpenAI-compatible) (VERIFY w/ key) ─────
 * answer  → choices[0].message.content
 * sources → citations[]  and  search_results[].url                        */
async function perplexity(prompt: string): Promise<EngineAnswer> {
  const key = process.env.PERPLEXITY_API_KEY as string;
  const model = process.env.PERPLEXITY_MODEL || "sonar-pro";
  // 2026 docs use /v1/sonar; older integrations used /chat/completions. Overridable
  // via PERPLEXITY_URL so we can flip without a code change if a call 404s.
  const url = process.env.PERPLEXITY_URL || "https://api.perplexity.ai/v1/sonar";
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  const msg = get(arr(get(d, "choices"))[0], "message");
  const text = str(get(msg, "content"));
  const links: string[] = [];
  for (const u of arr(get(d, "citations"))) {
    const s = str(u);
    if (s) links.push(s);
  }
  for (const sr of arr(get(d, "search_results"))) {
    const u = str(get(sr, "url"));
    if (u) links.push(u);
  }
  // Every sonar request IS a search and is billed as one ($5 per 1k requests) on top of tokens.
  const u = readUsage(d);
  return { text, links, ...(u ? { usage: { ...u, searches: 1 } } : { usage: { in: 0, out: 0, searches: 1 } }) };
}

/* ── Claude (Anthropic) — Messages API + web_search tool (VERIFIED) ────────
 * non-beta tool; answer → content[].type==="text".text
 * sources → content[].type==="web_search_tool_result".content[].url
 *           + any text-block citations[].url                              */
async function claude(prompt: string, next = false): Promise<EngineAnswer> {
  const key = process.env.ANTHROPIC_API_KEY as string;
  // Follows the scheduled switch like OpenAI and Gemini (2026-10-01: Haiku 4.5 → Sonnet 5.5).
  const model = modelFor("CLAUDE_MODEL", "claude-haiku-4-5", next);
  const toolType = modelFor("CLAUDE_WEBSEARCH_TYPE", "web_search_20260209", next);
  // Sonnet 5.5 runs adaptive thinking when no `thinking` field is sent, and those tokens count
  // against max_tokens and bill as output — a 1,024 cap would truncate answers. between_tools is
  // its lowest setting (no up-front thinking; "disabled" is a 400 on 5.5). Older models: omit.
  const lowThinking = /sonnet-5-5|opus-5/.test(model) ? { thinking: { type: "between_tools" } } : {};
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      ...lowThinking,
      messages: [{ role: "user", content: prompt }],
      // At most 3 searches per answer. Searches past the cap are not charged and citations from
      // the ones that ran are kept (platform.claude.com web-search-tool docs, 2026-09-30); it trims
      // the long tail without changing a typical 1–2-search answer.
      tools: [{ type: toolType, name: "web_search", max_uses: 3 }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  let text = "";
  const links: string[] = [];
  for (const block of arr(get(d, "content"))) {
    const type = get(block, "type");
    if (type === "text") {
      const t = str(get(block, "text"));
      if (t) text += (text ? "\n" : "") + t;
      for (const c of arr(get(block, "citations"))) {
        const u = str(get(c, "url"));
        if (u) links.push(u);
      }
    } else if (type === "web_search_tool_result") {
      for (const res of arr(get(block, "content"))) {
        const u = str(get(res, "url"));
        if (u) links.push(u);
      }
    }
  }
  return { text, links, usage: readUsage(d) };
}

/* ── Gemini — generateContent + google_search grounding (VERIFY w/ key) ────
 * answer  → candidates[0].content.parts[].text
 * sources → candidates[0].groundingMetadata.groundingChunks[].web.uri     */
async function gemini(prompt: string, model = modelFor("GEMINI_MODEL", "gemini-2.5-flash")): Promise<EngineAnswer> {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) as string;
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        // Thinking is billed as output, and 3.8/3.7 Flash think at "medium" by default. "low" is
        // their floor (ai.google.dev/gemini-api/docs/thinking, 2026-09-30). 3.6 and older accept
        // "minimal" too, but "low" is valid across the 3.x line, so it is safe at a model switch.
        ...(/gemini-3\./.test(model) ? { generationConfig: { thinkingConfig: { thinkingLevel: "low" } } } : {}),
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  const cand = arr(get(d, "candidates"))[0];
  let text = "";
  for (const p of arr(get(get(cand, "content"), "parts"))) {
    const t = str(get(p, "text"));
    if (t) text += (text ? "\n" : "") + t;
  }
  const chunks = arr(get(get(cand, "groundingMetadata"), "groundingChunks"))
    .map((ch) => ({ uri: str(get(get(ch, "web"), "uri")), title: str(get(get(ch, "web"), "title")) }))
    .filter((c) => c.uri);
  // Every Gemini source URI is a vertexaisearch.cloud.google.com redirect, not the publisher.
  // Counted as-is, that made Gemini's link-to-your-site rate 0% for every client in every run
  // (13 of 13 on 2026-09-16 — the brand's own site was invisible behind the redirect) and put one
  // "vertexaisearch" row per answer into every citation table, while the sites Gemini actually
  // read were never counted at all. Resolved from 2026-10-01 with the rest of the instrument
  // change, so no month mixes the two readings.
  const links = instrumentSwitched()
    ? (await Promise.all(chunks.map((c) => geminiSource(c.uri, c.title)))).filter((u): u is string => !!u)
    : chunks.map((c) => c.uri);
  // Every Google Search query the answer ran is billed on its own (ai.google.dev pricing: "you
  // will be charged for each individual search query performed"). groundingMetadata lists them.
  // Uncounted until 2026-10-01, which is most of why our books showed ~$7.88 a run while the
  // Cloud billing report showed 1,612 search queries = CA$31.29 in September on top of tokens.
  const searches = arr(get(get(cand, "groundingMetadata"), "webSearchQueries")).length;
  const u = readUsage(d);
  return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
}

const GEMINI_REDIRECT = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;

/** The real destination behind a Gemini grounding redirect. The API puts the source's domain in
 *  `title` ("canada.ca"), which is enough for everything we count — host, brand link — and costs
 *  nothing. Only when the title is not a domain do we ask the redirect itself, without following
 *  it. A source we cannot resolve is dropped rather than counted as Google. */
async function geminiSource(uri: string, title: string): Promise<string | null> {
  let h = "";
  try { h = new URL(uri).hostname; } catch { return null; }
  if (!GEMINI_REDIRECT.test(h)) return uri;
  const t = title.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(t)) return `https://${t}/`;
  try {
    const r = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(4000) });
    const loc = r.headers.get("location");
    if (loc && !GEMINI_REDIRECT.test(new URL(loc, uri).hostname)) return new URL(loc, uri).toString();
  } catch { /* unresolvable — drop it */ }
  return null;
}

/* ── Grok (xAI) — Agent Tools API: Responses endpoint + server-side web_search (VERIFY w/ key) ──
 * (the old chat/completions search_parameters "Live Search" is deprecated → 410)
 * POST /v1/responses  { model, input, tools:[{type:"web_search"}] }  — OpenAI-Responses-shaped
 * answer  → output[].type==="message" → content[].text  (fallback output_text)
 * sources → content[].annotations[].url  +  any top-level citations[]        */
function grokExtra(): Record<string, unknown> {
  try { return JSON.parse(process.env.XAI_EXTRA || "{}"); } catch { return {}; }
}

/** The model Grok is asked for — one definition, shared by the real-time call and the monthly
 *  batch (grok-batch.ts), so the two call paths can never measure on different models. */
export function grokModel(): string {
  return process.env.XAI_MODEL || "grok-4.5";
}

/** The exact Responses-API body Grok is asked with. Shared by grok() below and by the monthly
 *  batch (grok-batch.ts): the batch is a cheaper way to SEND this request, not a different
 *  request — same model, tools, caps and XAI_EXTRA, byte for byte. */
export function grokRequestBody(prompt: string): Record<string, unknown> {
  return {
    model: grokModel(),
    input: prompt,
    tools: [{ type: "web_search", enable_image_search: false, enable_image_understanding: false }],
    max_output_tokens: 700,
    // XAI_EXTRA: JSON merged into the request — the input-side levers the comment below once
    // said did not exist. Verified against xAI's OpenAPI (2026-09-06): `max_turns` caps the
    // agentic search→read→search rounds (each round re-sends the pages read so far, and input
    // is ~85% of Grok's bill), `reasoning_effort` trims thinking tokens billed as output, and
    // `search_parameters.max_search_results` caps pages per search. Env-driven so /ask can
    // A/B a setting for one call before it becomes the default — a cap that changes WHICH
    // brands Grok names is a ruler change, not a saving.
    ...grokExtra(),
  };
}

async function grok(prompt: string): Promise<EngineAnswer> {
  const key = process.env.XAI_API_KEY as string;
  const model = grokModel();
  const url = process.env.XAI_URL || "https://api.x.ai/v1/responses";
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    // Images off. The measurement reads TEXT — whether the brand is named — and never looks at a
    // picture, but an image pulled into context costs thousands of tokens, and input is 95% of
    // Grok's bill (89k/call against Claude's 8k on the same questions). This is the only lever
    // that cuts waste without changing what is measured: search still runs, pages are still read,
    // the answer is still grounded. Turning search OFF would be cheaper still and would destroy
    // the engine — a model answering from memory has never heard of a Richmond bakery.
    body: JSON.stringify(grokRequestBody(prompt)),
  }, SLOW_TIMEOUT_MS.grok);
  // max_output_tokens is xAI-by-inference (their Responses API is modelled on OpenAI's, which
  // takes this field) — so it is sent OPTIMISTICALLY and retried without it on a 400. An unknown
  // field that gets rejected would otherwise take the entire engine to 0%, which is exactly how
  // an engine silently disappears from a measurement. Cheaper when it works, unchanged when it
  // doesn't, dead never.
  //
  // It is also only the smaller half of the bill: Grok's cost is ~95% INPUT (121k tokens/call of
  // browsed page text at $2/1M). Capping the essay it writes afterwards trims the rest. xAI
  // exposed no documented parameter to limit search depth when this was written; as of
  // 2026-09-06 it does (`max_turns`, `search_parameters.max_search_results` — see grokExtra),
  // and that is where the input side is tuned now.
  if (r.status === 400) {
    const body = await r.text();
    if (/max_output_tokens|unknown|unrecognized|unsupported/i.test(body)) {
      console.log("[grok] max_output_tokens rejected — retrying without it");
      const r2 = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }] }),
      }, SLOW_TIMEOUT_MS.grok);
      if (!r2.ok) throw new Error(`Grok ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
      return parseGrok(await r2.json());
    }
    throw new Error(`Grok 400: ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Grok ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return parseGrok(await r.json());
}

/** Shared by both Grok request shapes above, so a retry can never drift from the original —
 *  and by the monthly batch (grok-batch.ts), which receives the same Responses-API object. */
export function parseGrok(d: unknown): EngineAnswer {
  let text = "";
  const links: string[] = [];
  for (const item of arr(get(d, "output"))) {
    if (get(item, "type") !== "message") continue;
    for (const c of arr(get(item, "content"))) {
      const t = str(get(c, "text"));
      if (t) text += (text ? "\n" : "") + t;
      for (const a of arr(get(c, "annotations"))) {
        const uu = str(get(a, "url"));
        if (uu) links.push(uu);
      }
    }
  }
  if (!text) text = str(get(d, "output_text"));
  for (const u of arr(get(d, "citations"))) {
    const s = str(u);
    if (s) links.push(s);
  }
  return { text, links, usage: readUsage(d) };
}

/* ── Qwen (通义千问 / Alibaba 阿里百炼 DashScope) — OpenAI-compatible + enable_search ──
 * body: enable_search:true + search_options.forced_search:true. Without forced_search the model
 * decides per prompt whether to search and often answers from memory, so we were measuring the
 * offline model on some prompts and the search product on others (2026-10-01).
 * Docs (help.aliyun.com/zh/model-studio/web-search, read 2026-10-01): compatible mode accepts
 * search_options { forced_search, search_strategy, enable_source, enable_citation, citation_format },
 * but states that because of the protocol, source return and citation markers are NOT supported in
 * compatible mode — search_info.search_results (url/title/site_name) only comes back over the native
 * DashScope protocol. We still read search_info defensively in case it ever appears; until then
 * links stay empty. With forced_search every call runs exactly one search ("每轮交互计为一次"), so
 * usage.searches = 1 per successful call — that keeps the search fee visible in the cost email. */
const QWEN_SEARCH = { enable_search: true, search_options: { forced_search: true } } as const;

async function qwen(prompt: string): Promise<EngineAnswer> {
  const key = process.env.DASHSCOPE_API_KEY as string;
  const model = process.env.QWEN_MODEL || "qwen-plus";
  const url = process.env.QWEN_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
  // DashScope rejects web search in non-streaming mode, so stream and accumulate the deltas.
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...QWEN_SEARCH,
      stream: true,
      // Ask for the usage chunk. DashScope's OpenAI-compatible mode documents this field; without
      // it every Qwen call was metered as 0 tokens and the cost email said "no usage reported" —
      // which read, correctly, as "then how do you know it is free?" (2026-09-17).
      stream_options: { include_usage: true },
    }),
  });
  // Optimistic, with a fallback: if this endpoint ever rejects the field, run the old request
  // rather than take the engine to 0% over a metering nicety. The fallback keeps the search options.
  const r2 = !r.ok && r.status === 400 && /stream_options/i.test(await r.clone().text())
    ? await fetchWithTimeout(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], ...QWEN_SEARCH, stream: true }) })
    : r;
  if (!r2.ok) throw new Error(`Qwen ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
  const raw = await r2.text(); // full SSE body, then pull text out of each data: chunk
  let text = "";
  const links: string[] = [];
  let qwenUsage: { in: number; out: number } | undefined;
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const d: unknown = JSON.parse(payload);
      const c = str(get(get(arr(get(d, "choices"))[0], "delta"), "content"));
      if (c) text += c;
      // Not returned in compatible mode per the docs; read if it ever shows up.
      for (const sr of arr(get(get(d, "search_info") ?? get(get(d, "output"), "search_info"), "search_results"))) {
        const u = str(get(sr, "url"));
        if (u && !links.includes(u)) links.push(u);
      }
      // The usage object arrives on the final chunk (requested via stream_options above).
      const u = readUsage(d);
      if (u) qwenUsage = u;
    } catch {
      /* skip keepalive / non-JSON lines */
    }
  }
  return { text, links, usage: { ...(qwenUsage ?? { in: 0, out: 0 }), searches: 1 } };
}

/* ── Kimi (Moonshot) — chat completions + our own web_search tool backed by /v1/tools/search_pro ──
 * 2026-10-05: the builtin_function `$web_search` retires on 2026-10-20 (platform.kimi.ai/docs/guide/
 * use-web-search). Its replacement is a set of standalone REST search APIs that WE call. To keep the
 * measurement as close as possible to what the Kimi product does, the model still decides whether and
 * what to search: it gets an ordinary function tool `web_search(query)`, we run each query against
 * POST /v1/tools/search_pro (ranked passages, $0.003/call), and hand the results back. Bonus over the
 * old tool: the result URLs are ours to keep, so Kimi now reports sources (links) like the others. */
const KIMI_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for up-to-date information. Use it for anything about specific businesses, places, prices or recent facts.",
    parameters: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] },
  },
};

async function kimiSearch(base: string, key: string, query: string): Promise<{ content: string; urls: string[] }> {
  const r = await fetchWithTimeout(`${base}/tools/search_pro`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text_query: query.slice(0, 400), limit: 5, timeout_seconds: 30 }),
  }, 40000);
  if (!r.ok) return { content: JSON.stringify({ error: `search failed (${r.status})` }), urls: [] };
  const d: unknown = await r.json();
  const results = arr(get(d, "search_results")).slice(0, 5);
  const urls: string[] = [];
  const compact = results.map((it) => {
    const url = str(get(it, "url"));
    if (url) urls.push(url);
    const chunks = arr(get(it, "chunks")).slice(0, 2).map((c) => str(get(c, "text")).slice(0, 700));
    return { title: str(get(it, "title")), url, site: str(get(it, "site_name")), date: str(get(it, "date")),
      text: chunks.length ? chunks.join(" … ") : str(get(it, "snippet")).slice(0, 700) };
  });
  return { content: JSON.stringify({ results: compact }), urls };
}

async function kimi(prompt: string): Promise<EngineAnswer> {
  const key = process.env.MOONSHOT_API_KEY as string;
  const model = process.env.KIMI_MODEL || "kimi-k2.6";
  const url = process.env.KIMI_URL || "https://api.moonshot.ai/v1/chat/completions";
  const base = url.replace(/\/chat\/completions\/?$/, "");
  const tools = [KIMI_SEARCH_TOOL];
  const messages: unknown[] = [{ role: "user", content: prompt }];
  let text = "";
  const links: string[] = [];
  // Each chat turn can take a while and each search adds up to ~30s; the budget covers a few rounds.
  // On Workflows the only ceilings that matter are CELL_MS and the step timeout in index.ts.
  const loopDeadline = Date.now() + 200000;
  let usedIn = 0, usedOut = 0, searches = 0;
  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    // Out of turns or time: one last call WITHOUT the tool, so the model must answer from what it
    // already found instead of asking for yet another search (2026-10-05: 4 search turns, empty text).
    const last = i === MAX_TURNS - 1 || Date.now() > loopDeadline;
    // Say "answer now" on that last turn: without it k2.6 often spends the turn announcing another
    // search ("让我再搜索一下…") and that announcement would be read as its answer (2026-10-25).
    if (last) messages.push({ role: "user", content: ANSWER_NOW });
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      // No temperature field: the k2.x generation rejects anything but its default (see git history).
      body: JSON.stringify(last ? { model, messages } : { model, messages, tools }),
    }, SLOW_TIMEOUT_MS.kimi);
    if (!r.ok) throw new Error(`Kimi ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d: unknown = await r.json();
    const u = readUsage(d);
    if (u) { usedIn += u.in; usedOut += u.out; }
    const choice = arr(get(d, "choices"))[0];
    const msg = get(choice, "message");
    const content = str(get(msg, "content"));
    // Keep only the FINAL answer. Turns that end in tool_calls carry interim chatter ("Let me search
    // more…", a visible thinking trace) — counting brand names in it would inflate mentions.
    if (content) text = content;
    const calls = arr(get(msg, "tool_calls"));
    if (last || str(get(choice, "finish_reason")) !== "tool_calls" || !calls.length) break;
    messages.push(msg); // assistant turn carrying the tool_calls
    for (const tc of calls) {
      const fn = get(tc, "function");
      let query = "";
      try { query = str(get(JSON.parse(str(get(fn, "arguments")) || "{}"), "query")); } catch { /* malformed args */ }
      let out = { content: JSON.stringify({ error: "empty query" }), urls: [] as string[] };
      if (query) { out = await kimiSearch(base, key, query); searches++; }
      for (const l of out.urls) if (!links.includes(l)) links.push(l);
      messages.push({ role: "tool", tool_call_id: str(get(tc, "id")), name: str(get(fn, "name")) || "web_search", content: out.content });
    }
  }
  return { text, links, ...(usedIn + usedOut > 0 ? { usage: { in: usedIn, out: usedOut, ...(searches ? { searches } : {}) } } : {}) };
}

/* ── Tencent Yuanbao / Hunyuan (腾讯元宝 · 混元) — TokenHub chat completions + web_search ──
 * Searches the live web since 2026-10-01 through TokenHub's web_search tool (web_search_options
 * below; search_source "lite" = 轻量版 ¥7/1k, 标准版 ¥12/1k). The standalone 元宝搜索 API opened
 * 2026-10-20 (wsa.tencentcloudapi.com · SearchPro, same lite/standard/flagship tier names — by all
 * appearances the same search) needs a separate Tencent Cloud SecretId/SecretKey (TC3 signing) and
 * a 元宝搜索 console activation; it is NOT wired in, because this path already searches. Re-verified 2026-10-25: a post-cutoff question came back correct with
 * 4 source URLs and usage.tool_usage.web_search_call = 1.
 * History: until 2026-10-01 the native Hunyuan params below were accepted and silently dropped
 * (200 OK, 985 characters, zero links), and it measured the model's memory like the others.
 *
 * Included because of where it lives: Yuanbao is inside WeChat, and a Richmond customer looking
 * for a dentist opens WeChat far more often than X. `enable_enhancement` turns on live search;
 * `search_info` asks for the sources back. */
async function hunyuan(prompt: string): Promise<EngineAnswer> {
  // HUNYUAN_EXTRA lets a probe add the vendor-specific params one at a time. The docs list
  // enable_enhancement / search_info / citation, but sending all three at once through the
  // TokenHub gateway returns 504 — and three-at-once cannot tell you which one it choked on.
  const extra = (() => { try { return JSON.parse(process.env.HUNYUAN_EXTRA || "{}"); } catch { return {}; } })();
  const key = process.env.HUNYUAN_API_KEY as string;
  // TokenHub, not the Hunyuan-native endpoint. The key issued in the console is a TokenHub key
  // (a multi-model gateway that also fronts GLM, DeepSeek and Kimi), and it 401s against
  // api.hunyuan.cloud.tencent.com — same vendor, different system. Model id is "hy3" there.
  const model = process.env.HUNYUAN_MODEL || "hy3";
  const url = process.env.HUNYUAN_URL || "https://tokenhub.tencentmaas.com/v1/chat/completions";
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      // hy3 thinks at high effort by default; "low" trims output tokens (billed as output).
      // Live search: web_search_options is honoured ONLY once the web_search tool is enabled for
      // the account (TokenHub → 启用管理 → 应用工具, enabled 2026-10-01, 50k free calls to 2027-10).
      // Before that it was accepted and silently dropped, which is why the notes below say "settled".
      // Measured after enabling: a Richmond-dentist question returned 10 real clinic URLs in
      // message.search_results; the same call without it returned none.
      web_search_options: { enable: true, search_source: "lite" },
      reasoning_effort: "low",
      ...extra,
      // ⚠️ SETTLED 2026-08-18, do not retry: enable_enhancement / search_info / citation are
      // documented Hunyuan parameters, and TokenHub ACCEPTS all three — 200 OK, no error, an
      // answer comes back. It just silently drops them. Logged proof, sending all three:
      //     response keys ["id","object","model","created","choices","usage"]
      // No search_info, no links, and the call runs FASTER with them than without (9.3s vs
      // 11.7s) — nothing was retrieved. Accepted is not the same as honoured, and on a gateway
      // there is no error to tell you which one you got.
      // The native endpoint is not an escape hatch: console.cloud.tencent.com/hunyuan has
      // greyed out key creation entirely and redirects to TokenHub, so there is no un-gatewayed
      // path left to buy. Yuanbao measures what the MODEL knows, like the other four CN engines.
    }),
  });
  if (!r.ok) throw new Error(`Hunyuan ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  // Which fields actually came back. The vendor params are accepted without error but produce
  // no links, and "accepted" and "honoured" are not the same thing on a gateway — this log is
  // the only way to tell a silently-dropped parameter from a parsing mistake on our side.
  if (Object.keys(extra).length) {
    console.log(`[hunyuan] sent ${JSON.stringify(Object.keys(extra))} → response keys ${JSON.stringify(Object.keys((d ?? {}) as object))}`);
  }
  const text = str(get(get(arr(get(d, "choices"))[0], "message"), "content"));
  // search_info.search_results[].url — read defensively: an unannounced shape change must cost
  // us the links, not the whole engine.
  const links: string[] = [];
  const msg = get(arr(get(d, "choices"))[0], "message");
  for (const it of [...arr(get(get(d, "search_info"), "search_results")), ...arr(get(msg, "search_results"))]) {
    const u = str(get(it, "url")) || str(get(it, "link"));
    if (u && !links.includes(u)) links.push(u);
  }
  // usage.tool_usage.web_search_call = searches actually run — the proof search was honoured.
  // Falls back to "it returned sources, so it searched" when the gateway omits the counter.
  const searches = Number(get(get(get(d, "usage"), "tool_usage"), "web_search_call")) || (links.length ? 1 : 0);
  const u = readUsage(d);
  return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
}

/* ── DeepSeek — chat completions + a web_search tool backed by DeepSeek's own /v1/tools/search ──
 * DeepSeek opened its in-house search engine as an API on 2026-10-17 (api-docs.deepseek.com/guides/
 * search): POST /v1/tools/search, same Bearer key, { query ≤128 chars, count, ori_question } →
 * results[] of { title, url, summary, site_name, date }. $0.75 per 1,000 successful requests (empty
 * results are free). Like kimi(), the model decides whether and what to search through an ordinary
 * function tool; we run each query and hand the results back. Thinking mode stays on; with `tools`
 * present its reasoning_content must be passed back on later turns — pushing the message whole does. */
const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";

/** One DeepSeek search. `billed` = the provider charges for it (200 + non-empty results).
 *  Account failures (401 key, 402 balance) THROW: a search that silently stops working would leave
 *  DeepSeek answering from memory again — a different instrument wearing the same name. */
export async function deepseekSearch(key: string, query: string, question: string): Promise<{ content: string; urls: string[]; billed: boolean }> {
  const body = JSON.stringify({ query: query.trim().slice(0, 128), count: 10, ori_question: question.trim().slice(0, 128) || undefined });
  let r: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetchWithTimeout(process.env.DEEPSEEK_SEARCH_URL || DEEPSEEK_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
    }, 25000).catch((e) => { if (attempt) throw e; return undefined; });
    // 408/429/5xx are documented as "wait and retry"; once is enough inside a cell's budget.
    if (r && !(r.status === 408 || r.status === 429 || r.status >= 500)) break;
    if (!attempt) await new Promise((res) => setTimeout(res, 1500));
  }
  if (!r) return { content: JSON.stringify({ error: "search unavailable" }), urls: [], billed: false };
  if (r.status === 401 || r.status === 402) throw new Error(`DeepSeek search ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (!r.ok) return { content: JSON.stringify({ error: `search failed (${r.status})` }), urls: [], billed: false };
  const d: unknown = await r.json();
  const results = arr(get(d, "results")).slice(0, 10);
  const urls: string[] = [];
  const compact = results.map((it) => {
    const url = str(get(it, "url"));
    if (url && !urls.includes(url)) urls.push(url);
    return { title: str(get(it, "title")), url, site: str(get(it, "site_name")), date: str(get(it, "date")),
      text: (str(get(it, "summary")) || str(get(it, "snippet"))).slice(0, 800) };
  });
  return { content: JSON.stringify({ results: compact }), urls, billed: results.length > 0 };
}

async function deepseek(prompt: string): Promise<EngineAnswer> {
  return deepseekWithSearch(prompt);
}

const DEEPSEEK_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for up-to-date information. Use it for anything about specific businesses, places, prices or recent facts.",
    parameters: { type: "object", properties: { query: { type: "string", description: "The search query (at most 128 characters)" } }, required: ["query"] },
  },
};

const ANSWER_NOW = "Search limit reached. Answer the original question now, using only the search results above. Do not search again. / 已达搜索上限：请直接根据以上搜索结果回答原问题，不要再搜索。";
const DSML = /<[｜|]+\s*DSML\s*[｜|]+/;
/** Cut a leaked DSML tool-call block (and anything after it) out of answer text. */
export function stripDsml(t: string): string {
  const m = DSML.exec(t);
  return m ? t.slice(0, m.index).trim() : t;
}

async function deepseekWithSearch(prompt: string): Promise<EngineAnswer> {
  const key = process.env.DEEPSEEK_API_KEY as string;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
  const url = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";
  const tools = [DEEPSEEK_SEARCH_TOOL];
  const messages: unknown[] = [{ role: "user", content: prompt }];
  let text = "";
  const links: string[] = [];
  // The whole loop must finish inside CELL_MS (210s, measure.ts), or the backstop kills the cell
  // and the answer is lost after it was paid for. Each turn gets what is left of a 195s budget.
  const loopDeadline = Date.now() + 195000;
  let usedIn = 0, usedOut = 0, cached = 0, searches = 0;
  let served: string | undefined;
  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const left = loopDeadline - Date.now();
    // Out of turns or nearly out of time: one last call that may not search, so the model answers
    // from what it already found (kimi's 2026-10-05 lesson: 4 search turns, empty text). tools stay
    // in the body with tool_choice "none", plus an explicit "answer now" turn.
    const last = i === MAX_TURNS - 1 || left < 60000;
    const ask = async (body: Record<string, unknown>) => {
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.3, ...body }),
      }, Math.max(20000, Math.min(SLOW_TIMEOUT_MS.deepseek, loopDeadline + 10000 - Date.now())));
      if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d: unknown = await r.json();
      const u = readUsage(d);
      if (u) { usedIn += u.in; usedOut += u.out; cached += u.cached ?? 0; served = served ?? u.model; }
      return d;
    };
    if (last) messages.push({ role: "user", content: ANSWER_NOW });
    let d = await ask(last ? { messages, tools, tool_choice: "none" } : { messages, tools });
    // 2026-10-25, live: with tool_choice "none" the model once wrote its next search as raw DSML
    // markup ("<｜｜DSML｜｜ calls>…") in `content` — a tool call, not an answer. Ask once more with no
    // tools at all; whatever markup survives is cut off rather than scored as answer text.
    if (last && DSML.test(str(get(get(arr(get(d, "choices"))[0], "message"), "content")))) d = await ask({ messages });
    const choice = arr(get(d, "choices"))[0];
    const msg = get(choice, "message");
    const content = stripDsml(str(get(msg, "content")));
    // Keep only the FINAL answer; interim turns that end in tool_calls are not the answer.
    if (content) text = content;
    const calls = arr(get(msg, "tool_calls"));
    if (last || str(get(choice, "finish_reason")) !== "tool_calls" || !calls.length) break;
    messages.push(msg); // carries reasoning_content + tool_calls — both required on the next turn
    const outs = await Promise.all(calls.map(async (tc) => {
      const fn = get(tc, "function");
      let query = "";
      try { query = str(get(JSON.parse(str(get(fn, "arguments")) || "{}"), "query")); } catch { /* malformed args */ }
      const out = query.trim() ? await deepseekSearch(key, query, prompt) : { content: JSON.stringify({ error: "empty query" }), urls: [] as string[], billed: false };
      return { tc, fn, out };
    }));
    for (const { tc, fn, out } of outs) {
      if (out.billed) searches++;
      for (const l of out.urls) if (!links.includes(l)) links.push(l);
      messages.push({ role: "tool", tool_call_id: str(get(tc, "id")), name: str(get(fn, "name")) || "web_search", content: out.content });
    }
  }
  return {
    text, links,
    ...(usedIn + usedOut > 0 || searches
      ? { usage: { in: usedIn, out: usedOut, ...(searches ? { searches } : {}), ...(cached ? { cached } : {}), ...(served ? { model: served } : {}) } }
      : {}),
  };
}

/* ── Doubao 豆包 (ByteDance, via Volcengine Ark) — OpenAI-compatible (VERIFY w/ key) ──
 * ARK_MODEL must be the Ark model id or endpoint id (ep-…) from the Volcengine console.
 * Doubao is the largest CN assistant by MAU and no Western tool measures it — this is the wedge. */
async function doubao(prompt: string): Promise<EngineAnswer> {
  const key = process.env.ARK_API_KEY as string;
  // Same trap as DeepSeek above: `doubao-pro-32k` is retired and 404s. The live value comes from
  // ARK_MODEL (an Ark model id or an ep-… endpoint id from the Volcengine console); this default
  // only exists so a missing env var fails loudly on a real name instead of a dead one.
  const model = process.env.ARK_MODEL || "doubao-seed-evolving";
  const chatUrl = process.env.ARK_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  // 2026-10-01: the account enabled 火山方舟「联网内容插件」, so Doubao now answers WITH live web
  // search via the Responses API web_search tool (Python SDK WebSearchToolParam:
  // sources ∈ toutiao|douyin|moji|search_engine). We send ONLY "search_engine" = 联网资源
  // (first 20k/month free, then ¥4/1k). toutiao/douyin/moji are billed at ¥6/1k and are
  // deliberately left out.
  const respUrl = process.env.ARK_RESPONSES_URL || chatUrl.replace(/\/chat\/completions\/?$/, "/responses");
  const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const r = await fetchWithTimeout(respUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search", sources: ["search_engine"], limit: 10 }],
      max_tool_calls: 3, // bounds the per-answer search fee; only honoured for built-in tools
      temperature: 0.3,
      thinking: { type: "disabled" }, // Seed models reason by default — far too slow for a batch measurement
      store: false,
    }),
  }, SLOW_TIMEOUT_MS.doubao);
  if (r.ok) {
    const d: unknown = await r.json();
    // output[]: web_search_call items, then a `message` whose content[] holds output_text parts
    // with annotations[] of { type: "url_citation", url, title, site_name, … }.
    const parts: string[] = [];
    const links: string[] = [];
    for (const item of arr(get(d, "output"))) {
      if (get(item, "type") !== "message") continue;
      for (const c of arr(get(item, "content"))) {
        if (get(c, "type") !== "output_text") continue;
        parts.push(str(get(c, "text")));
        for (const an of arr(get(c, "annotations"))) {
          const u = str(get(an, "url"));
          if (u && get(an, "type") !== "doc_citation" && !links.includes(u)) links.push(u);
        }
      }
    }
    const text = parts.join("") || str(get(d, "output_text"));
    // usage.input_tokens / output_tokens (readUsage handles both), plus
    // usage.tool_usage.web_search = searches billed. Fallback: "returned sources ⇒ searched once".
    const searches = Number(get(get(get(d, "usage"), "tool_usage"), "web_search")) || (links.length ? 1 : 0);
    const u = readUsage(d);
    return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
  }
  // Graceful fallback: if this model/endpoint rejects the Responses API or the tool (4xx other
  // than auth/rate-limit), answer from the model via chat completions so the engine never goes
  // to a silent 0. Logged loudly — a run on the fallback has NO retrieval and NO links.
  const errBody = (await r.text()).slice(0, 300);
  if (r.status < 400 || r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429) {
    throw new Error(`Doubao responses ${r.status}: ${errBody.slice(0, 200)}`);
  }
  console.warn(`[doubao] responses+web_search rejected (${r.status}): ${errBody} — FALLING BACK to chat/completions without search`);
  const r2 = await fetchWithTimeout(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      thinking: { type: "disabled" },
    }),
  });
  if (!r2.ok) throw new Error(`Doubao ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
  const d2: unknown = await r2.json();
  return { text: str(get(get(arr(get(d2, "choices"))[0], "message"), "content")), links: [], usage: readUsage(d2) };
}

/** Engines configured right now, filtered by the client's market.
 *  undefined → all (UI status); global-en → west; china → cn; bilingual → both. */
/**
 * Where each engine actually lives — the same defaults the query functions use.
 *
 * Exists for the self-test: reachability and slowness produce an identical "timed out" error,
 * and telling them apart needs a request that must fail FAST (bad auth → 401) against the raw
 * endpoint. That probe costs nothing, consumes no quota, and is the only thing that
 * distinguishes "we could not reach Beijing" from "the model was still writing".
 *
 * ⚠️ Keep in sync with the query functions below. They read the same env vars.
 */
/* ── 百度 Baidu — 千帆「智能搜索生成」(Qianfan AI Search) ─────────────────────────────────────
 * POST https://qianfan.baidubce.com/v2/ai_search/chat/completions  Authorization: Bearer <key>
 * Baidu web search + an ERNIE model in one call; answer → choices[0].message.content,
 * sources → references[].url. Needs a mainland-verified Qianfan account with BOTH post-paid
 * switches on (tools quota + model service) — with only one, every call is "account_overdue".
 * Deep search stays off: it fans out into up to 10 billed calls. */
async function baidu(prompt: string): Promise<EngineAnswer> {
  const key = process.env.BAIDU_QIANFAN_API_KEY as string;
  const model = process.env.BAIDU_MODEL || "ernie-5.1";
  const r = await fetchWithTimeout(ENGINE_ENDPOINTS.baidu, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model, search_source: "baidu_search_v2", stream: false, enable_deep_search: false }),
  });
  if (!r.ok) throw new Error(`Baidu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: unknown = await r.json();
  // Errors can arrive as HTTP 200: {error_code,error_msg}, {error:{message}} or {code,message}.
  const errMsg = str(get(d, "error_msg")) || str(get(get(d, "error"), "message")) || (get(d, "choices") == null ? str(get(d, "message")) : "");
  if (errMsg) throw new Error(`Baidu ${str(get(d, "error_code")) || str(get(d, "code")) || "error"}: ${errMsg.slice(0, 200)}`);
  const text = str(get(get(arr(get(d, "choices"))[0], "message"), "content"));
  const links = arr(get(d, "references")).map((x) => str(get(x, "url"))).filter(Boolean);
  const usage = readUsage(d);
  return { text, links, ...(usage ? { usage: { ...usage, searches: 1, model } } : {}) };
}

export const ENGINE_ENDPOINTS: Record<string, string> = {
  openai: process.env.OPENAI_URL || "https://api.openai.com/v1/chat/completions",
  perplexity: process.env.PERPLEXITY_URL || "https://api.perplexity.ai/chat/completions",
  claude: process.env.CLAUDE_URL || "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  grok: process.env.XAI_URL || "https://api.x.ai/v1/chat/completions",
  doubao: process.env.ARK_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  qwen: process.env.QWEN_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  deepseek: process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions",
  kimi: process.env.KIMI_URL || "https://api.moonshot.cn/v1/chat/completions",
  hunyuan: process.env.HUNYUAN_URL || "https://tokenhub.tencentmaas.com/v1/chat/completions",
  baidu: process.env.BAIDU_URL || "https://qianfan.baidubce.com/v2/ai_search/chat/completions",
  muse: process.env.MUSE_URL || "https://api.meta.ai/v1/responses",
};

/** opts.next  — use the models scheduled for MODEL_SWITCH_AT.
 *  opts.probe — health checks only (self-test, daily preflight): include every engine that has a
 *               key, even one not yet measuring clients, so it is watched before it counts. */
export function activeEngines(market?: string, opts: { next?: boolean; probe?: boolean } = {}): Engine[] {
  const next = !!opts.next;
  const all: Engine[] = [];
  if (process.env.OPENAI_API_KEY) all.push({ id: "openai", label: "ChatGPT", region: "west", citesSources: true, query: (p) => openai(p, modelFor("OPENAI_MODEL", "gpt-5.5", next)) });
  if (process.env.PERPLEXITY_API_KEY) all.push({ id: "perplexity", label: "Perplexity", region: "west", citesSources: true, query: perplexity });
  // Claude reuses the audit key (always present). Opt out with MEASURE_CLAUDE=0.
  if (process.env.ANTHROPIC_API_KEY && process.env.MEASURE_CLAUDE !== "0") all.push({ id: "claude", label: "Claude", region: "west", citesSources: true, query: (p) => claude(p, next) });
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) all.push({ id: "gemini", label: "Gemini", region: "west", citesSources: true, query: (p) => gemini(p, modelFor("GEMINI_MODEL", "gemini-2.5-flash", next)) });
  if (process.env.XAI_API_KEY) all.push({ id: "grok", label: "Grok", region: "west", citesSources: true, query: grok });
  // Muse joins at the switch, not when the key lands — a key pasted mid-month must not add an
  // engine to half a month's clients.
  if (process.env.META_API_KEY && (instrumentSwitched(next) || opts.probe)) all.push({ id: "muse", label: "Muse", region: "west", citesSources: true, query: muse });
  if (process.env.ARK_API_KEY) all.push({ id: "doubao", label: "豆包", region: "cn", citesSources: true, query: doubao });
  if (process.env.DASHSCOPE_API_KEY) all.push({ id: "qwen", label: "通义千问", region: "cn", citesSources: false, query: qwen });
  if (process.env.DEEPSEEK_API_KEY) all.push({ id: "deepseek", label: "DeepSeek", region: "cn", citesSources: true, query: deepseek });
  // citesSources: FALSE. It was added on the promise that Hunyuan reports its sources — true of
  // the native API, not of the TokenHub gateway this key belongs to, which 504s on the search
  // parameters and returns zero links. Leaving it true would have put every Yuanbao answer in the
  // citation denominator with a guaranteed-empty numerator, quietly halving link-rate for every
  // bilingual client — the exact failure the CN engines are excluded to avoid.
  if (process.env.HUNYUAN_API_KEY) all.push({ id: "hunyuan", label: "元宝", region: "cn", citesSources: true, query: hunyuan });
  if (process.env.MOONSHOT_API_KEY) all.push({ id: "kimi", label: "Kimi", region: "cn", citesSources: false, query: kimi });
  if (process.env.BAIDU_QIANFAN_API_KEY) all.push({ id: "baidu", label: "百度", region: "cn", citesSources: true, query: baidu });
  if (!market) return all;
  const regions: ("west" | "cn")[] = market === "china" ? ["cn"] : market === "bilingual" ? ["west", "cn"] : ["west"];
  return all.filter((e) => regions.includes(e.region));
}

