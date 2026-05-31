// Column model + typed cell rendering for the vault-plane table (ADR-014, P2).
//
// Ported from the VizLab Studio ColumnDef pattern, rewritten Obsidian-native:
// cells are built with createEl/setText (the codebase's stored-XSS guard) — never
// innerHTML. Rendering (renderCell) is split from the pure sort/text accessors
// (sortValue/cellText) so sorting + find never touch the DOM. Class names mirror
// VizLab's `.st-*` (prefixed nnn-pm-st-) so the injected CSS matches Studio 1:1.

import type { VaultRow } from '../../data/vaultAdapter'

export type ColumnKind = 'title' | 'text' | 'date' | 'number' | 'status' | 'tags' | 'list' | 'link'

export interface ColumnDef {
  key: string // 'file' | 'folder' | 'mtime' | a frontmatter key
  label: string
  kind: ColumnKind
  align?: 'right'
}

// ── value coercion (frontmatter is untyped — never throw on messy reals) ───────
export function asString(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ')
  return String(v)
}
export function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x))
  if (v == null || v === '') return []
  return [String(v)]
}
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}
function asDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}
export function fmtDate(v: unknown): string {
  const d = asDate(v)
  return d ? d.toISOString().slice(0, 10) : asString(v)
}
export function cleanLink(v: unknown): string {
  return asString(v)
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
}
export const slug = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .trim()

/** Stable color for an enum value: known statuses get fixed hues, anything else
 *  hashes to a consistent HSL. Returned as a bare color so the `.nnn-pm-st-pill`
 *  CSS can color-mix it (text + 16% tinted background), matching VizLab. */
const KNOWN: Record<string, string> = {
  open: '#3b82f6',
  todo: '#3b82f6',
  backlog: '#6b7280',
  'in-progress': '#d8a31a',
  'in progress': '#d8a31a',
  doing: '#d8a31a',
  active: '#3b82f6',
  done: '#3a9f5a',
  completed: '#3a9f5a',
  closed: '#6b7280',
  resolved: '#3a9f5a',
  pass: '#3a9f5a',
  low: '#3a9f5a',
  blocked: '#e5534b',
  critical: '#e5534b',
  fail: '#e5534b',
  urgent: '#e5534b',
  high: '#d2691e',
  medium: '#d8a31a',
  cancelled: '#6b7280',
  abandoned: '#6b7280',
  deprecated: '#6b7280',
}
export function enumColor(value: unknown): string {
  const key = slug(value)
  if (KNOWN[key]) return KNOWN[key]
  if (!key) return 'var(--text-faint)'
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return `hsl(${h}, 52%, 50%)`
}

// ── accessors ──────────────────────────────────────────────────────────────
export function rawValue(col: ColumnDef, row: VaultRow): unknown {
  if (col.key === 'file') return row.file
  if (col.key === 'folder') return row.folder
  if (col.key === 'mtime') return row.mtime
  return row.frontmatter[col.key]
}

/** Pure sort key for a cell — number for numeric/date/count kinds, lowercased
 *  string otherwise. No DOM. */
export function sortValue(col: ColumnDef, row: VaultRow): number | string {
  const raw = rawValue(col, row)
  switch (col.kind) {
    case 'title':
      return (asString(row.frontmatter.title) || row.file).toLowerCase()
    case 'date': {
      const d = asDate(raw)
      return d ? d.getTime() : 0
    }
    case 'number': {
      const n = asNumber(raw)
      return n == null ? -Infinity : n
    }
    case 'tags':
    case 'list':
      return asArray(raw).length
    default:
      return asString(raw).toLowerCase()
  }
}

/** Plain-text projection of a cell, for the find/filter box. */
export function cellText(col: ColumnDef, row: VaultRow): string {
  const raw = rawValue(col, row)
  if (col.kind === 'title') return asString(row.frontmatter.title) || row.file
  if (col.kind === 'date') return fmtDate(raw)
  if (col.kind === 'tags' || col.kind === 'list') return asArray(raw).join(' ')
  return asString(raw)
}

/** Render one cell into `td` using createEl/setText only (no innerHTML). */
export function renderCell(td: HTMLElement, col: ColumnDef, row: VaultRow): void {
  const raw = rawValue(col, row)
  const dim = () => {
    td.createSpan({ cls: 'nnn-pm-st-dim', text: '—' })
  }
  switch (col.kind) {
    case 'title': {
      const t = asString(row.frontmatter.title) || row.file
      td.createSpan({ cls: 'nnn-pm-st-cell-title', text: t })
      return
    }
    case 'date': {
      const d = asDate(raw)
      if (d) td.setText(d.toISOString().slice(0, 10))
      else {
        const s = asString(raw)
        s ? td.setText(s) : dim()
      }
      return
    }
    case 'number': {
      const n = asNumber(raw)
      n == null ? dim() : td.setText(String(n))
      return
    }
    case 'status': {
      const v = asString(raw)
      if (!v) return dim()
      const pill = td.createSpan({ cls: 'nnn-pm-st-pill', text: v })
      pill.style.setProperty('--pill', enumColor(v))
      return
    }
    case 'tags': {
      const tags = asArray(raw)
      if (!tags.length) return dim()
      const box = td.createSpan({ cls: 'nnn-pm-st-tags' })
      for (const t of tags.slice(0, 6)) box.createSpan({ cls: 'nnn-pm-st-tag', text: t })
      if (tags.length > 6)
        box.createSpan({ cls: 'nnn-pm-st-tag nnn-pm-st-more', text: `+${tags.length - 6}` })
      return
    }
    case 'list': {
      const xs = asArray(raw)
      xs.length ? td.setText(`${xs.length} items`) : dim()
      return
    }
    case 'link': {
      const v = cleanLink(raw)
      v ? td.createSpan({ cls: 'nnn-pm-st-link', text: v }) : dim()
      return
    }
    default: {
      const v = asString(raw)
      v ? td.setText(v) : dim()
      return
    }
  }
}

/** Title-case a frontmatter key / folder name ("created_on" -> "Created on"). */
export function prettyLabel(id: string): string {
  const base = id.replace(/^_/, '')
  return base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' ')
}

function inferKind(key: string, sample: unknown): ColumnKind {
  const k = key.toLowerCase()
  if (Array.isArray(sample)) return k.includes('tag') ? 'tags' : 'list'
  if (typeof sample === 'number') return 'number'
  if (/(date|_on|_at|due|created|updated|review|closed)/.test(k)) return 'date'
  if (/(status|state|severity|priority|outcome|risk|category|type|level)/.test(k)) return 'status'
  if (typeof sample === 'string' && /^\[\[.*\]\]$/.test(sample.trim())) return 'link'
  return 'text'
}

const PRIORITY_KEYS = [
  'status',
  'type',
  'category',
  'severity',
  'priority',
  'outcome',
  'date',
  'created_on',
  'due',
  'tags',
]

/** Infer a column set from the union of frontmatter keys across rows: a title
 *  column first, then up to `maxFm` frontmatter columns (curated keys first,
 *  then by frequency), then a Modified column. */
export function inferColumns(rows: VaultRow[], maxFm = 8): ColumnDef[] {
  const freq = new Map<string, number>()
  const sample = new Map<string, unknown>()
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.frontmatter)) {
      if (v == null || v === '') continue
      freq.set(k, (freq.get(k) ?? 0) + 1)
      if (!sample.has(k)) sample.set(k, v)
    }
  }
  const keys = [...freq.keys()].filter(k => k !== 'title') // title folds into the 'file' column
  keys.sort((a, b) => {
    const pa = PRIORITY_KEYS.indexOf(a)
    const pb = PRIORITY_KEYS.indexOf(b)
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1
      if (pb === -1) return -1
      return pa - pb
    }
    return (freq.get(b) ?? 0) - (freq.get(a) ?? 0)
  })
  const cols: ColumnDef[] = [{ key: 'file', label: 'Note', kind: 'title' }]
  for (const k of keys.slice(0, maxFm)) {
    cols.push({ key: k, label: prettyLabel(k), kind: inferKind(k, sample.get(k)) })
  }
  cols.push({ key: 'mtime', label: 'Modified', kind: 'date', align: 'right' })
  return cols
}

/** The status-filter key for a column set: the first status-kind column, else
 *  'status'. Drives the toolbar's "All" dropdown. */
export function statusKeyFor(cols: ColumnDef[]): string {
  return cols.find(c => c.kind === 'status')?.key ?? 'status'
}
