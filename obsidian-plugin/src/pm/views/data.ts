// Data view (ADR-014, Phase 4) — the compound data-analysis surface. SKELETON
// for now: three stacked panels ported in spirit from the VizLab gallery —
// bullet (live, per-status throughput), brushed (timeline→bars, skeleton until
// the time-series endpoint lands), and sankey (workflow flow from /pm/meta
// transitions, skeleton). Vanilla SVG, no d3. The full linked-brushing compound
// view is the analytics turn (#69).

import type { PMView, ViewContext } from '../registry'
import type { PMAnalytics, PMMeta } from '../types'
import { enumColor } from './table/columns'
import { lin, svg } from './viz/svg'

function panel(host: HTMLElement, title: string, tag: 'live' | 'skeleton'): HTMLElement {
  const p = host.createDiv({ cls: 'nnn-pm-viz-panel' })
  const h = p.createDiv({ cls: 'nnn-pm-viz-panel-head' })
  h.createSpan({ cls: 'nnn-pm-viz-panel-title', text: title })
  h.createSpan({ cls: tag === 'live' ? 'nnn-pm-viz-live' : 'nnn-pm-viz-skel', text: tag })
  return p.createDiv({ cls: 'nnn-pm-viz-panel-body' })
}

// ── Bullet (live): per-status counts as proportional bars ──────────────────────
function panelBullet(host: HTMLElement, a: PMAnalytics, meta: PMMeta) {
  const body = panel(host, 'Throughput — bullet', 'live')
  const entries = Object.entries(a.byStatus)
  if (!entries.length) {
    body.createEl('p', { text: 'No active issues.', cls: 'nnn-pm-loading' })
    return
  }
  const named = entries.map(([k, v]): [string, number] => [meta.statuses.find(s => s.key === k)?.name ?? k, v])
  const max = Math.max(...named.map(([, v]) => v), 1)
  const W = 860, rowH = 32, labelW = 180, right = 44, top = 8
  const H = top + named.length * rowH + 8
  const x = lin(0, max, labelW, W - right)
  const root = svg(body, 'svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' })
  named.forEach(([label, v], i) => {
    const y = top + i * rowH
    svg(root, 'text', { x: labelW - 12, y: y + 13, 'text-anchor': 'end', fill: 'var(--text-normal)', 'font-size': '12', 'font-weight': '600' }, label)
    svg(root, 'rect', { x: labelW, y, width: W - right - labelW, height: 18, rx: 2, fill: 'var(--background-modifier-border)', opacity: '0.4' })
    svg(root, 'rect', { x: labelW, y: y + 4, width: Math.max(2, x(v) - labelW), height: 10, rx: 2, fill: 'var(--interactive-accent, #7c6cf0)' })
    svg(root, 'text', { x: x(v) + 6, y: y + 13, fill: 'var(--text-muted)', 'font-size': '11', 'font-weight': '700' }, String(v))
  })
}

// ── Brushed (skeleton): a synthetic activity timeline + a by-priority bar row ──
function panelBrushed(host: HTMLElement, a: PMAnalytics) {
  const body = panel(host, 'Activity timeline — brushed', 'skeleton')
  const W = 860, H = 220, top = 14, left = 44, right = 20
  const root = svg(body, 'svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' })

  // Synthetic timeline curve (illustrative until the time-series endpoint lands).
  const N = 24
  const xt = lin(0, N - 1, left, W - right)
  const pts: string[] = []
  for (let i = 0; i < N; i++) {
    const v = 2 + Math.sin(i / 3) * 1.5 + Math.cos(i / 5)
    pts.push(`${xt(i).toFixed(1)} ${(96 - v * 11).toFixed(1)}`)
  }
  svg(root, 'path', { d: 'M ' + pts.join(' L '), fill: 'none', stroke: 'var(--text-accent, #e5a13a)', 'stroke-width': '1.5' })
  svg(root, 'rect', {
    x: left + (W - left - right) * 0.46,
    y: top,
    width: (W - left - right) * 0.3,
    height: 96 - top,
    fill: 'var(--interactive-accent, #7c6cf0)',
    'fill-opacity': '0.12',
    stroke: 'var(--interactive-accent, #7c6cf0)',
    'stroke-dasharray': '3,3',
  })
  svg(root, 'text', { x: left, y: 116, fill: 'var(--text-muted)', 'font-size': '10' }, 'TIMELINE — brush-linking wires to the time-series endpoint next')

  // Bottom: by-priority bars (live).
  const pr = Object.entries(a.byPriority)
  const maxp = Math.max(...pr.map(([, v]) => v), 1)
  const bandW = (W - left - right) / Math.max(pr.length, 1)
  const yb = lin(0, maxp, H - 16, 142)
  pr.forEach(([k, v], i) => {
    const bx = left + i * bandW + 6
    svg(root, 'rect', { x: bx, y: yb(v), width: bandW - 12, height: H - 16 - yb(v), rx: 2, fill: 'var(--text-accent, #58a6ff)', opacity: '0.7' })
    svg(root, 'text', { x: bx + (bandW - 12) / 2, y: H - 3, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': '9.5' }, k)
    svg(root, 'text', { x: bx + (bandW - 12) / 2, y: yb(v) - 3, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': '10', 'font-weight': '600' }, String(v))
  })
}

// ── Sankey (skeleton): statuses in category columns, transitions as ribbons ────
function panelSankey(host: HTMLElement, a: PMAnalytics, meta: PMMeta) {
  const body = panel(host, 'Workflow flow — sankey', 'skeleton')
  const W = 860, H = 300, pad = 20
  const root = svg(body, 'svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' })

  const statuses = [...meta.statuses].sort((x, y) => x.sortOrder - y.sortOrder)
  const cats = [...new Set(statuses.map(s => s.category))]
  const colX = (cat: string) => pad + cats.indexOf(cat) * ((W - 2 * pad - 80) / Math.max(cats.length - 1, 1))
  const maxCount = Math.max(...Object.values(a.byStatus), 1)

  const pos = new Map<string, { x: number; y: number; h: number }>()
  const byCat = new Map<string, typeof statuses>()
  for (const s of statuses) {
    const arr = byCat.get(s.category) ?? []
    arr.push(s)
    byCat.set(s.category, arr)
  }
  for (const [cat, arr] of byCat) {
    const cx = colX(cat)
    let y = pad
    for (const s of arr) {
      const cnt = a.byStatus[s.key] ?? 0
      const h = Math.max(14, (cnt / maxCount) * 64)
      pos.set(s.key, { x: cx, y, h })
      const rect = svg(root, 'rect', { x: cx, y, width: 12, height: h, rx: 2, fill: enumColor(s.key) })
      svg(rect, 'title', {}, `${s.name}: ${cnt}`)
      svg(root, 'text', { x: cx + 16, y: y + h / 2, dy: '0.35em', fill: 'var(--text-normal)', 'font-size': '10' }, s.name)
      y += h + 14
    }
  }

  for (const s of statuses) {
    const from = pos.get(s.key)
    if (!from) continue
    for (const to of meta.transitions[s.key] ?? []) {
      const t = pos.get(to)
      if (!t || t.x <= from.x) continue
      const x1 = from.x + 12, y1 = from.y + from.h / 2, x2 = t.x, y2 = t.y + t.h / 2
      const mx = (x1 + x2) / 2
      svg(root, 'path', {
        d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
        fill: 'none',
        stroke: 'var(--text-muted)',
        'stroke-opacity': '0.35',
        'stroke-width': '1.5',
      })
    }
  }
}

export const dataView: PMView = {
  id: 'data',
  label: 'Data',
  icon: 'bar-chart-3',
  async render(host: HTMLElement, ctx: ViewContext): Promise<void> {
    host.empty()
    host.addClass('nnn-pm-viz-host')
    const key = ctx.scope.projects[0]
    if (!key) {
      host.createEl('p', { text: 'Select at least one project.', cls: 'nnn-pm-loading' })
      return
    }
    const head = host.createDiv({ cls: 'nnn-pm-viz-head' })
    head.createSpan({ cls: 'nnn-pm-viz-title', text: `Data · ${key}` })
    head.createSpan({ cls: 'nnn-pm-viz-sub', text: 'Compound analysis (skeleton) — bullet · brushed · sankey' })
    const body = host.createDiv({ cls: 'nnn-pm-viz-body' })
    body.createEl('p', { text: 'Loading…', cls: 'nnn-pm-loading' })
    try {
      const [analytics, meta] = await Promise.all([ctx.client.analytics(key), ctx.client.meta()])
      body.empty()
      panelBullet(body, analytics, meta)
      panelBrushed(body, analytics)
      panelSankey(body, analytics, meta)
    } catch (e) {
      body.empty()
      body.createEl('p', { text: `NNN-PM: ${e instanceof Error ? e.message : String(e)}`, cls: 'nnn-pm-error' })
    }
  },
}
