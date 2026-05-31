// Kanban board renderer (Phase 1). Self-contained vanilla DOM — no framework —
// consuming the typed PMClient. Drag a card to another column to transition it;
// invalid targets dim during the drag (from the workflow graph in /pm/meta).
//
// Re-fetch model: renderBoard() pulls /pm/meta + /pm/projects/:key/board, then
// paintBoard() draws synchronously. Any mutation (create / edit / drop) calls
// reload() which re-runs renderBoard — simple and correct for an MVP at 60 users.

import { App, Notice, TFile } from 'obsidian'
import { PMClient, PMError } from './api'
import type { PMBoard, PMBoardColumn, PMIssueFilters, PMIssueSummary, PMMeta } from './types'
import { AnalyticsModal, CreateIssueModal, IssueDetailModal, ProjectManageModal } from './modals'

export interface BoardRenderOptions {
  projectKey: string
  /** Active filters, mutated in place and persisted across reloads (same opts ref). */
  filters?: PMIssueFilters
  /** Whether the filter bar is expanded. */
  filtersOpen?: boolean
}

function errMsg(e: unknown): string {
  return e instanceof PMError ? e.message : e instanceof Error ? e.message : String(e)
}

export async function renderBoard(
  app: App,
  client: PMClient,
  container: HTMLElement,
  opts: BoardRenderOptions,
): Promise<void> {
  container.empty()
  container.addClass('nnn-pm-board-root')
  container.createEl('p', { text: `Loading ${opts.projectKey} board…`, cls: 'nnn-pm-loading' })

  try {
    const meta = await client.meta()
    // When any filter is set the board endpoint (which takes no filters) can't
    // serve it, so we page the filtered /pm/issues list and re-group it into the
    // same columns. Unfiltered → the cheap single-shot board endpoint.
    const columns = anyFilterActive(opts.filters)
      ? await buildFilteredColumns(client, opts, meta)
      : (await client.board(opts.projectKey)).columns
    container.empty()
    paintBoard(app, client, container, opts, meta, { projectKey: opts.projectKey, columns })
  } catch (e) {
    container.empty()
    container.createEl('p', { text: `NNN-PM: ${errMsg(e)}`, cls: 'nnn-pm-error' })
  }
}

function anyFilterActive(f?: PMIssueFilters): boolean {
  return !!f && !!(f.q || f.status || f.priority || f.assignee || f.label || f.epic || f.cycle)
}

function activeFilterCount(f?: PMIssueFilters): number {
  if (!f) return 0
  return [f.q, f.status, f.priority, f.assignee, f.label, f.epic, f.cycle].filter(Boolean).length
}

const FILTER_PAGE_CAP = 20 // 20 × 50 = 1000 matches max in the filtered view

// buildFilteredColumns pages through the paginated /pm/issues list (reusing the
// s32 injection-safe filter compiler) and buckets the flat result into the same
// column layout the board endpoint produces, in the workflow's status sort order.
async function buildFilteredColumns(
  client: PMClient,
  opts: BoardRenderOptions,
  meta: PMMeta,
): Promise<PMBoardColumn[]> {
  const all: PMIssueSummary[] = []
  for (let page = 1; page <= FILTER_PAGE_CAP; page++) {
    const batch = await client.listIssues({ project: opts.projectKey, page, ...opts.filters })
    all.push(...batch)
    if (batch.length < 50) break
    if (page === FILTER_PAGE_CAP) new Notice('NNN-PM: showing the first 1000 matches')
  }
  const buckets = new Map<string, PMIssueSummary[]>()
  for (const s of meta.statuses) buckets.set(s.key, [])
  for (const iss of all) buckets.get(iss.status)?.push(iss)
  return meta.statuses.map(s => ({ status: s.key, name: s.name, issues: buckets.get(s.key) ?? [] }))
}

function paintBoard(
  app: App,
  client: PMClient,
  container: HTMLElement,
  opts: BoardRenderOptions,
  meta: PMMeta,
  board: PMBoard,
): void {
  const reload = () => {
    void renderBoard(app, client, container, opts)
  }

  // Toolbar
  const bar = container.createDiv({ cls: 'nnn-pm-toolbar' })
  bar.style.display = 'flex'
  bar.style.gap = '8px'
  bar.style.alignItems = 'center'
  bar.style.marginBottom = '10px'
  bar.createEl('strong', { text: `${board.projectKey} board` })
  const newBtn = bar.createEl('button', { text: '+ New issue' })
  newBtn.onclick = () => new CreateIssueModal(app, client, meta, opts.projectKey, reload).open()
  const refreshBtn = bar.createEl('button', { text: '↻ Refresh' })
  refreshBtn.onclick = reload
  const manageBtn = bar.createEl('button', { text: '⚙ Manage' })
  manageBtn.onclick = () => new ProjectManageModal(app, client, opts.projectKey).open()
  const analyticsBtn = bar.createEl('button', { text: '📊 Analytics' })
  analyticsBtn.onclick = () => new AnalyticsModal(app, client, meta, opts.projectKey).open()
  const exportBtn = bar.createEl('button', { text: '⬇ Export CSV' })
  exportBtn.onclick = async () => {
    exportBtn.disabled = true
    try {
      const csv = await client.exportIssues('csv', { project: opts.projectKey })
      const fname = `NNN-PM Export - ${opts.projectKey}.csv`
      const existing = app.vault.getAbstractFileByPath(fname)
      if (existing instanceof TFile) {
        await app.vault.modify(existing, csv)
      } else {
        await app.vault.create(fname, csv)
      }
      new Notice(`Exported ${opts.projectKey} issues → ${fname}`)
    } catch (e) {
      new Notice(`NNN-PM export: ${errMsg(e)}`)
    } finally {
      exportBtn.disabled = false
    }
  }
  // Filter bar is permanent (always visible) — between the toolbar and the columns.
  renderFilterBar(container, client, opts, meta, reload)

  // Columns
  const cols = container.createDiv({ cls: 'nnn-pm-columns' })
  cols.style.display = 'flex'
  cols.style.gap = '12px'
  cols.style.overflowX = 'auto'
  cols.style.alignItems = 'flex-start'

  for (const col of board.columns) {
    const colEl = cols.createDiv({ cls: 'nnn-pm-col' })
    colEl.dataset.status = col.status
    colEl.style.minWidth = '230px'
    colEl.style.flex = '0 0 230px'
    colEl.style.background = 'var(--background-secondary)'
    colEl.style.borderRadius = '8px'
    colEl.style.padding = '8px'
    colEl.style.transition = 'opacity 120ms ease'

    const head = colEl.createDiv({ cls: 'nnn-pm-col-head' })
    head.style.fontWeight = '600'
    head.style.marginBottom = '8px'
    head.setText(`${col.name}  (${col.issues.length})`)

    const list = colEl.createDiv({ cls: 'nnn-pm-col-list' })
    list.style.minHeight = '24px'

    for (const issue of col.issues) {
      const card = list.createDiv({ cls: 'nnn-pm-card' })
      card.dataset.issueId = String(issue.id)
      card.dataset.status = issue.status
      card.draggable = true
      card.style.background = 'var(--background-primary)'
      card.style.border = '1px solid var(--background-modifier-border)'
      card.style.borderRadius = '6px'
      card.style.padding = '8px'
      card.style.marginBottom = '8px'
      card.style.cursor = 'grab'

      const top = card.createDiv()
      top.style.fontSize = '0.75rem'
      top.style.color = 'var(--text-muted)'
      top.setText(`${issue.ref} · ${issue.priority}`)
      card.createDiv({ text: issue.title })

      card.onclick = () => new IssueDetailModal(app, client, meta, issue.id, reload).open()

      card.addEventListener('dragstart', ev => {
        ev.dataTransfer?.setData('text/plain', JSON.stringify({ id: issue.id, from: issue.status }))
        card.style.opacity = '0.5'
        dimColumns(cols, meta, issue.status)
      })
      card.addEventListener('dragend', () => {
        card.style.opacity = '1'
        undimColumns(cols)
      })
    }

    colEl.addEventListener('dragover', ev => {
      if (colEl.classList.contains('nnn-pm-col-droppable')) ev.preventDefault()
    })
    colEl.addEventListener('drop', async ev => {
      ev.preventDefault()
      const raw = ev.dataTransfer?.getData('text/plain')
      if (!raw) return
      let payload: { id: number; from: string }
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      if (payload.from === col.status) return

      // Optimistic: move the card now, roll back if the server rejects.
      const card = cols.querySelector(
        `.nnn-pm-card[data-issue-id="${payload.id}"]`,
      ) as HTMLElement | null
      const prevParent = card?.parentElement ?? null
      if (card) {
        list.appendChild(card)
        card.dataset.status = col.status
      }
      try {
        await client.transition(payload.id, col.status)
        reload()
      } catch (e) {
        if (card && prevParent) {
          prevParent.appendChild(card)
          card.dataset.status = payload.from
        }
        new Notice(`NNN-PM: ${errMsg(e)}`)
      }
    })
  }
}

// renderFilterBar draws the expandable filter row. status + priority options come
// from meta (synchronous); assignee/label/epic/cycle options are fetched async and
// populated when they arrive. Each control mutates opts.filters in place and calls
// reload() — filter state persists because opts is the same object across reloads.
function renderFilterBar(
  container: HTMLElement,
  client: PMClient,
  opts: BoardRenderOptions,
  meta: PMMeta,
  reload: () => void,
): void {
  if (!opts.filters) opts.filters = {}
  const f = opts.filters
  const barEl = container.createDiv({ cls: 'nnn-pm-filterbar' })

  // Free-text search — applied on Enter or blur (not per keystroke).
  const qWrap = barEl.createDiv({ cls: 'nnn-pm-filter' })
  qWrap.createSpan({ cls: 'nnn-pm-filter-label', text: 'Search' })
  const q = qWrap.createEl('input', { type: 'text' })
  q.placeholder = 'title / text…'
  q.value = f.q ?? ''
  const applyQ = () => {
    const v = q.value.trim() || undefined
    if (v !== f.q) {
      f.q = v
      reload()
    }
  }
  q.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') applyQ()
  })
  q.addEventListener('blur', applyQ)

  // A labeled <select> seeded with "any" (value '') that sets one filter key.
  const sel = (label: string, key: keyof PMIssueFilters): HTMLSelectElement => {
    const wrap = barEl.createDiv({ cls: 'nnn-pm-filter' })
    wrap.createSpan({ cls: 'nnn-pm-filter-label', text: label })
    const s = wrap.createEl('select')
    s.createEl('option', { text: 'any' }).value = ''
    s.onchange = () => {
      f[key] = s.value || undefined
      reload()
    }
    return s
  }

  const statusSel = sel('Status', 'status')
  for (const st of meta.statuses) {
    const o = statusSel.createEl('option', { text: st.name })
    o.value = st.key
  }
  statusSel.value = f.status ?? ''

  const prioSel = sel('Priority', 'priority')
  for (const p of meta.priorities) {
    const o = prioSel.createEl('option', { text: p })
    o.value = p
  }
  prioSel.value = f.priority ?? ''

  const assigneeSel = sel('Assignee', 'assignee')
  void client
    .members(opts.projectKey)
    .then(ms => {
      for (const m of ms) {
        const o = assigneeSel.createEl('option', { text: m.username })
        o.value = String(m.userId)
      }
      assigneeSel.value = f.assignee ?? ''
    })
    .catch(() => undefined)

  const labelSel = sel('Label', 'label')
  void client
    .labels(opts.projectKey)
    .then(ls => {
      for (const l of ls) {
        const o = labelSel.createEl('option', { text: l.name })
        o.value = String(l.id)
      }
      labelSel.value = f.label ?? ''
    })
    .catch(() => undefined)

  const epicSel = sel('Epic', 'epic')
  void client
    .epics(opts.projectKey)
    .then(es => {
      for (const e of es) {
        const o = epicSel.createEl('option', { text: e.name })
        o.value = String(e.id)
      }
      epicSel.value = f.epic ?? ''
    })
    .catch(() => undefined)

  const cycleSel = sel('Cycle', 'cycle')
  void client
    .cycles(opts.projectKey)
    .then(cs => {
      for (const c of cs) {
        const o = cycleSel.createEl('option', { text: c.name })
        o.value = String(c.id)
      }
      cycleSel.value = f.cycle ?? ''
    })
    .catch(() => undefined)

  const clearBtn = barEl.createEl('button', { text: 'Clear' })
  clearBtn.onclick = () => {
    opts.filters = {}
    reload()
  }
}

// dimColumns lowers the opacity of columns the dragged card cannot move to, and
// marks valid targets droppable (per the workflow graph). The source column is
// also droppable (dropping back is a harmless no-op).
function dimColumns(cols: HTMLElement, meta: PMMeta, fromStatus: string): void {
  const allowed = new Set(meta.transitions[fromStatus] ?? [])
  cols.querySelectorAll('.nnn-pm-col').forEach(el => {
    const colEl = el as HTMLElement
    const status = colEl.dataset.status ?? ''
    if (status === fromStatus || allowed.has(status)) {
      colEl.classList.add('nnn-pm-col-droppable')
      colEl.style.opacity = '1'
    } else {
      colEl.style.opacity = '0.4'
    }
  })
}

function undimColumns(cols: HTMLElement): void {
  cols.querySelectorAll('.nnn-pm-col').forEach(el => {
    const colEl = el as HTMLElement
    colEl.classList.remove('nnn-pm-col-droppable')
    colEl.style.opacity = '1'
  })
}
