// Dependency-free SVG builder + scale helpers for the PM viz views (Roadmap,
// Data). No d3 — these charts are positioned rects/paths/lines over linear
// scales, so a tiny helper keeps the plugin bundle lean (free-tier ethos,
// ADR-013). Text is set via textContent (the codebase XSS guard).

const NS = 'http://www.w3.org/2000/svg'

export function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (text != null) el.textContent = text
  parent.appendChild(el)
  return el
}

/** Linear scale: maps domain [d0,d1] → range [r0,r1]. */
export function lin(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0)
}

/** Parse a YYYY-MM-DD (or ISO) date to epoch ms, or null. */
export function parseDate(s?: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

/** First-of-month epoch ticks spanning [min,max]. */
export function monthTicks(min: number, max: number): number[] {
  const out: number[] = []
  const d = new Date(min)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  while (d.getTime() <= max) {
    if (d.getTime() >= min) out.push(d.getTime())
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export function monthLabel(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', year: '2-digit' })
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
