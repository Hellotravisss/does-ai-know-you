// Brand matching — the same rules Avowd's measurement uses to decide "did this answer name the brand".

export function host(u: string): string {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const looksLikeHost = (a: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(a.replace(/^https?:\/\//, ""));

/**
 * Every term the brand can be named by. A bilingual name ("甜屑 Sweet Crumb") is never
 * answered whole — Chinese engines say the Chinese half, Western engines the Latin half — so each
 * script run counts on its own, plus the site's domain and any aliases you pass.
 */
export function brandTerms(name: string, site = "", aliases: string[] = []): string[] {
  const out = new Set<string>();
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

/** Which term (if any) the answer names the brand by — in the text or in a cited link. */
export function matchBrand(text: string, links: string[], terms: string[]): string | undefined {
  const body = text.toLowerCase();
  return terms.find((term) => {
    const t = term.toLowerCase().trim();
    return !!t && (body.includes(t) || links.some((l) => l.toLowerCase().includes(t)));
  });
}

/** Does any cited link point at the brand's own site? */
export function linksToSite(links: string[], site: string): boolean {
  const h = site ? host(site) : "";
  return !!h && links.some((l) => host(l) === h || host(l).endsWith(`.${h}`));
}
