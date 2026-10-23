# does-ai-know-you

**Ask ChatGPT, Claude, Gemini, Perplexity, Grok — and DeepSeek, Kimi, Qwen, Doubao, Yuanbao — the questions your customers ask. See which ones name your brand.**

[中文说明](README.zh-CN.md)

```bash
npx does-ai-know-you --brand "Sweet Crumb 甜屑" --site sweetcrumb.example \
  --ask "best bakery in Burnaby for birthday cakes" --ask "本拿比哪家生日蛋糕好"
```

> Not on npm yet? Run it straight from GitHub: `npx github:Hellotravisss/does-ai-know-you --brand …`

```
"Sweet Crumb 甜屑" — named in how many answers, per engine and question

Engine            Q1   Q2  named  links to site
ChatGPT          1/1  0/1     50%      0%
Perplexity       1/1  1/1    100%     50%
Gemini           1/1  0/1     50%      0%
  Western engines              67%
DeepSeek         0/1  0/1      0%      0%
Kimi             0/1  1/1     50%      0%
  Chinese engines              25%
```

*(Illustrative output for a made-up bakery — run it on your own brand for real numbers.)*

## Why this exists

Most "AI visibility" tools — and most free SEO plugins — score whether your site *looks* citable. That is a guess. This tool asks the engines and records what they actually say, word for word.

And almost none of them ask the **Chinese** engines. If some of your customers ask in Chinese, DeepSeek, Kimi, Qwen, Doubao and Yuanbao are where they ask — and whether they know a North American business is a question you can now answer for yourself instead of guessing.

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
