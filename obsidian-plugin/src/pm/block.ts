// Markdown code-block processor for ```nnn-pm fences. Lets a department note
// embed a live board:
//
//   ```nnn-pm
//   project: ENG
//   view: board
//   ```
//
// Phase 1 supports the `board` view only; `view:` is parsed but currently
// always renders the board (table/cards are a later phase).

import { App } from 'obsidian'
import type { PMClient } from './api'
import { renderBoard } from './board'

export function renderPMCodeBlock(
  app: App,
  getClient: () => PMClient,
  source: string,
  el: HTMLElement,
): void {
  const cfg = parseConfig(source)
  const projectKey = cfg.project
  if (!projectKey) {
    el.createEl('p', {
      text: 'nnn-pm: missing `project: <KEY>` (e.g. "project: ENG")',
      cls: 'nnn-pm-error',
    })
    return
  }
  void renderBoard(app, getClient(), el, { projectKey })
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
