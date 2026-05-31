// PMBoardView — the full-tab NNN-PM workspace host (ADR-014).
//
// Not file-backed (an ItemView), so it's the right home for a stateful, multi-
// view workspace. The host is thin: a VIEW SELECTOR (from the registry) + a
// MULTI-SELECT project scope picker, then it resolves the active view and calls
// render() into the body. All real rendering lives in the view modules.

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian'
import { PMClient, PMError } from './api'
import { pmViews, type Scope } from './registry'
import type { PMProject } from './types'

export const PM_VIEW_TYPE = 'nnn-pm-board'

export class PMBoardView extends ItemView {
  // NB: named `pmScope`, not `scope` — Obsidian's View base reserves `scope`
  // for its keyboard-event Scope. This is our data-plane scope (registry.ts).
  private pmScope: Scope = { projects: [], plane: 'pm' }
  private viewId = 'board'

  constructor(
    leaf: WorkspaceLeaf,
    private getClient: () => PMClient,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'NNN-PM'
  }
  getIcon(): string {
    return 'layout-grid'
  }

  async onOpen() {
    await this.renderShell()
  }
  async onClose() {
    this.contentEl.empty()
  }

  private async renderShell() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('nnn-pm-view')

    const bar = contentEl.createDiv({ cls: 'nnn-pm-host-bar' })
    const body = contentEl.createDiv({ cls: 'nnn-pm-view-host' })

    const client = this.getClient()
    let projects: PMProject[] = []
    try {
      projects = await client.projects()
    } catch (e) {
      body.createEl('p', {
        text: `NNN-PM: ${e instanceof PMError ? e.message : String(e)}`,
        cls: 'nnn-pm-error',
      })
      return
    }
    if (!projects.length) {
      body.createEl('p', {
        text: 'You are not a member of any project yet — ask an admin to add you (or set your department).',
      })
      return
    }

    // Default scope: keep any still-valid prior selection, else the first project.
    const allowed = new Set(projects.map(p => p.key))
    this.pmScope.projects = this.pmScope.projects.filter(k => allowed.has(k))
    if (!this.pmScope.projects.length) this.pmScope.projects = [projects[0].key]

    const paint = () => {
      const view = pmViews.get(this.viewId) ?? pmViews.list()[0]
      if (!view) {
        body.empty()
        body.createEl('p', { text: 'No NNN-PM views registered.', cls: 'nnn-pm-error' })
        return
      }
      this.viewId = view.id
      void view.render(body, {
        app: this.app,
        client,
        scope: this.pmScope,
        reload: paint,
      })
    }

    // ── View selector ─────────────────────────────────────────────────────────
    const viewWrap = bar.createDiv({ cls: 'nnn-pm-host-views' })
    viewWrap.createSpan({ cls: 'nnn-pm-host-label', text: 'View' })
    const viewSel = viewWrap.createEl('select')
    for (const v of pmViews.list()) {
      const o = viewSel.createEl('option', { text: v.label })
      o.value = v.id
    }
    viewSel.value = this.viewId
    viewSel.onchange = () => {
      this.viewId = viewSel.value
      paint()
    }

    // ── Scope multi-select (toggle pills) ───────────────────────────────────────
    const scopeWrap = bar.createDiv({ cls: 'nnn-pm-host-scope' })
    scopeWrap.createSpan({ cls: 'nnn-pm-host-label', text: 'Scope' })
    const repaintPills = () => {
      pills.empty()
      // "All" pill — one-click select every visible project (management full view:
      // for an admin/management user that's every department's board, stacked).
      if (projects.length > 1) {
        const allOn = this.pmScope.projects.length === projects.length
        const allPill = pills.createEl('button', {
          text: 'All',
          cls: allOn ? 'nnn-pm-scope-pill nnn-pm-scope-all nnn-pm-scope-on' : 'nnn-pm-scope-pill nnn-pm-scope-all',
        })
        allPill.title = 'All projects (management full view)'
        allPill.onclick = () => {
          this.pmScope.projects = allOn ? [projects[0].key] : projects.map(p => p.key)
          repaintPills()
          paint()
        }
      }
      for (const p of projects) {
        const on = this.pmScope.projects.includes(p.key)
        const pill = pills.createEl('button', {
          text: p.key,
          cls: on ? 'nnn-pm-scope-pill nnn-pm-scope-on' : 'nnn-pm-scope-pill',
        })
        pill.title = p.name
        pill.onclick = () => {
          if (on) {
            // Don't allow emptying the scope to nothing.
            if (this.pmScope.projects.length > 1) {
              this.pmScope.projects = this.pmScope.projects.filter(k => k !== p.key)
            }
          } else {
            this.pmScope.projects = [...this.pmScope.projects, p.key]
          }
          repaintPills()
          paint()
        }
      }
    }
    const pills = scopeWrap.createDiv({ cls: 'nnn-pm-scope-pills' })
    repaintPills()

    // ── Refresh (re-render the active view — re-reads the vault / re-fetches) ───
    const refresh = bar.createEl('button', {
      cls: 'nnn-pm-host-refresh',
      attr: { 'aria-label': 'Refresh', title: 'Refresh' },
    })
    setIcon(refresh, 'lucide-refresh-cw')
    refresh.onclick = () => paint()

    paint()
  }
}
