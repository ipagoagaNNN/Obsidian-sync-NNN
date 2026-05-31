// Cards view for the vault-plane table (ADR-014, P2) — the VizLab base-cards
// layout, Obsidian-native. Title + status badges + a meta line + tag chips.
// Derives its layout from the inferred columns (no curated CardCfg yet).

import type { VaultRow } from '../../data/vaultAdapter'
import { asArray, asString, enumColor, fmtDate, type ColumnDef } from './columns'

function cardMeta(row: VaultRow, col: ColumnDef): string {
  const raw = col.key === 'mtime' ? row.mtime : row.frontmatter[col.key]
  if (col.kind === 'date') return fmtDate(raw)
  return asString(raw)
}

export function renderCards(
  host: HTMLElement,
  cols: ColumnDef[],
  rows: VaultRow[],
  onOpen: (row: VaultRow) => void,
): void {
  if (!rows.length) {
    host.createDiv({ cls: 'nnn-pm-st-empty', text: 'No notes in this collection.' })
    return
  }
  const badgeCols = cols.filter(c => c.kind === 'status').slice(0, 2)
  const tagCol = cols.find(c => c.kind === 'tags')
  const metaCols = cols
    .filter(c => c.kind !== 'title' && c.kind !== 'status' && c.kind !== 'tags')
    .slice(0, 4)

  const grid = host.createDiv({ cls: 'nnn-pm-st-cards' })
  for (const row of rows) {
    const card = grid.createDiv({ cls: 'nnn-pm-st-card' })

    const head = card.createDiv({ cls: 'nnn-pm-st-card-head' })
    head.createDiv({ cls: 'nnn-pm-st-card-title', text: asString(row.frontmatter.title) || row.file })
    const badges = head.createDiv({ cls: 'nnn-pm-st-card-badges' })
    for (const bc of badgeCols) {
      const v = asString(row.frontmatter[bc.key])
      if (!v) continue
      const pill = badges.createSpan({ cls: 'nnn-pm-st-pill', text: v })
      pill.style.setProperty('--pill', enumColor(v))
    }

    const metas = metaCols.map(c => ({ k: c.label, v: cardMeta(row, c) })).filter(m => m.v)
    if (metas.length) {
      const m = card.createDiv({ cls: 'nnn-pm-st-cardmeta' })
      for (const mm of metas) {
        const item = m.createSpan({ cls: 'nnn-pm-st-cardmeta-item' })
        item.createSpan({ cls: 'k', text: mm.k })
        item.appendText(` ${mm.v}`)
      }
    }

    if (tagCol) {
      const tags = asArray(row.frontmatter[tagCol.key]).slice(0, 4)
      if (tags.length) {
        const t = card.createDiv({ cls: 'nnn-pm-st-tags' })
        for (const tg of tags) t.createSpan({ cls: 'nnn-pm-st-tag', text: tg })
      }
    }

    card.onclick = () => onOpen(row)
  }
}
