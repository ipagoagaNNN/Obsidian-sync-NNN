// Board view (ADR-014) — wraps the existing, runtime-verified kanban renderer
// (src/pm/board.ts) in the PMView contract.
//
// Single project  → renderBoard() exactly as before (the verified path, byte-for-
//                    byte: board endpoint + drag-transition + filter bar).
// Multiple projects → one labeled board section per project, stacked. Each section
//                     reuses renderBoard with its own options object, so per-board
//                     filter state + reloads stay independent. (A single merged-
//                     column cross-project board is a later refinement.)

import { renderBoard } from '../board'
import type { PMView, ViewContext } from '../registry'

export const boardView: PMView = {
  id: 'board',
  label: 'Board',
  icon: 'layout-grid',
  async render(host: HTMLElement, ctx: ViewContext): Promise<void> {
    host.empty()
    const projects = ctx.scope.projects
    if (!projects.length) {
      host.createEl('p', { text: 'Select at least one project.', cls: 'nnn-pm-loading' })
      return
    }

    if (projects.length === 1) {
      await renderBoard(ctx.app, ctx.client, host, { projectKey: projects[0] })
      return
    }

    // Multi-project: stacked, one board per selected project.
    for (const key of projects) {
      const section = host.createDiv({ cls: 'nnn-pm-board-section' })
      section.createEl('div', { text: key, cls: 'nnn-pm-board-section-title' })
      const sub = section.createDiv({ cls: 'nnn-pm-board-section-body' })
      await renderBoard(ctx.app, ctx.client, sub, { projectKey: key })
    }
  },
}
