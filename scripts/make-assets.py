#!/usr/bin/env python3
"""Builds assets/hero.svg and assets/demo.svg — animated, self-contained SVGs for the README.

Data: SAVORHILL 山也 (Richmond, BC), Avowd's October 2026 measurement — 20 questions × 2 × 11 engines,
published with the owner's permission. Update DATA after each month's run and re-run this script.
Usage: python3 scripts/make-assets.py path/to/sextant-ink.png
"""
import base64, sys, pathlib

CREAM, INK, DIM, ORANGE, AMBER, BUTTER = "#FBF5E7", "#1A1408", "#7A6B4C", "#F0531C", "#F7C63F", "#FDF0C4"
SERIF = "Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, 'Songti SC', serif"
SANS = "'Avenir Next', 'Helvetica Neue', 'PingFang SC', 'Noto Sans CJK SC', Arial, sans-serif"
MONO = "'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'PingFang SC', monospace"

# (label, region, mentioned %, linked %)
DATA = [
    ("ChatGPT", "west", 50, 47.5), ("Grok", "west", 47.5, 37.5), ("Gemini", "west", 42.5, 27.5),
    ("Muse · Meta", "west", 35, 0), ("Claude", "west", 27.5, 20), ("Perplexity", "west", 20, 20),
    ("Kimi", "cn", 22.5, 0), ("DeepSeek", "cn", 5, 0), ("Qwen 通义", "cn", 5, 0),
    ("Doubao 豆包", "cn", 5, 0), ("Yuanbao 元宝", "cn", 5, 0),
]
SOURCE = "SAVORHILL 山也 · Richmond BC · Avowd measurement, Oct 2026 · 440 answers · published with permission"
CAVEAT = "Qwen, Doubao, Yuanbao answered without live web search in this run; DeepSeek’s API has none."


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def ticks() -> str:
    """Graduated scale around the instrument: a long tick every 10°, short ones every 2°."""
    import math
    out = []
    for d in range(0, 360, 2):
        a = math.radians(d)
        r1 = 188 if d % 10 == 0 else 192
        x1, y1 = 240 + r1 * math.cos(a), 296 + r1 * math.sin(a)
        x2, y2 = 240 + 196 * math.cos(a), 296 + 196 * math.sin(a)
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"/>')
    return f'<g stroke="{INK}" stroke-width=".6" opacity=".45">{"".join(out)}</g>'


def hero(img_b64: str) -> str:
    W, H = 1200, 640
    loop = 12  # seconds
    rows, y0, rh = [], 268, 27
    bar_x, bar_max = 760, 330  # 50% fills the track
    for i, (label, region, m, l) in enumerate(DATA):
        y = y0 + i * rh + (14 if region == "cn" else 0)
        color = INK if region == "west" else ORANGE
        w = bar_max * m / 50
        lw = bar_max * l / 50
        d = 1.6 + i * 0.18
        rows.append(f'''
  <text x="{bar_x - 14}" y="{y + 13}" text-anchor="end" class="lab">{esc(label)}</text>
  <rect x="{bar_x}" y="{y + 2}" width="{bar_max}" height="15" fill="{BUTTER}" opacity=".55"/>
  <g class="grow" style="animation-delay:{d:.2f}s"><rect x="{bar_x}" y="{y + 2}" width="{w:.1f}" height="15" fill="{color}"/>
  {"" if lw == 0 else f'<rect x="{bar_x}" y="{y + 14}" width="{lw:.1f}" height="4" fill="{AMBER}"/>'}</g>
  <text x="{bar_x + w + 8:.1f}" y="{y + 14}" class="val fade" style="animation-delay:{d + .5:.2f}s">{m:g}%</text>''')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Does AI know you? Share of AI answers that named one bakery, by engine.">
<style>
  .t{{font-family:{SERIF};fill:{INK}}} .s{{font-family:{SANS};fill:{INK}}} .m{{font-family:{MONO};fill:{INK}}}
  .lab{{font:500 14px {SANS};fill:{INK}}} .val{{font:600 13px {MONO};fill:{INK}}}
  .grow{{transform-box:fill-box;transform-origin:left center;animation:grow {loop}s cubic-bezier(.2,.8,.2,1) infinite}}
  .fade{{animation:fade {loop}s ease infinite}}
  .type{{animation:type {loop}s steps(38,end) infinite}}
  .caret{{animation:blink .9s steps(1) infinite}}
  @keyframes grow{{0%{{transform:scaleX(0)}}14%{{transform:scaleX(1)}}88%{{transform:scaleX(1)}}96%,100%{{transform:scaleX(0)}}}}
  @keyframes fade{{0%,6%{{opacity:0}}14%,88%{{opacity:1}}96%,100%{{opacity:0}}}}
  @keyframes type{{0%{{width:0}}12%,92%{{width:470px}}98%,100%{{width:0}}}}
  .spin{{animation:spin 120s linear infinite}}
  .arc{{animation:arc {loop}s cubic-bezier(.4,0,.2,1) infinite}}
  @keyframes spin{{to{{transform:rotate(360deg)}}}}
  @keyframes arc{{0%{{stroke-dashoffset:100}}30%,88%{{stroke-dashoffset:62}}96%,100%{{stroke-dashoffset:100}}}}
  @keyframes blink{{50%{{opacity:0}}}}
  @media (prefers-reduced-motion:reduce){{.grow,.fade,.type,.caret,.spin,.arc{{animation:none}}}}
</style>
<rect width="{W}" height="{H}" fill="{CREAM}"/>
<rect x="18" y="18" width="{W - 36}" height="{H - 36}" fill="none" stroke="{INK}" stroke-width="2"/>
<rect x="26" y="26" width="{W - 52}" height="{H - 52}" fill="none" stroke="{INK}" stroke-width=".7"/>
<g class="spin" style="transform-origin:240px 296px">
  <circle cx="240" cy="296" r="196" fill="none" stroke="{INK}" stroke-width=".6" opacity=".35"/>
  {ticks()}
</g>
<circle cx="240" cy="296" r="208" fill="none" stroke="{ORANGE}" stroke-width="1.4" class="arc" pathLength="100" stroke-dasharray="100" transform="rotate(-90 240 296)"/>
<image x="40" y="96" width="400" height="400" href="data:image/png;base64,{img_b64}"/>
<text x="240" y="548" text-anchor="middle" class="s" style="font-size:11px;letter-spacing:4px;fill:{DIM}">THE INSTRUMENT</text>
<text x="490" y="80" class="s" style="font-size:12px;letter-spacing:4px;fill:{ORANGE};font-weight:600">AVOWD · OPEN SOURCE · MIT</text>
<text x="488" y="138" class="t" style="font-size:58px">Does AI know you?</text>
<text x="490" y="172" class="s" style="font-size:17px;fill:{DIM}">Ask 11 AI engines — Western and Chinese — the questions your customers ask.</text>
<rect x="490" y="196" width="490" height="38" fill="{INK}"/>
<text x="504" y="221" class="m" style="font-size:15px;fill:{AMBER}">›</text>
<svg x="522" y="200" width="470" height="30"><g class="type"><svg width="470" height="30"><text x="0" y="21" class="m" style="font-size:15px;fill:{CREAM}">best bakery for birthday cakes in Richmond BC</text></svg></g></svg>
<rect x="962" y="205" width="9" height="20" fill="{AMBER}" class="caret"/>
<text x="1000" y="212" class="s" style="font-size:11px;fill:{DIM};letter-spacing:2px">SHARE OF ANSWERS</text>
<text x="1000" y="228" class="s" style="font-size:11px;fill:{DIM};letter-spacing:2px">THAT NAMED IT</text>
<rect x="{bar_x + bar_max - 150}" y="250" width="14" height="4" fill="{AMBER}"/>
<text x="{bar_x + bar_max}" y="256" text-anchor="end" class="s" style="font-size:11px;fill:{DIM}">= also linked its site</text>
<text x="{bar_x - 14}" y="258" text-anchor="end" class="s" style="font-size:11px;letter-spacing:3px;fill:{DIM}">WESTERN</text>
<text x="{bar_x - 14}" y="{y0 + 6 * rh + 10}" text-anchor="end" class="s" style="font-size:11px;letter-spacing:3px;fill:{ORANGE}">CHINESE</text>
{"".join(rows)}
<text x="40" y="{H - 58}" class="s" style="font-size:11.5px;fill:{DIM}">{esc(SOURCE)}</text>
<text x="40" y="{H - 40}" class="s" style="font-size:11.5px;fill:{DIM}">{esc(CAVEAT)}</text>
</svg>
'''


def demo() -> str:
    W, H = 1200, 600
    loop = 16
    cmd = 'npx does-ai-know-you --brand "SAVORHILL 山也" --site savorhill.ca \\'
    cmd2 = '    --questions savorhill-20.txt --reps 2     # 20 customer questions, EN + 中文'
    lines = [
        ("dim", "Asking 11 engine(s) × 20 question(s) × 2 = 440 answers…"),
        ("dim", "  440/440"),
        ("", ""),
        ("hd", '"SAVORHILL 山也" — named in how many answers, per engine'),
        ("", ""),
        ("hd2", ("Engine", "named", "linked to site")),
    ]
    for label, region, m, l in DATA:
        lines.append(("cn" if region == "cn" else "row", (label, f"{m:g}%", f"{l:g}%")))
    lines += [("", ""), ("ok", "Every answer, word for word: does-ai-know-you-202610/answers.jsonl")]
    out, y = [], 150
    for i, (cls, txt) in enumerate(lines):
        d = 2.8 + i * 0.16
        if isinstance(txt, tuple):
            label, m, l = txt
            out.append(f'<g class="ln {cls}" style="animation-delay:{d:.2f}s"><text x="44" y="{y}">{esc(label)}</text>'
                       f'<text x="270" y="{y}" text-anchor="end">{m}</text><text x="430" y="{y}" text-anchor="end">{l}</text></g>')
        elif txt:
            out.append(f'<text x="44" y="{y}" class="ln {cls}" style="animation-delay:{d:.2f}s">{esc(txt)}</text>')
        y += 20
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Terminal demo of does-ai-know-you">
<style>
  text{{font-family:{MONO};font-size:15px;white-space:pre}}
  .p{{fill:{AMBER}}} .c{{fill:{CREAM}}} .dim{{fill:{DIM}}} .hd{{fill:{CREAM};font-weight:700}} .hd2{{fill:{DIM}}}
  .row text,.row{{fill:{CREAM}}} .cn text,.cn{{fill:{ORANGE}}} .hd2 text{{fill:{DIM}}} .ok{{fill:{AMBER}}}
  .ln{{opacity:0;animation:ln {loop}s linear infinite}}
  .type1{{animation:t1 {loop}s steps(70,end) infinite}} .type2{{animation:t2 {loop}s steps(70,end) infinite}}
  @keyframes ln{{0%{{opacity:0}}1%,90%{{opacity:1}}94%,100%{{opacity:0}}}}
  @keyframes t1{{0%{{width:0}}9%,90%{{width:1100px}}94%,100%{{width:0}}}}
  @keyframes t2{{0%,9%{{width:0}}16%,90%{{width:1100px}}94%,100%{{width:0}}}}
  @media (prefers-reduced-motion:reduce){{.ln,.type1,.type2{{animation:none;opacity:1}}}}
</style>
<rect width="{W}" height="{H}" rx="14" fill="{INK}"/>
<circle cx="34" cy="30" r="7" fill="#3a3122"/><circle cx="58" cy="30" r="7" fill="#3a3122"/><circle cx="82" cy="30" r="7" fill="#3a3122"/>
<text x="{W / 2}" y="35" text-anchor="middle" class="dim" style="font-size:12px;letter-spacing:3px">does-ai-know-you</text>
<text x="44" y="84" class="p">$</text>
<svg x="66" y="66" width="1100" height="24"><g class="type1"><svg width="1100" height="24"><text x="0" y="18" class="c">{esc(cmd)}</text></svg></g></svg>
<svg x="44" y="90" width="1120" height="24"><g class="type2"><svg width="1120" height="24"><text x="0" y="18" class="c">{esc(cmd2)}</text></svg></g></svg>
{"".join(out)}
<text x="{W - 40}" y="{H - 22}" text-anchor="end" class="dim" style="font-size:11px">real numbers: SAVORHILL 山也, Avowd’s October 2026 measurement · same engines and settings as this tool · published with permission</text>
</svg>
'''


if __name__ == "__main__":
    img = base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode()
    root = pathlib.Path(__file__).resolve().parent.parent / "assets"
    (root / "hero.svg").write_text(hero(img))
    (root / "demo.svg").write_text(demo())
    print("wrote", root / "hero.svg", root / "demo.svg")
