// Notifications inbox modal (Phase 2). Lists the caller's in-app notifications,
// marks them read (one or all), and clicks through to the issue. The unread
// COUNT lives in the status bar (main.ts) and is server-cached; this modal pulls
// the full list on demand. All text is rendered via setText (textContent), so a
// notification carrying user-authored fragments stays XSS-safe.

import { App, Modal, Notice } from 'obsidian'
import { PMClient, PMError } from './api'
import type { PMMeta, PMNotification } from './types'
import { IssueDetailModal } from './modals'

function errMsg(e: unknown): string {
  return e instanceof PMError ? e.message : e instanceof Error ? e.message : String(e)
}

/** Human sentence for a notification, e.g. "alice mentioned you in ENG-42". */
function notifLabel(n: PMNotification): string {
  const who = n.actor ?? 'someone'
  const ref = n.issueRef ?? 'an issue'
  switch (n.kind) {
    case 'mention':
      return `${who} mentioned you in ${ref}`
    case 'assigned':
      return `${who} assigned ${ref} to you`
    case 'commented':
      return `${who} commented on ${ref}`
    default:
      return `${who} · ${n.kind} · ${ref}`
  }
}

export class NotificationsModal extends Modal {
  private meta: PMMeta | null = null

  constructor(
    app: App,
    private client: PMClient,
    /** Called after any read-state change so the status-bar badge can refresh. */
    private onChanged: () => void,
  ) {
    super(app)
  }

  async onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: 'PM notifications' })
    const listEl = contentEl.createDiv({ cls: 'nnn-pm-notif-list' })
    listEl.createEl('p', { text: 'Loading…', cls: 'nnn-pm-loading' })

    // Meta is best-effort — only needed to open the issue on click-through.
    this.client
      .meta()
      .then((m) => {
        this.meta = m
      })
      .catch(() => {
        /* click-through stays disabled; the list still renders */
      })

    try {
      this.renderList(listEl, await this.client.notifications())
    } catch (e) {
      listEl.empty()
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }
  }

  private renderList(listEl: HTMLElement, items: PMNotification[]) {
    listEl.empty()

    const toolbar = listEl.createDiv({ cls: 'nnn-pm-notif-toolbar' })
    const markAll = toolbar.createEl('button', { text: 'Mark all read' })
    markAll.disabled = !items.some((n) => !n.read)
    markAll.onclick = async () => {
      markAll.disabled = true
      try {
        await this.client.markRead({ all: true })
        this.onChanged()
        await this.refresh(listEl)
      } catch (e) {
        new Notice(errMsg(e))
        markAll.disabled = false
      }
    }

    if (!items.length) {
      listEl.createEl('p', { text: 'No notifications.', cls: 'nnn-pm-loading' })
      return
    }

    for (const n of items) {
      const row = listEl.createDiv({
        cls: n.read ? 'nnn-pm-notif' : 'nnn-pm-notif nnn-pm-notif-unread',
      })
      row.createDiv({ cls: 'nnn-pm-notif-text' }).setText(notifLabel(n))
      row.createDiv({ cls: 'nnn-pm-notif-meta' }).setText(new Date(n.createdAt).toLocaleString())
      row.onclick = async () => {
        if (!n.read) {
          try {
            await this.client.markRead({ ids: [n.id] })
            this.onChanged()
          } catch {
            /* non-fatal — still try to open the issue */
          }
        }
        if (n.issueId && this.meta) {
          this.close()
          new IssueDetailModal(this.app, this.client, this.meta, n.issueId, () => {}).open()
        } else {
          await this.refresh(listEl)
        }
      }
    }
  }

  private async refresh(listEl: HTMLElement) {
    try {
      this.renderList(listEl, await this.client.notifications())
    } catch (e) {
      new Notice(errMsg(e))
    }
  }

  onClose() {
    this.contentEl.empty()
  }
}
