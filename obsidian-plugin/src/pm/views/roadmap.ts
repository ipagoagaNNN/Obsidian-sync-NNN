// Roadmap view (ADR-014, Phase 3) — a Gantt/swimlane timeline over the project's
// dated work: cycles render as bars (startsOn → endsOn), milestones as diamond
// markers at their due date (status-colored, goal in tooltip), with month
// gridlines + a "today" line. Ported in spirit from the VizLab gantt view,
// rewritten vanilla-SVG (no d3) over real PM data.

import type { PMView, ViewContext } from '../registry'
import type { PMCycle, PMMilestone } from '../types'
import { enumColor } from './table/columns'
import { lin, monthLabel, monthTicks, parseDate, svg, truncate } from './viz/svg'

interface GanttRow {
  label: string
  start: number
  end: number
  kind: 'cycle' | 'milestone'
  status?: string
  sub?: string
}

function buildRows(cycles: PMCycle[], milestones: PMMilestone[]): GanttRow[] {
  const rows: GanttRow[] = []
  for (const c of cycles) {
    const s = parseDate(c.startsOn)
    const e = parseDate(c.endsOn)
    if (s == null && e == null) continue
    const start = s ?? e ?? 0
    const end = Math.max(e ?? s ?? 0, start)
    rows.push({ label: c.name, start, end, kind: 'cycle' })
  }
  for (const m of milestones) {
    const d = parseDate(m.dueOn)
    if (d == null) continue
    rows.push({ label: m.name, start: d, end: d, kind: 'milestone', status: m.status, sub: m.goal ?? undefined })
  }
  return rows
}

function renderGantt(host: HTMLElement, rows: GanttRow[]) {
  if (!rows.length) {
    host.createEl('p', {
      cls: 'nnn-pm-loading',
      text: 'No dated work yet. Give cycles a start/end range or milestones a due date to populate the roadmap.',
    })
    return
  }

  const now = Date.now()
  const times = rows.flatMap(r => [r.start, r.end]).concat(now)
  let min = Math.min(...times)
  let max = Math.max(...times)
  const pad = (max - min) * 0.06 || 86_400_000 * 7
  min -= pad
  max += pad

  const W = 920
  const rowH = 30
  const labelW = 168
  const top = 40
  const right = 28
  const H = top + rows.length * rowH + 28
  const x = lin(min, max, labelW, W - right)

  const root = svg(host, 'svg', { viewBox: `0 0 ${W} ${H}`, class: 'nnn-pm-gantt', width: '100%' })

  // Month gridlines + labels.
  for (const mt of monthTicks(min, max)) {
    svg(root, 'line', {
      x1: x(mt),
      x2: x(mt),
      y1: top - 8,
      y2: H - 22,
      stroke: 'var(--background-modifier-border)',
      'stroke-dasharray': '2,3',
    })
    svg(root, 'text', { x: x(mt) + 3, y: top - 14, fill: 'var(--text-muted)', 'font-size': '10' }, monthLabel(mt))
  }

  // Today marker.
  svg(root, 'line', {
    x1: x(now),
    x2: x(now),
    y1: top - 8,
    y2: H - 22,
    stroke: 'var(--text-accent, #e5a13a)',
    'stroke-width': '1.5',
  })
  svg(root, 'text', {
    x: x(now) + 3,
    y: H - 9,
    fill: 'var(--text-accent, #e5a13a)',
    'font-size': '10',
    'font-weight': '600',
  }, 'today')

  rows.forEach((r, i) => {
    const y = top + i * rowH
    svg(root, 'text', {
      x: labelW - 10,
      y: y + rowH / 2,
      dy: '0.35em',
      'text-anchor': 'end',
      fill: 'var(--text-normal)',
      'font-size': '11',
    }, truncate(r.label, 24))

    if (r.kind === 'cycle' && r.end > r.start) {
      const bar = svg(root, 'rect', {
        x: x(r.start),
        y: y + 6,
        width: Math.max(2, x(r.end) - x(r.start)),
        height: rowH - 14,
        rx: 3,
        fill: 'var(--interactive-accent, #7c6cf0)',
        opacity: '0.85',
      })
      const d = Math.round((r.end - r.start) / 86_400_000)
      svg(bar, 'title', {}, `${r.label} · ${d}d`)
    } else {
      // Milestone diamond at the due date.
      const cx = x(r.start)
      const cy = y + rowH / 2
      const s = 6
      const dia = svg(root, 'path', {
        d: `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`,
        fill: enumColor(r.status),
      })
      svg(dia, 'title', {}, r.sub ? `${r.label} — ${r.sub}` : r.label)
      if (r.sub) {
        svg(root, 'text', {
          x: cx + 11,
          y: cy,
          dy: '0.35em',
          fill: 'var(--text-muted)',
          'font-size': '10',
        }, truncate(r.sub, 46))
      }
    }
  })
}

export const roadmapView: PMView = {
  id: 'roadmap',
  label: 'Roadmap',
  icon: 'gantt-chart',
  async render(host: HTMLElement, ctx: ViewContext): Promise<void> {
    host.empty()
    host.addClass('nnn-pm-viz-host')
    const key = ctx.scope.projects[0]
    if (!key) {
      host.createEl('p', { text: 'Select at least one project.', cls: 'nnn-pm-loading' })
      return
    }
    const head = host.createDiv({ cls: 'nnn-pm-viz-head' })
    head.createSpan({ cls: 'nnn-pm-viz-title', text: `Roadmap · ${key}` })
    head.createSpan({
      cls: 'nnn-pm-viz-sub',
      text: 'Cycles as bars · milestones as diamonds (status-colored) · today line',
    })
    const body = host.createDiv({ cls: 'nnn-pm-viz-body' })
    body.createEl('p', { text: 'Loading…', cls: 'nnn-pm-loading' })
    try {
      const [cycles, milestones] = await Promise.all([
        ctx.client.cycles(key),
        ctx.client.milestones(key),
      ])
      body.empty()
      renderGantt(body, buildRows(cycles, milestones))
    } catch (e) {
      body.empty()
      body.createEl('p', { text: `NNN-PM: ${e instanceof Error ? e.message : String(e)}`, cls: 'nnn-pm-error' })
    }
  },
}
