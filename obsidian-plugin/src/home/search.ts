// Fuzzy file search for the Home view (Phase 1).
//
// Uses Obsidian's exported prepareFuzzySearch over the in-memory markdown file
// list — no Fuse.js dependency, no disk I/O. Empty query falls back to the
// most-recently-modified notes so the result panel is useful before typing.

import { type App, type TFile, prepareFuzzySearch } from 'obsidian'

export interface FileHit {
  file: TFile
  score: number
}

/**
 * Rank markdown files against `query`. Matches on basename first (the common
 * case), falling back to the full path so "folder/name" queries still hit.
 * Obsidian fuzzy scores are higher-is-better, so we sort descending.
 */
export function searchFiles(app: App, query: string, limit = 20): FileHit[] {
  const q = query.trim()
  const files = app.vault.getMarkdownFiles()

  if (!q) {
    return files
      .slice()
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, limit)
      .map((file) => ({ file, score: 0 }))
  }

  const matcher = prepareFuzzySearch(q)
  const hits: FileHit[] = []
  for (const file of files) {
    const r = matcher(file.basename) ?? matcher(file.path)
    if (r) hits.push({ file, score: r.score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
