// Modular code-block processor for ```nnn-pm fences (ADR-014). A note embeds any
// registered view, scoped to one or more projects:
//
//   ```nnn-pm
//   view: gantt          # optional; defaults to 'board'
//   project: ENG         # or: projects: ENG, MKT
//   ```
//
// Backward-compatible: an old block with just `project: ENG` still renders the
// board. The `view:` line selects a registry entry; everything else is the same
// resolve → render path the full-tab host uses.

import { App } from 'obsidian'
import type { PMClient } from './api'
import { pmViews, type Scope } from './registry'

export function renderPMCodeBlock(
  app: App,
  getClient: () => PMClient,
  source: string,
  el: HTMLElement,
): void {
  const cfg = parseConfig(source)
  const projects = parseProjects(cfg)
  if (!projects.length) {
    el.createEl('p', {
      text: 'nnn-pm: missing `project: <KEY>` (or `projects: ENG, MKT`)',
      cls: 'nnn-pm-error',
    })
    return
  }
  const viewId = (cfg.view || 'board').trim().toLowerCase()
  const view = pmViews.get(viewId)
  if (!view) {
    el.createEl('p', {
      text: `nnn-pm: unknown view "${viewId}" — available: ${pmViews
        .list()
        .map(v => v.id)
        .join(', ')}`,
      cls: 'nnn-pm-error',
    })
    return
  }
  const scope: Scope = { projects, plane: 'pm' }
  void view.render(el, {
    app,
    client: getClient(),
    scope,
    reload: () => renderPMCodeBlock(app, getClient, source, el),
  })
}

/** Project keys from `projects: A, B` (preferred) or a single `project: A`. */
function parseProjects(cfg: Record<string, string>): string[] {
  if (cfg.projects) {
    return cfg.projects
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
  }
  if (cfg.project) return [cfg.project.trim().toUpperCase()]
  return []
}

// parseConfig reads simple `key: value` lines (comments with # ignored).
function parseConfig(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx < 0) continue
    const key = trimmed.slice(0, idx).trim().toLowerCase()
    const val = trimmed.slice(idx + 1).trim()
    if (key) out[key] = val
  }
  return out
}
