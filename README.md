# does-ai-know-you

<p align="center"><img src="assets/hero.svg" alt="Does AI know you? Share of AI answers that named one bakery, across 11 engines" width="100%"></p>

<p align="center">
<img alt="MIT" src="https://img.shields.io/badge/license-MIT-1A1408?style=flat-square">
<img alt="12 engines" src="https://img.shields.io/badge/engines-6%20Western%20%2B%206%20Chinese-F0531C?style=flat-square">
<img alt="web search on" src="https://img.shields.io/badge/web%20search-on-F7C63F?style=flat-square">
<img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-7A6B4C?style=flat-square">
</p>


**Ask ChatGPT, Claude, Gemini, Perplexity, Grok — and DeepSeek, Kimi, Qwen, Doubao, Yuanbao, Baidu — the questions your customers ask. See which ones name your brand.**

[中文说明](README.zh-CN.md)

```bash
npx does-ai-know-you --brand "Sweet Crumb 甜屑" --site sweetcrumb.example \
  --ask "best bakery in Burnaby for birthday cakes" --ask "本拿比哪家生日蛋糕好"
```

> Not on npm yet? Run it straight from GitHub: `npx github:Hellotravisss/does-ai-know-you --brand …`

## A real result

[SAVORHILL 山也](https://savorhill.ca), a bakery and tea house in Richmond, BC, measured by Avowd in October 2026: 20 customer questions (half English, half Chinese, e.g. *"Best bubble tea in Richmond BC"*, *"Where can I buy meat floss cake (肉松蛋糕) in Richmond BC?"*), each asked twice on all 11 engines, 440 answers.

| Engine | Named the bakery | Linked to savorhill.ca |
| --- | --- | --- |
| ChatGPT | 50% | 47.5% |
| Perplexity | 20% | 20% |
| Claude | 27.5% | 20% |
| Gemini | 42.5% | 27.5% |
| Grok | 47.5% | 37.5% |
| Muse (Meta) | 35% | 0% |
| DeepSeek | 5% | 0% |
| Kimi | 22.5% | 0% |
| Qwen 通义 | 5% | 0% |
| Doubao 豆包 | 5% | 0% |
| Yuanbao 元宝 | 5% | 0% |

Published with the owner's permission. **Read the Chinese rows carefully:** in this run Qwen, Doubao and Yuanbao answered *without* live web search (it was switched on a few hours later), and DeepSeek's API has no web search at all. So those rows show what the models already knew, while every Western engine searched the web. November's run, with search on for all three, is the fair comparison — we'll update this table.

<p align="center"><img src="assets/demo.svg" alt="Terminal: does-ai-know-you run on SAVORHILL, 440 answers" width="100%"></p>

Reproduce part of it yourself:

```bash
npx does-ai-know-you --brand "SAVORHILL 山也" --site savorhill.ca \
  --ask "Best bubble tea in Richmond BC" --ask "列治文哪家奶茶好喝" --reps 2
```

## Why this exists

Most "AI visibility" tools — and most free SEO plugins — score whether your site *looks* citable. That is a guess. This tool asks the engines and records what they actually say, word for word.

And almost none of them ask the **Chinese** engines. If some of your customers ask in Chinese, DeepSeek, Kimi, Qwen, Doubao, Yuanbao and Baidu are where they ask — and whether they know a North American business is a question you can now answer for yourself instead of guessing.

## What it does

- Asks each question to every engine you have a key for, **with web search on** — the same calls, models and settings as [Avowd](https://avowd.ai)'s monthly measurement.
- Counts an answer as naming you if it contains your name, either half of a bilingual name (`甜屑` or `Sweet Crumb`), your domain, or an `--alias`.
- Shows separately whether the engine **linked to your site** — being named and being cited are different things.
- Saves **every answer and every cited URL** to `answers.jsonl`, plus `report.md` and `result.json`. A number you can't re-check is a number you shouldn't trust.
- Warns you when a question contains your own brand name. "What is Acme?" tells you an engine can read your homepage; "Where do I buy X near Y?" tells you whether it recommends you to someone who has never heard of you. Only the second one is worth anything.

## Keys

Use your own API keys. Put them in the environment or a `.env` file in the folder you run from. Any subset works; engines without a key are skipped.

| Engine | Variable | Get a key |
| --- | --- | --- |
| ChatGPT | `OPENAI_API_KEY` | platform.openai.com |
| Perplexity | `PERPLEXITY_API_KEY` | perplexity.ai/settings/api |
| Claude | `ANTHROPIC_API_KEY` | platform.claude.com |
| Gemini | `GEMINI_API_KEY` | aistudio.google.com |
| Grok | `XAI_API_KEY` | console.x.ai |
| Muse (Meta) | `META_API_KEY` | Meta developer platform |
| DeepSeek | `DEEPSEEK_API_KEY` | platform.deepseek.com |
| Kimi | `MOONSHOT_API_KEY` | platform.moonshot.ai |
| Qwen 通义 | `DASHSCOPE_API_KEY` | Alibaba Cloud Model Studio |
| Doubao 豆包 | `ARK_API_KEY` | Volcengine Ark |
| Yuanbao 元宝 | `HUNYUAN_API_KEY` | Tencent Cloud |
| Baidu 百度 | `BAIDU_QIANFAN_API_KEY` | Baidu Qianfan (mainland real-name account; turn on BOTH post-paid switches — tools quota and model service) |

Mainland-China Kimi or Qwen accounts: set `KIMI_URL=https://api.moonshot.cn/v1/chat/completions` or `QWEN_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`.

Cost: on your own keys, a fraction of a cent to a few cents per answer. Grok and Perplexity are the most expensive because they read many pages per answer.

## Options

```
--brand <name>      Brand name (bilingual names work)
--site <domain>     Your website
--alias <name>      Another name you go by (repeatable)
--ask <question>    A customer's question, without your name (repeatable)
--questions <file>  One question per line
--reps <n>          Ask each question n times per engine (default 1)
--engines <ids>     Only some engines: openai,perplexity,claude,gemini,grok,muse,deepseek,kimi,qwen,doubao,hunyuan
--out <dir>         Where to save answers
--json              Print JSON
--list              Show which engines have a key
```

Models default to what Avowd measures with (October 2026); override with `OPENAI_MODEL`, `GEMINI_MODEL`, `CLAUDE_MODEL`, `XAI_MODEL`, `PERPLEXITY_MODEL`, `ARK_MODEL`, `KIMI_MODEL`.

## Use it from Claude Code

Copy `skill/` into `~/.claude/skills/does-ai-know-you/`, then ask Claude: *"Does AI know my bakery? We're Sweet Crumb in Burnaby, sweetcrumb.ca."* Claude drafts customer-style questions in English and Chinese, runs the check, and explains the result.

## Read the result honestly

- **One run is a snapshot.** Answers change from run to run and week to week. Use `--reps 2` or more before drawing conclusions, and compare runs over months, not minutes.
- **A few questions are not a measurement.** Twenty questions asked twice across every engine, every month, with the questions held fixed, is a measurement. That is what Avowd runs.
- **Never put your brand name in the question.**

## Made by Avowd

[Avowd](https://avowd.ai) measures brands across 11 AI engines, Western and Chinese, every month, and does the work that moves the numbers — most of which happens off your website. How we measure: [avowd.ai/method](https://avowd.ai/method).

MIT licensed.
