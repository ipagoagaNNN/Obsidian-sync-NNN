// NNN-PM view framework (ADR-014).
//
// Every NNN-PM visualization — board, table, gantt, data-analysis — is a
// self-contained module implementing the PMView contract and registered once in
// the ViewRegistry. The full-tab host (view.ts) and the inline `nnn-pm` code
// block (block.ts) are thin: they resolve a view by id from the registry, hand
// it a ViewContext (scope + client), and call render(). Adding a new view later
// is a new file + one register() call — no host/block changes.

import type { App } from 'obsidian'
import type { PMClient } from './api'

/** What a view renders over: one or more project keys on a data plane.
 *  `pm`    → Postgres entities via PMClient (tickets/labels/cycles…).
 *  `vault` → Obsidian notes via app.vault + metadataCache (Studio plane).
 *  Phase 0 only exercises the `pm` plane; `vault` lands in Phase 2. */
export interface Scope {
  projects: string[] // selected project keys (1..N); [] = nothing selected
  plane?: 'pm' | 'vault'
  collection?: string // vault-plane folder/collection id (Phase 2)
}

export interface ViewContext {
  app: App
  client: PMClient
  scope: Scope
  /** Re-render the active view in place (after a mutation, scope change, etc.). */
  reload: () => void
  /** Per-(view,scope) settings, surfaced by the Manage panel. Optional in P0. */
  settings?: Record<string, unknown>
}

/** One field in a view's settings schema (drives the per-view Manage panel). */
export interface SettingsField {
  key: string
  label: string
  kind: 'toggle' | 'select' | 'text' | 'number'
  options?: { value: string; label: string }[]
  default?: unknown
}

export interface PMView {
  id: string // 'board' | 'table' | 'gantt' | 'analytics' | ...
  label: string
  icon?: string // an Obsidian lucide icon id (for the host selector)
  render(host: HTMLElement, ctx: ViewContext): void | Promise<void>
  settingsSchema?: SettingsField[]
}

/** A tiny in-memory registry of view modules. */
export class ViewRegistry {
  private views = new Map<string, PMView>()

  register(view: PMView): void {
    this.views.set(view.id, view)
  }
  get(id: string): PMView | undefined {
    return this.views.get(id)
  }
  has(id: string): boolean {
    return this.views.has(id)
  }
  list(): PMView[] {
    return [...this.views.values()]
  }
}

/** Process-wide registry shared by the host and the code-block processor. */
export const pmViews = new ViewRegistry()
