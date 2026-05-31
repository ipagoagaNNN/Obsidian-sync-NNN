// Vault-plane data adapter (ADR-014, Phase 2).
//
// The `vault` half of the two-plane model: reads Obsidian notes + their parsed
// frontmatter directly from the in-memory vault + metadataCache. No backend, no
// HTTP, no new infra — Obsidian already holds the file list and parsed
// frontmatter, so this is cheap and never blocks on disk I/O. The table view
// renders these rows the same way the board renders Postgres-canonical tickets.

import type { App } from 'obsidian'

/** One note as a table row: identity + its (untyped) frontmatter. */
export interface VaultRow {
  path: string // vault-relative path, e.g. "Projects/NNN/sessions/s1.md"
  file: string // basename without extension
  folder: string // parent folder path ('' for vault root)
  mtime: number // last-modified epoch ms
  frontmatter: Record<string, unknown>
}

/** Sentinel collection id meaning "every markdown note in the vault". */
export const ALL_NOTES = '__all__'

/** Distinct top-level folders in the vault (for the collection picker). */
export function topFolders(app: App): string[] {
  const set = new Set<string>()
  for (const f of app.vault.getMarkdownFiles()) {
    const top = f.path.includes('/') ? f.path.split('/')[0] : ''
    if (top) set.add(top)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Read note rows under `collection` (a folder-path prefix; ALL_NOTES/undefined =
 *  the whole vault). Frontmatter comes from metadataCache (already parsed by
 *  Obsidian); the synthetic `position` key it injects is stripped. */
export function vaultRows(app: App, collection?: string): VaultRow[] {
  const prefix =
    collection && collection !== ALL_NOTES ? collection.replace(/\/+$/, '') + '/' : ''
  const rows: VaultRow[] = []
  for (const f of app.vault.getMarkdownFiles()) {
    if (prefix && !f.path.startsWith(prefix)) continue
    const fm = { ...(app.metadataCache.getFileCache(f)?.frontmatter ?? {}) } as Record<
      string,
      unknown
    >
    delete fm.position // Obsidian's source-position marker — not a real property
    const folder = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path : ''
    rows.push({ path: f.path, file: f.basename, folder, mtime: f.stat.mtime, frontmatter: fm })
  }
  return rows
}
