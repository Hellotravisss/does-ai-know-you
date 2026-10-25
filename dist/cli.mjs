#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/engines.ts
var engines_exports = {};
__export(engines_exports, {
  ENGINE_ENDPOINTS: () => ENGINE_ENDPOINTS,
  activeEngines: () => activeEngines,
  deepseekSearch: () => deepseekSearch,
  grokModel: () => grokModel,
  grokRequestBody: () => grokRequestBody,
  instrumentSwitched: () => instrumentSwitched,
  modelFor: () => modelFor,
  parseGrok: () => parseGrok,
  stripDsml: () => stripDsml
});
function instrumentSwitched(next = false) {
  if (next) return true;
  const at = process.env.MODEL_SWITCH_AT;
  return !!at && Date.now() >= Date.parse(at);
}
function modelFor(name, fallback, next = false) {
  const upcoming = process.env[`${name}_NEXT`];
  const own = process.env[`${name}_SWITCH_AT`];
  const switched = next || (own ? Date.now() >= Date.parse(own) : instrumentSwitched(false));
  if (upcoming && switched) return upcoming;
  return process.env[name] || fallback;
}
function readUsage(d) {
  const u = get(d, "usage") ?? get(d, "usageMetadata");
  if (!u) return void 0;
  const n = (v) => typeof v === "number" && isFinite(v) ? v : 0;
  const i = n(get(u, "prompt_tokens")) || n(get(u, "input_tokens")) || n(get(u, "promptTokenCount")) + n(get(u, "toolUsePromptTokenCount"));
  const o = n(get(u, "completion_tokens")) || n(get(u, "output_tokens")) || n(get(u, "candidatesTokenCount")) + n(get(u, "thoughtsTokenCount"));
  const st = get(u, "server_tool_use");
  const xt = get(u, "server_side_tool_usage_details");
  const searches = n(get(st, "web_search_requests")) || n(get(xt, "web_search_calls")) + n(get(xt, "x_search_calls"));
  const sources = n(get(u, "num_sources_used"));
  const cached = n(get(get(u, "input_tokens_details"), "cached_tokens")) || n(get(get(u, "prompt_tokens_details"), "cached_tokens"));
  if (!i && !o && !searches) return void 0;
  const served = get(d, "modelVersion") ?? get(d, "model");
  const model = typeof served === "string" && served ? served.slice(0, 80) : void 0;
  return { in: i, out: o, ...searches ? { searches } : {}, ...sources ? { sources } : {}, ...model ? { model } : {}, ...cached ? { cached } : {} };
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function get(o, k) {
  return o && typeof o === "object" ? o[k] : void 0;
}
async function fetchWithTimeout(url, opts, ms = DEFAULT_TIMEOUT_MS) {
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
async function openai(prompt, model = modelFor("OPENAI_MODEL", "gpt-5.5")) {
  const key = process.env.OPENAI_API_KEY;
  const r = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    // max_output_tokens counts the model's hidden reasoning too. At 700, gpt-6-luna often spent the
    // whole budget thinking after reading ~30k tokens of search results and returned NO text
    // (2026-10 run: 14 of 38 detail answers empty, 12 of them at exactly
    // 700). Empty answers drop out of the denominator, so they hide the hardest questions rather
    // than score as misses. 6000 leaves room to reason and still write the list.
    body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt, max_output_tokens: 6e3 })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  let text = "";
  const links = [];
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
  return { text, links, ...usage ? { usage: { ...usage, ...searches ? { searches } : {} } } : {} };
}
async function muse(prompt) {
  const key = process.env.META_API_KEY;
  const model = process.env.MUSE_MODEL || "muse-spark-1.3";
  const r = await fetchWithTimeout(ENGINE_ENDPOINTS.muse, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }], reasoning: { effort: "low" }, max_output_tokens: 4e3 })
  });
  if (!r.ok) throw new Error(`Muse ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  let text = "";
  const links = [];
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
  return { text, links, ...usage ? { usage: { ...usage, ...searches ? { searches } : {} } } : {} };
}
async function perplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  const model = process.env.PERPLEXITY_MODEL || "sonar-pro";
  const url = process.env.PERPLEXITY_URL || "https://api.perplexity.ai/v1/sonar";
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] })
  });
  if (!r.ok) throw new Error(`Perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const msg = get(arr(get(d, "choices"))[0], "message");
  const text = str(get(msg, "content"));
  const links = [];
  for (const u2 of arr(get(d, "citations"))) {
    const s = str(u2);
    if (s) links.push(s);
  }
  for (const sr of arr(get(d, "search_results"))) {
    const u2 = str(get(sr, "url"));
    if (u2) links.push(u2);
  }
  const u = readUsage(d);
  return { text, links, ...u ? { usage: { ...u, searches: 1 } } : { usage: { in: 0, out: 0, searches: 1 } } };
}
async function claude(prompt, next = false) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = modelFor("CLAUDE_MODEL", "claude-haiku-4-5", next);
  const toolType = modelFor("CLAUDE_WEBSEARCH_TYPE", "web_search_20260209", next);
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
      tools: [{ type: toolType, name: "web_search", max_uses: 3 }]
    })
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  let text = "";
  const links = [];
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
async function gemini(prompt, model = modelFor("GEMINI_MODEL", "gemini-2.5-flash")) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
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
        .../gemini-3\./.test(model) ? { generationConfig: { thinkingConfig: { thinkingLevel: "low" } } } : {}
      })
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const cand = arr(get(d, "candidates"))[0];
  let text = "";
  for (const p of arr(get(get(cand, "content"), "parts"))) {
    const t = str(get(p, "text"));
    if (t) text += (text ? "\n" : "") + t;
  }
  const chunks = arr(get(get(cand, "groundingMetadata"), "groundingChunks")).map((ch) => ({ uri: str(get(get(ch, "web"), "uri")), title: str(get(get(ch, "web"), "title")) })).filter((c) => c.uri);
  const links = instrumentSwitched() ? (await Promise.all(chunks.map((c) => geminiSource(c.uri, c.title)))).filter((u2) => !!u2) : chunks.map((c) => c.uri);
  const searches = arr(get(get(cand, "groundingMetadata"), "webSearchQueries")).length;
  const u = readUsage(d);
  return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
}
async function geminiSource(uri, title) {
  let h = "";
  try {
    h = new URL(uri).hostname;
  } catch {
    return null;
  }
  if (!GEMINI_REDIRECT.test(h)) return uri;
  const t = title.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(t)) return `https://${t}/`;
  try {
    const r = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(4e3) });
    const loc = r.headers.get("location");
    if (loc && !GEMINI_REDIRECT.test(new URL(loc, uri).hostname)) return new URL(loc, uri).toString();
  } catch {
  }
  return null;
}
function grokExtra() {
  try {
    return JSON.parse(process.env.XAI_EXTRA || "{}");
  } catch {
    return {};
  }
}
function grokModel() {
  return process.env.XAI_MODEL || "grok-4.5";
}
function grokRequestBody(prompt) {
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
    ...grokExtra()
  };
}
async function grok(prompt) {
  const key = process.env.XAI_API_KEY;
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
    body: JSON.stringify(grokRequestBody(prompt))
  }, SLOW_TIMEOUT_MS.grok);
  if (r.status === 400) {
    const body = await r.text();
    if (/max_output_tokens|unknown|unrecognized|unsupported/i.test(body)) {
      console.log("[grok] max_output_tokens rejected \u2014 retrying without it");
      const r2 = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }] })
      }, SLOW_TIMEOUT_MS.grok);
      if (!r2.ok) throw new Error(`Grok ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
      return parseGrok(await r2.json());
    }
    throw new Error(`Grok 400: ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Grok ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return parseGrok(await r.json());
}
function parseGrok(d) {
  let text = "";
  const links = [];
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
async function qwen(prompt) {
  const key = process.env.DASHSCOPE_API_KEY;
  const model = process.env.QWEN_MODEL || "qwen-plus";
  const url = process.env.QWEN_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
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
      stream_options: { include_usage: true }
    })
  });
  const r2 = !r.ok && r.status === 400 && /stream_options/i.test(await r.clone().text()) ? await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], ...QWEN_SEARCH, stream: true })
  }) : r;
  if (!r2.ok) throw new Error(`Qwen ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
  const raw = await r2.text();
  let text = "";
  const links = [];
  let qwenUsage;
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const d = JSON.parse(payload);
      const c = str(get(get(arr(get(d, "choices"))[0], "delta"), "content"));
      if (c) text += c;
      for (const sr of arr(get(get(d, "search_info") ?? get(get(d, "output"), "search_info"), "search_results"))) {
        const u2 = str(get(sr, "url"));
        if (u2 && !links.includes(u2)) links.push(u2);
      }
      const u = readUsage(d);
      if (u) qwenUsage = u;
    } catch {
    }
  }
  return { text, links, usage: { ...qwenUsage ?? { in: 0, out: 0 }, searches: 1 } };
}
async function kimiSearch(base, key, query) {
  const r = await fetchWithTimeout(`${base}/tools/search_pro`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text_query: query.slice(0, 400), limit: 5, timeout_seconds: 30 })
  }, 4e4);
  if (!r.ok) return { content: JSON.stringify({ error: `search failed (${r.status})` }), urls: [] };
  const d = await r.json();
  const results = arr(get(d, "search_results")).slice(0, 5);
  const urls = [];
  const compact = results.map((it) => {
    const url = str(get(it, "url"));
    if (url) urls.push(url);
    const chunks = arr(get(it, "chunks")).slice(0, 2).map((c) => str(get(c, "text")).slice(0, 700));
    return {
      title: str(get(it, "title")),
      url,
      site: str(get(it, "site_name")),
      date: str(get(it, "date")),
      text: chunks.length ? chunks.join(" \u2026 ") : str(get(it, "snippet")).slice(0, 700)
    };
  });
  return { content: JSON.stringify({ results: compact }), urls };
}
async function kimi(prompt) {
  const key = process.env.MOONSHOT_API_KEY;
  const model = process.env.KIMI_MODEL || "kimi-k2.6";
  const url = process.env.KIMI_URL || "https://api.moonshot.ai/v1/chat/completions";
  const base = url.replace(/\/chat\/completions\/?$/, "");
  const tools = [KIMI_SEARCH_TOOL];
  const messages = [{ role: "user", content: prompt }];
  let text = "";
  const links = [];
  const loopDeadline = Date.now() + 2e5;
  let usedIn = 0, usedOut = 0, searches = 0;
  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const last = i === MAX_TURNS - 1 || Date.now() > loopDeadline;
    if (last) messages.push({ role: "user", content: ANSWER_NOW });
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      // No temperature field: the k2.x generation rejects anything but its default (see git history).
      body: JSON.stringify(last ? { model, messages } : { model, messages, tools })
    }, SLOW_TIMEOUT_MS.kimi);
    if (!r.ok) throw new Error(`Kimi ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    const u = readUsage(d);
    if (u) {
      usedIn += u.in;
      usedOut += u.out;
    }
    const choice = arr(get(d, "choices"))[0];
    const msg = get(choice, "message");
    const content = str(get(msg, "content"));
    if (content) text = content;
    const calls = arr(get(msg, "tool_calls"));
    if (last || str(get(choice, "finish_reason")) !== "tool_calls" || !calls.length) break;
    messages.push(msg);
    for (const tc of calls) {
      const fn = get(tc, "function");
      let query = "";
      try {
        query = str(get(JSON.parse(str(get(fn, "arguments")) || "{}"), "query"));
      } catch {
      }
      let out = { content: JSON.stringify({ error: "empty query" }), urls: [] };
      if (query) {
        out = await kimiSearch(base, key, query);
        searches++;
      }
      for (const l of out.urls) if (!links.includes(l)) links.push(l);
      messages.push({ role: "tool", tool_call_id: str(get(tc, "id")), name: str(get(fn, "name")) || "web_search", content: out.content });
    }
  }
  return { text, links, ...usedIn + usedOut > 0 ? { usage: { in: usedIn, out: usedOut, ...searches ? { searches } : {} } } : {} };
}
async function hunyuan(prompt) {
  const extra = (() => {
    try {
      return JSON.parse(process.env.HUNYUAN_EXTRA || "{}");
    } catch {
      return {};
    }
  })();
  const key = process.env.HUNYUAN_API_KEY;
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
      ...extra
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
    })
  });
  if (!r.ok) throw new Error(`Hunyuan ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (Object.keys(extra).length) {
    console.log(`[hunyuan] sent ${JSON.stringify(Object.keys(extra))} \u2192 response keys ${JSON.stringify(Object.keys(d ?? {}))}`);
  }
  const text = str(get(get(arr(get(d, "choices"))[0], "message"), "content"));
  const links = [];
  const msg = get(arr(get(d, "choices"))[0], "message");
  for (const it of [...arr(get(get(d, "search_info"), "search_results")), ...arr(get(msg, "search_results"))]) {
    const u2 = str(get(it, "url")) || str(get(it, "link"));
    if (u2 && !links.includes(u2)) links.push(u2);
  }
  const searches = Number(get(get(get(d, "usage"), "tool_usage"), "web_search_call")) || (links.length ? 1 : 0);
  const u = readUsage(d);
  return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
}
async function deepseekSearch(key, query, question) {
  const body = JSON.stringify({ query: query.trim().slice(0, 128), count: 10, ori_question: question.trim().slice(0, 128) || void 0 });
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetchWithTimeout(process.env.DEEPSEEK_SEARCH_URL || DEEPSEEK_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body
    }, 25e3).catch((e) => {
      if (attempt) throw e;
      return void 0;
    });
    if (r && !(r.status === 408 || r.status === 429 || r.status >= 500)) break;
    if (!attempt) await new Promise((res) => setTimeout(res, 1500));
  }
  if (!r) return { content: JSON.stringify({ error: "search unavailable" }), urls: [], billed: false };
  if (r.status === 401 || r.status === 402) throw new Error(`DeepSeek search ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (!r.ok) return { content: JSON.stringify({ error: `search failed (${r.status})` }), urls: [], billed: false };
  const d = await r.json();
  const results = arr(get(d, "results")).slice(0, 10);
  const urls = [];
  const compact = results.map((it) => {
    const url = str(get(it, "url"));
    if (url && !urls.includes(url)) urls.push(url);
    return {
      title: str(get(it, "title")),
      url,
      site: str(get(it, "site_name")),
      date: str(get(it, "date")),
      text: (str(get(it, "summary")) || str(get(it, "snippet"))).slice(0, 800)
    };
  });
  return { content: JSON.stringify({ results: compact }), urls, billed: results.length > 0 };
}
async function deepseek(prompt) {
  return deepseekWithSearch(prompt);
}
function stripDsml(t) {
  const m = DSML.exec(t);
  return m ? t.slice(0, m.index).trim() : t;
}
async function deepseekWithSearch(prompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
  const url = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";
  const tools = [DEEPSEEK_SEARCH_TOOL];
  const messages = [{ role: "user", content: prompt }];
  let text = "";
  const links = [];
  const loopDeadline = Date.now() + 195e3;
  let usedIn = 0, usedOut = 0, cached = 0, searches = 0;
  let served;
  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const left = loopDeadline - Date.now();
    const last = i === MAX_TURNS - 1 || left < 6e4;
    const ask = async (body) => {
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.3, ...body })
      }, Math.max(2e4, Math.min(SLOW_TIMEOUT_MS.deepseek, loopDeadline + 1e4 - Date.now())));
      if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d2 = await r.json();
      const u = readUsage(d2);
      if (u) {
        usedIn += u.in;
        usedOut += u.out;
        cached += u.cached ?? 0;
        served = served ?? u.model;
      }
      return d2;
    };
    if (last) messages.push({ role: "user", content: ANSWER_NOW });
    let d = await ask(last ? { messages, tools, tool_choice: "none" } : { messages, tools });
    if (last && DSML.test(str(get(get(arr(get(d, "choices"))[0], "message"), "content")))) d = await ask({ messages });
    const choice = arr(get(d, "choices"))[0];
    const msg = get(choice, "message");
    const content = stripDsml(str(get(msg, "content")));
    if (content) text = content;
    const calls = arr(get(msg, "tool_calls"));
    if (last || str(get(choice, "finish_reason")) !== "tool_calls" || !calls.length) break;
    messages.push(msg);
    const outs = await Promise.all(calls.map(async (tc) => {
      const fn = get(tc, "function");
      let query = "";
      try {
        query = str(get(JSON.parse(str(get(fn, "arguments")) || "{}"), "query"));
      } catch {
      }
      const out = query.trim() ? await deepseekSearch(key, query, prompt) : { content: JSON.stringify({ error: "empty query" }), urls: [], billed: false };
      return { tc, fn, out };
    }));
    for (const { tc, fn, out } of outs) {
      if (out.billed) searches++;
      for (const l of out.urls) if (!links.includes(l)) links.push(l);
      messages.push({ role: "tool", tool_call_id: str(get(tc, "id")), name: str(get(fn, "name")) || "web_search", content: out.content });
    }
  }
  return {
    text,
    links,
    ...usedIn + usedOut > 0 || searches ? { usage: { in: usedIn, out: usedOut, ...searches ? { searches } : {}, ...cached ? { cached } : {}, ...served ? { model: served } : {} } } : {}
  };
}
async function doubao(prompt) {
  const key = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL || "doubao-seed-evolving";
  const chatUrl = process.env.ARK_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  const respUrl = process.env.ARK_RESPONSES_URL || chatUrl.replace(/\/chat\/completions\/?$/, "/responses");
  const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const r = await fetchWithTimeout(respUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search", sources: ["search_engine"], limit: 10 }],
      max_tool_calls: 3,
      // bounds the per-answer search fee; only honoured for built-in tools
      temperature: 0.3,
      thinking: { type: "disabled" },
      // Seed models reason by default — far too slow for a batch measurement
      store: false
    })
  }, SLOW_TIMEOUT_MS.doubao);
  if (r.ok) {
    const d = await r.json();
    const parts = [];
    const links = [];
    for (const item of arr(get(d, "output"))) {
      if (get(item, "type") !== "message") continue;
      for (const c of arr(get(item, "content"))) {
        if (get(c, "type") !== "output_text") continue;
        parts.push(str(get(c, "text")));
        for (const an of arr(get(c, "annotations"))) {
          const u2 = str(get(an, "url"));
          if (u2 && get(an, "type") !== "doc_citation" && !links.includes(u2)) links.push(u2);
        }
      }
    }
    const text = parts.join("") || str(get(d, "output_text"));
    const searches = Number(get(get(get(d, "usage"), "tool_usage"), "web_search")) || (links.length ? 1 : 0);
    const u = readUsage(d);
    return { text, links, usage: u ? { ...u, searches } : { in: 0, out: 0, searches } };
  }
  const errBody = (await r.text()).slice(0, 300);
  if (r.status < 400 || r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429) {
    throw new Error(`Doubao responses ${r.status}: ${errBody.slice(0, 200)}`);
  }
  console.warn(`[doubao] responses+web_search rejected (${r.status}): ${errBody} \u2014 FALLING BACK to chat/completions without search`);
  const r2 = await fetchWithTimeout(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      thinking: { type: "disabled" }
    })
  });
  if (!r2.ok) throw new Error(`Doubao ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
  const d2 = await r2.json();
  return { text: str(get(get(arr(get(d2, "choices"))[0], "message"), "content")), links: [], usage: readUsage(d2) };
}
async function baidu(prompt) {
  const key = process.env.BAIDU_QIANFAN_API_KEY;
  const model = process.env.BAIDU_MODEL || "ernie-5.1";
  const r = await fetchWithTimeout(ENGINE_ENDPOINTS.baidu, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model, search_source: "baidu_search_v2", stream: false, enable_deep_search: false })
  });
  if (!r.ok) throw new Error(`Baidu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const errMsg = str(get(d, "error_msg")) || str(get(get(d, "error"), "message")) || (get(d, "choices") == null ? str(get(d, "message")) : "");
  if (errMsg) throw new Error(`Baidu ${str(get(d, "error_code")) || str(get(d, "code")) || "error"}: ${errMsg.slice(0, 200)}`);
  const text = str(get(get(arr(get(d, "choices"))[0], "message"), "content"));
  const links = arr(get(d, "references")).map((x) => str(get(x, "url"))).filter(Boolean);
  const usage = readUsage(d);
  return { text, links, ...usage ? { usage: { ...usage, searches: 1, model } } : {} };
}
function activeEngines(market, opts = {}) {
  const next = !!opts.next;
  const all = [];
  if (process.env.OPENAI_API_KEY) all.push({ id: "openai", label: "ChatGPT", region: "west", citesSources: true, query: (p) => openai(p, modelFor("OPENAI_MODEL", "gpt-5.5", next)) });
  if (process.env.PERPLEXITY_API_KEY) all.push({ id: "perplexity", label: "Perplexity", region: "west", citesSources: true, query: perplexity });
  if (process.env.ANTHROPIC_API_KEY && process.env.MEASURE_CLAUDE !== "0") all.push({ id: "claude", label: "Claude", region: "west", citesSources: true, query: (p) => claude(p, next) });
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) all.push({ id: "gemini", label: "Gemini", region: "west", citesSources: true, query: (p) => gemini(p, modelFor("GEMINI_MODEL", "gemini-2.5-flash", next)) });
  if (process.env.XAI_API_KEY) all.push({ id: "grok", label: "Grok", region: "west", citesSources: true, query: grok });
  if (process.env.META_API_KEY && (instrumentSwitched(next) || opts.probe)) all.push({ id: "muse", label: "Muse", region: "west", citesSources: true, query: muse });
  if (process.env.ARK_API_KEY) all.push({ id: "doubao", label: "\u8C46\u5305", region: "cn", citesSources: true, query: doubao });
  if (process.env.DASHSCOPE_API_KEY) all.push({ id: "qwen", label: "\u901A\u4E49\u5343\u95EE", region: "cn", citesSources: false, query: qwen });
  if (process.env.DEEPSEEK_API_KEY) all.push({ id: "deepseek", label: "DeepSeek", region: "cn", citesSources: true, query: deepseek });
  if (process.env.HUNYUAN_API_KEY) all.push({ id: "hunyuan", label: "\u5143\u5B9D", region: "cn", citesSources: true, query: hunyuan });
  if (process.env.MOONSHOT_API_KEY) all.push({ id: "kimi", label: "Kimi", region: "cn", citesSources: false, query: kimi });
  if (process.env.BAIDU_QIANFAN_API_KEY) all.push({ id: "baidu", label: "\u767E\u5EA6", region: "cn", citesSources: true, query: baidu });
  if (!market) return all;
  const regions = market === "china" ? ["cn"] : market === "bilingual" ? ["west", "cn"] : ["west"];
  return all.filter((e) => regions.includes(e.region));
}
var DEFAULT_TIMEOUT_MS, SLOW_TIMEOUT_MS, GEMINI_REDIRECT, QWEN_SEARCH, KIMI_SEARCH_TOOL, DEEPSEEK_SEARCH_URL, DEEPSEEK_SEARCH_TOOL, ANSWER_NOW, DSML, ENGINE_ENDPOINTS;
var init_engines = __esm({
  "src/engines.ts"() {
    "use strict";
    DEFAULT_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS) || 35e3;
    SLOW_TIMEOUT_MS = { deepseek: 18e4, kimi: 17e4, grok: 15e4, doubao: 15e4 };
    GEMINI_REDIRECT = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;
    QWEN_SEARCH = { enable_search: true, search_options: { forced_search: true } };
    KIMI_SEARCH_TOOL = {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for up-to-date information. Use it for anything about specific businesses, places, prices or recent facts.",
        parameters: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] }
      }
    };
    DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
    DEEPSEEK_SEARCH_TOOL = {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for up-to-date information. Use it for anything about specific businesses, places, prices or recent facts.",
        parameters: { type: "object", properties: { query: { type: "string", description: "The search query (at most 128 characters)" } }, required: ["query"] }
      }
    };
    ANSWER_NOW = "Search limit reached. Answer the original question now, using only the search results above. Do not search again. / \u5DF2\u8FBE\u641C\u7D22\u4E0A\u9650\uFF1A\u8BF7\u76F4\u63A5\u6839\u636E\u4EE5\u4E0A\u641C\u7D22\u7ED3\u679C\u56DE\u7B54\u539F\u95EE\u9898\uFF0C\u4E0D\u8981\u518D\u641C\u7D22\u3002";
    DSML = /<[｜|]+\s*DSML\s*[｜|]+/;
    ENGINE_ENDPOINTS = {
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
      muse: process.env.MUSE_URL || "https://api.meta.ai/v1/responses"
    };
  }
});

// src/cli.ts
import { parseArgs } from "node:util";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// src/match.ts
function host(u) {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
var looksLikeHost = (a) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(a.replace(/^https?:\/\//, ""));
function brandTerms(name, site = "", aliases = []) {
  const out = /* @__PURE__ */ new Set();
  const t = name.trim();
  if (t) out.add(t);
  for (const run of t.match(/[㐀-鿿]{2,}/g) ?? []) out.add(run);
  const latin = t.replace(/[㐀-鿿]/g, " ").replace(/\s+/g, " ").trim();
  if (latin.length >= 4) out.add(latin);
  const h = site ? host(site) : "";
  if (h) out.add(h);
  for (const a of aliases) {
    const v = a.trim();
    if (v) out.add(looksLikeHost(v) ? host(v) : v);
  }
  return [...out].filter(Boolean);
}
function matchBrand(text, links, terms) {
  const body = text.toLowerCase();
  return terms.find((term) => {
    const t = term.toLowerCase().trim();
    return !!t && (body.includes(t) || links.some((l) => l.toLowerCase().includes(t)));
  });
}
function linksToSite(links, site) {
  const h = site ? host(site) : "";
  return !!h && links.some((l) => host(l) === h || host(l).endsWith(`.${h}`));
}

// src/cli.ts
var DEFAULTS = {
  OPENAI_MODEL: "gpt-6-luna",
  GEMINI_MODEL: "gemini-3.8-flash",
  CLAUDE_MODEL: "claude-haiku-5-5",
  // Haiku 5.5 with web_search_20260209 errors on most searches (invalid_tool_input, tested 2026-10-23);
  // the 20250305 tool searches reliably. Same setting Avowd production runs.
  CLAUDE_WEBSEARCH_TYPE: "web_search_20250305",
  ENGINE_TIMEOUT_MS: "120000",
  XAI_MODEL: "grok-4.3",
  PERPLEXITY_MODEL: "sonar",
  ARK_MODEL: "doubao-seed-evolving",
  KIMI_MODEL: "kimi-k2.6",
  KIMI_URL: "https://api.moonshot.ai/v1/chat/completions",
  QWEN_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  MUSE_MODEL: "muse-spark-1.3",
  MODEL_SWITCH_AT: "2026-10-01T00:00:00Z"
};
for (const [k, v] of Object.entries(DEFAULTS)) process.env[k] ??= v;
if (process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
var ENGINE_KEYS = [
  ["openai", "ChatGPT", "OPENAI_API_KEY"],
  ["perplexity", "Perplexity", "PERPLEXITY_API_KEY"],
  ["claude", "Claude", "ANTHROPIC_API_KEY"],
  ["gemini", "Gemini", "GEMINI_API_KEY"],
  ["grok", "Grok", "XAI_API_KEY"],
  ["muse", "Muse (Meta)", "META_API_KEY"],
  ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY"],
  ["kimi", "Kimi", "MOONSHOT_API_KEY"],
  ["qwen", "Qwen \u901A\u4E49", "DASHSCOPE_API_KEY"],
  ["doubao", "Doubao \u8C46\u5305", "ARK_API_KEY"],
  ["hunyuan", "Yuanbao \u5143\u5B9D", "HUNYUAN_API_KEY"],
  ["baidu", "Baidu \u767E\u5EA6", "BAIDU_QIANFAN_API_KEY"]
];
var HELP = `does-ai-know-you \u2014 do AI engines recommend your brand?

Usage
  npx does-ai-know-you --brand "Your Brand" --site yourbrand.com \\
      --ask "best <your category> in <your city>" --ask "<the same question in Chinese>"

Options
  --brand <name>      Brand name. Bilingual names work: "\u751C\u5C51 Sweet Crumb"
  --site <domain>     Your website (also counts as a mention, and checks citations)
  --alias <name>      Another name the brand goes by (repeatable)
  --ask <question>    A question a customer would type, WITHOUT your brand name (repeatable)
  --questions <file>  One question per line
  --reps <n>          Ask each question n times per engine (default 1; answers vary run to run)
  --engines <ids>     Only these, comma-separated: ${ENGINE_KEYS.map((e) => e[0]).join(",")}
  --out <dir>         Where to save answers (default ./does-ai-know-you-<timestamp>)
  --json              Print the result as JSON
  --list              Show which engines have a key set, then exit

Keys are read from the environment (or a .env file in the current folder):
  ${ENGINE_KEYS.map((e) => e[2]).join(" ")}
Engines without a key are skipped. Each answer costs a fraction of a cent to a few cents on your own keys.
`;
function loadDotEnv() {
  const p = resolve(".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
var pct = (a, b) => b ? Math.round(a / b * 1e3) / 10 : 0;
async function main() {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      brand: { type: "string" },
      site: { type: "string", default: "" },
      alias: { type: "string", multiple: true, default: [] },
      ask: { type: "string", multiple: true, default: [] },
      questions: { type: "string" },
      reps: { type: "string", default: "1" },
      engines: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) return void console.log(HELP);
  if (values.list) {
    for (const [id, label, key] of ENGINE_KEYS) console.log(`${process.env[key] ? "\u2713" : "\xB7"} ${label.padEnd(14)} ${id.padEnd(11)} ${key}`);
    return;
  }
  const { activeEngines: activeEngines2 } = await Promise.resolve().then(() => (init_engines(), engines_exports));
  const brand = values.brand?.trim();
  const questions = [...values.ask, ...values.questions ? readFileSync(values.questions, "utf8").split(/\r?\n/) : []].map((q) => q.trim()).filter(Boolean);
  if (!brand || !questions.length) {
    console.error(HELP);
    process.exit(1);
  }
  const terms = brandTerms(brand, values.site, values.alias);
  for (const q of questions) {
    const hit = matchBrand(q, [], terms);
    if (hit) console.error(`\u26A0 "${q}" contains "${hit}". Ask the way a customer who has never heard of you would \u2014 otherwise every engine "knows" you.`);
  }
  const reps = Math.max(1, Math.min(5, parseInt(values.reps, 10) || 1));
  const only = values.engines?.split(",").map((s) => s.trim()).filter(Boolean);
  const engines = activeEngines2().filter((e) => !only?.length || only.includes(e.id));
  if (!engines.length) {
    console.error("No engine has an API key. Set at least one of:\n  " + ENGINE_KEYS.map((e) => e[2]).join(" "));
    process.exit(1);
  }
  const tasks = engines.flatMap((e) => questions.flatMap((_, q) => Array.from({ length: reps }, (_2, rep) => ({ e, q, rep }))));
  if (!values.json) console.error(`Asking ${engines.length} engine(s) \xD7 ${questions.length} question(s) \xD7 ${reps} = ${tasks.length} answers\u2026`);
  const cells = [];
  let done = 0;
  await pool(tasks, 8, async ({ e, q, rep }) => {
    const t0 = Date.now();
    try {
      const a = await e.query(questions[q]);
      const named = matchBrand(a.text, a.links, terms);
      cells.push({
        engine: e.id,
        label: e.label,
        region: e.region,
        q,
        rep,
        ok: true,
        named,
        linked: linksToSite(a.links, values.site),
        text: a.text,
        links: a.links,
        ms: Date.now() - t0
      });
    } catch (err) {
      cells.push({ engine: e.id, label: e.label, region: e.region, q, rep, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
    }
    if (!values.json) process.stderr.write(`\r  ${++done}/${tasks.length}`);
  });
  if (!values.json) process.stderr.write("\n");
  const rows = engines.map((e) => {
    const mine = cells.filter((c) => c.engine === e.id);
    const ok = mine.filter((c) => c.ok);
    return {
      id: e.id,
      label: e.label,
      region: e.region,
      answered: ok.length,
      asked: mine.length,
      named: ok.filter((c) => c.named).length,
      linked: ok.filter((c) => c.linked).length,
      perQuestion: questions.map((_, q) => {
        const c = ok.filter((x) => x.q === q);
        return c.length ? `${c.filter((x) => x.named).length}/${c.length}` : "err";
      }),
      error: mine.find((c) => !c.ok)?.error
    };
  });
  const result = { brand, site: values.site || null, terms, questions, reps, at: (/* @__PURE__ */ new Date()).toISOString(), engines: rows };
  const stamp = result.at.slice(0, 16).replace(/[-:T]/g, "");
  const dir = values.out ?? `does-ai-know-you-${stamp}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "answers.jsonl"), cells.sort((a, b) => a.engine.localeCompare(b.engine) || a.q - b.q || a.rep - b.rep).map((c) => JSON.stringify({ ...c, question: questions[c.q] })).join("\n") + "\n");
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(dir, "report.md"), report(result));
  if (values.json) return void console.log(JSON.stringify(result, null, 2));
  console.log("\n" + table(result));
  console.log(`
Every answer, word for word: ${join(dir, "answers.jsonl")}`);
  console.log(`
One check is a snapshot \u2014 answers change week to week, and most of what moves them happens off your site.`);
  console.log(`Track this monthly across 12 engines, with the fixes done for you: https://avowd.ai`);
}
function table(r) {
  const lines = [`"${r.brand}" \u2014 named in how many answers, per engine and question`, ""];
  const qs = r.questions.map((_, i) => `Q${i + 1}`);
  lines.push(["Engine".padEnd(15), ...qs.map((q) => q.padStart(5)), "  named", "  links to site"].join(""));
  for (const region of ["west", "cn"]) {
    const group = r.engines.filter((e) => e.region === region);
    if (!group.length) continue;
    for (const e of group) {
      if (!e.answered) {
        lines.push(`${e.label.padEnd(15)} failed: ${(e.error ?? "").slice(0, 70)}`);
        continue;
      }
      lines.push([e.label.padEnd(15), ...e.perQuestion.map((p) => p.padStart(5)), `  ${String(pct(e.named, e.answered)).padStart(5)}%`, `  ${String(pct(e.linked, e.answered)).padStart(5)}%`].join(""));
    }
    const a = group.reduce((s, e) => s + e.answered, 0), n = group.reduce((s, e) => s + e.named, 0);
    lines.push(`${(region === "west" ? "  Western engines" : "  Chinese engines").padEnd(15 + 5 * qs.length)}  ${String(pct(n, a)).padStart(5)}%`, "");
  }
  r.questions.forEach((q, i) => lines.push(`Q${i + 1}  ${q}`));
  return lines.join("\n");
}
function report(r) {
  const md = [
    `# Does AI know "${r.brand}"?`,
    "",
    `Checked ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)} \xB7 ${r.reps} answer(s) per engine per question`,
    "",
    `| Engine | ${r.questions.map((_, i) => `Q${i + 1}`).join(" | ")} | Named | Links to site |`,
    `| --- | ${r.questions.map(() => "---").join(" | ")} | --- | --- |`
  ];
  for (const e of r.engines) md.push(`| ${e.label} | ${e.perQuestion.join(" | ")} | ${e.answered ? pct(e.named, e.answered) + "%" : "failed"} | ${e.answered ? pct(e.linked, e.answered) + "%" : ""} |`);
  md.push("", ...r.questions.map((q, i) => `- **Q${i + 1}** ${q}`), "", "---", "Made with [does-ai-know-you](https://github.com/Hellotravisss/does-ai-know-you) by [Avowd](https://avowd.ai) \u2014 monthly AI-visibility tracking across 12 engines, Western and Chinese.");
  return md.join("\n") + "\n";
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
