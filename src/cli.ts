#!/usr/bin/env node
// does-ai-know-you — ask up to 11 AI engines (Western and Chinese) the questions your customers ask,
// and see which of them name your brand. By Avowd (https://avowd.ai). MIT licensed.

import { parseArgs } from "node:util";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { brandTerms, matchBrand, linksToSite } from "./match";

// Default models = what Avowd's production measurement runs (Oct 2026). Override any of them with
// the same environment variable, e.g. OPENAI_MODEL=gpt-5.5.
const DEFAULTS: Record<string, string> = {
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
  MODEL_SWITCH_AT: "2026-10-01T00:00:00Z",
};
for (const [k, v] of Object.entries(DEFAULTS)) process.env[k] ??= v;
if (process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;

const ENGINE_KEYS: [string, string, string][] = [
  ["openai", "ChatGPT", "OPENAI_API_KEY"], ["perplexity", "Perplexity", "PERPLEXITY_API_KEY"],
  ["claude", "Claude", "ANTHROPIC_API_KEY"], ["gemini", "Gemini", "GEMINI_API_KEY"],
  ["grok", "Grok", "XAI_API_KEY"], ["muse", "Muse (Meta)", "META_API_KEY"],
  ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY"], ["kimi", "Kimi", "MOONSHOT_API_KEY"],
  ["qwen", "Qwen 通义", "DASHSCOPE_API_KEY"], ["doubao", "Doubao 豆包", "ARK_API_KEY"],
  ["hunyuan", "Yuanbao 元宝", "HUNYUAN_API_KEY"], ["baidu", "Baidu 百度", "BAIDU_QIANFAN_API_KEY"],
];

const HELP = `does-ai-know-you — do AI engines recommend your brand?

Usage
  npx does-ai-know-you --brand "Your Brand" --site yourbrand.com \\
      --ask "best <your category> in <your city>" --ask "<the same question in Chinese>"

Options
  --brand <name>      Brand name. Bilingual names work: "甜屑 Sweet Crumb"
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

type Cell = { engine: string; label: string; region: string; q: number; rep: number; ok: boolean;
  named?: string; linked?: boolean; text?: string; links?: string[]; error?: string; ms: number };

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

async function main() {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      brand: { type: "string" }, site: { type: "string", default: "" },
      alias: { type: "string", multiple: true, default: [] }, ask: { type: "string", multiple: true, default: [] },
      questions: { type: "string" }, reps: { type: "string", default: "1" }, engines: { type: "string" },
      out: { type: "string" }, json: { type: "boolean", default: false }, list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return void console.log(HELP);
  if (values.list) {
    for (const [id, label, key] of ENGINE_KEYS) console.log(`${process.env[key] ? "✓" : "·"} ${label.padEnd(14)} ${id.padEnd(11)} ${key}`);
    return;
  }

  const { activeEngines } = await import("./engines");
  const brand = values.brand?.trim();
  const questions = [...values.ask!, ...(values.questions ? readFileSync(values.questions, "utf8").split(/\r?\n/) : [])]
    .map((q) => q.trim()).filter(Boolean);
  if (!brand || !questions.length) {
    console.error(HELP);
    process.exit(1);
  }
  const terms = brandTerms(brand, values.site, values.alias);
  // Rule one: a question that contains the brand name measures nothing.
  for (const q of questions) {
    const hit = matchBrand(q, [], terms);
    if (hit) console.error(`⚠ "${q}" contains "${hit}". Ask the way a customer who has never heard of you would — otherwise every engine "knows" you.`);
  }
  const reps = Math.max(1, Math.min(5, parseInt(values.reps!, 10) || 1));
  const only = values.engines?.split(",").map((s) => s.trim()).filter(Boolean);
  const engines = activeEngines().filter((e) => !only?.length || only.includes(e.id));
  if (!engines.length) {
    console.error("No engine has an API key. Set at least one of:\n  " + ENGINE_KEYS.map((e) => e[2]).join(" "));
    process.exit(1);
  }

  const tasks = engines.flatMap((e) => questions.flatMap((_, q) => Array.from({ length: reps }, (_, rep) => ({ e, q, rep }))));
  if (!values.json) console.error(`Asking ${engines.length} engine(s) × ${questions.length} question(s) × ${reps} = ${tasks.length} answers…`);
  const cells: Cell[] = [];
  let done = 0;
  await pool(tasks, 8, async ({ e, q, rep }) => {
    const t0 = Date.now();
    try {
      const a = await e.query(questions[q]);
      const named = matchBrand(a.text, a.links, terms);
      cells.push({ engine: e.id, label: e.label, region: e.region, q, rep, ok: true, named, linked: linksToSite(a.links, values.site!),
        text: a.text, links: a.links, ms: Date.now() - t0 });
    } catch (err) {
      cells.push({ engine: e.id, label: e.label, region: e.region, q, rep, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
    }
    if (!values.json) process.stderr.write(`\r  ${++done}/${tasks.length}`);
  });
  if (!values.json) process.stderr.write("\n");

  // Summary per engine
  const rows = engines.map((e) => {
    const mine = cells.filter((c) => c.engine === e.id);
    const ok = mine.filter((c) => c.ok);
    return { id: e.id, label: e.label, region: e.region, answered: ok.length, asked: mine.length,
      named: ok.filter((c) => c.named).length, linked: ok.filter((c) => c.linked).length,
      perQuestion: questions.map((_, q) => { const c = ok.filter((x) => x.q === q); return c.length ? `${c.filter((x) => x.named).length}/${c.length}` : "err"; }),
      error: mine.find((c) => !c.ok)?.error };
  });
  const result = { brand, site: values.site || null, terms, questions, reps, at: new Date().toISOString(), engines: rows };

  // Save every answer — numbers you can't re-check are numbers you shouldn't trust.
  const stamp = result.at.slice(0, 16).replace(/[-:T]/g, "");
  const dir = values.out ?? `does-ai-know-you-${stamp}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "answers.jsonl"), cells.sort((a, b) => a.engine.localeCompare(b.engine) || a.q - b.q || a.rep - b.rep)
    .map((c) => JSON.stringify({ ...c, question: questions[c.q] })).join("\n") + "\n");
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(dir, "report.md"), report(result));

  if (values.json) return void console.log(JSON.stringify(result, null, 2));
  console.log("\n" + table(result));
  console.log(`\nEvery answer, word for word: ${join(dir, "answers.jsonl")}`);
  console.log(`\nOne check is a snapshot — answers change week to week, and most of what moves them happens off your site.`);
  console.log(`Track this monthly across 12 engines, with the fixes done for you: https://avowd.ai`);
}

type Result = { brand: string; questions: string[]; reps: number; engines: { label: string; region: string; answered: number; asked: number; named: number; linked: number; perQuestion: string[]; error?: string }[] };

function table(r: Result): string {
  const lines = [`"${r.brand}" — named in how many answers, per engine and question`, ""];
  const qs = r.questions.map((_, i) => `Q${i + 1}`);
  lines.push(["Engine".padEnd(15), ...qs.map((q) => q.padStart(5)), "  named", "  links to site"].join(""));
  for (const region of ["west", "cn"]) {
    const group = r.engines.filter((e) => e.region === region);
    if (!group.length) continue;
    for (const e of group) {
      if (!e.answered) { lines.push(`${e.label.padEnd(15)} failed: ${(e.error ?? "").slice(0, 70)}`); continue; }
      lines.push([e.label.padEnd(15), ...e.perQuestion.map((p) => p.padStart(5)), `  ${String(pct(e.named, e.answered)).padStart(5)}%`, `  ${String(pct(e.linked, e.answered)).padStart(5)}%`].join(""));
    }
    const a = group.reduce((s, e) => s + e.answered, 0), n = group.reduce((s, e) => s + e.named, 0);
    lines.push(`${(region === "west" ? "  Western engines" : "  Chinese engines").padEnd(15 + 5 * qs.length)}  ${String(pct(n, a)).padStart(5)}%`, "");
  }
  r.questions.forEach((q, i) => lines.push(`Q${i + 1}  ${q}`));
  return lines.join("\n");
}

function report(r: Result): string {
  const md = [`# Does AI know "${r.brand}"?`, "", `Checked ${new Date().toISOString().slice(0, 10)} · ${r.reps} answer(s) per engine per question`, "",
    `| Engine | ${r.questions.map((_, i) => `Q${i + 1}`).join(" | ")} | Named | Links to site |`,
    `| --- | ${r.questions.map(() => "---").join(" | ")} | --- | --- |`];
  for (const e of r.engines) md.push(`| ${e.label} | ${e.perQuestion.join(" | ")} | ${e.answered ? pct(e.named, e.answered) + "%" : "failed"} | ${e.answered ? pct(e.linked, e.answered) + "%" : ""} |`);
  md.push("", ...r.questions.map((q, i) => `- **Q${i + 1}** ${q}`), "", "---", "Made with [does-ai-know-you](https://github.com/Hellotravisss/does-ai-know-you) by [Avowd](https://avowd.ai) — monthly AI-visibility tracking across 12 engines, Western and Chinese.");
  return md.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
