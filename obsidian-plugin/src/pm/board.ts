// Kanban board renderer (Phase 1). Self-contained vanilla DOM — no framework —
// consuming the typed PMClient. Drag a card to another column to transition it;
// invalid targets dim during the drag (from the workflow graph in /pm/meta).
//
// Re-fetch model: renderBoard() pulls /pm/meta + /pm/projects/:key/board, then
// paintBoard() draws synchronously. Any mutation (create / edit / drop) calls
// reload() which re-runs renderBoard — simple and correct for an MVP at 60 users.

import { App, Notice } from 'obsidian'
import { PMClient, PMError } from './api'
import type { PMBoard, PMMeta } from './types'
import { CreateIssueModal, IssueDetailModal } from './modals'

export interface BoardRenderOptions {
  projectKey: string
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
    const [meta, board] = await Promise.all([client.meta(), client.board(opts.projectKey)])
    container.empty()
    paintBoard(app, client, container, opts, meta, board)
  } catch (e) {
    container.empty()
    container.createEl('p', { text: `NNN-PM: ${errMsg(e)}`, cls: 'nnn-pm-error' })
  }
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
