// Create + detail modals for the PM board. Both consume the typed PMClient and
// surface PMError messages inline rather than throwing to the console.

import { App, Modal, Notice, Setting } from 'obsidian'
import { PMClient, PMError } from './api'
import type { PMComment, PMIssueDetail, PMMeta } from './types'

function errMsg(e: unknown): string {
  return e instanceof PMError ? e.message : e instanceof Error ? e.message : String(e)
}

// ── Create issue ──────────────────────────────────────────────────────────────

export class CreateIssueModal extends Modal {
  constructor(
    app: App,
    private client: PMClient,
    private meta: PMMeta,
    private projectKey: string,
    private onCreated: () => void,
  ) {
    super(app)
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: `New issue · ${this.projectKey}` })

    let title = ''
    let description = ''
    let priority = 'medium'

    new Setting(contentEl).setName('Title').addText(t => {
      t.inputEl.style.width = '100%'
      t.inputEl.focus()
      t.onChange(v => (title = v))
    })

    new Setting(contentEl).setName('Description').addTextArea(t => {
      t.inputEl.style.width = '100%'
      t.inputEl.rows = 4
      t.onChange(v => (description = v))
    })

    new Setting(contentEl).setName('Priority').addDropdown(d => {
      for (const p of this.meta.priorities) d.addOption(p, p)
      d.setValue('medium')
      d.onChange(v => (priority = v))
    })

    const errorEl = contentEl.createEl('p')
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    new Setting(contentEl)
      .addButton(b =>
        b
          .setButtonText('Create')
          .setCta()
          .onClick(async () => {
            if (!title.trim()) {
              errorEl.setText('Title is required.')
              return
            }
            b.setDisabled(true).setButtonText('Creating…')
            try {
              const r = await this.client.createIssue({
                project: this.projectKey,
                title: title.trim(),
                description,
                priority,
              })
              new Notice(`Created ${r.ref}`)
              this.close()
              this.onCreated()
            } catch (e) {
              errorEl.setText(errMsg(e))
              b.setDisabled(false).setButtonText('Create')
            }
          }),
      )
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
  }

  onClose() {
    this.contentEl.empty()
  }
}

// ── Issue detail / edit ───────────────────────────────────────────────────────

export class IssueDetailModal extends Modal {
  constructor(
    app: App,
    private client: PMClient,
    private meta: PMMeta,
    private issueId: number,
    private onChanged: () => void,
  ) {
    super(app)
  }

  async onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('p', { text: 'Loading…' })
    try {
      const issue = await this.client.getIssue(this.issueId)
      contentEl.empty()
      this.renderIssue(issue)
    } catch (e) {
      contentEl.empty()
      const p = contentEl.createEl('p', { text: errMsg(e) })
      p.style.color = 'var(--text-error, red)'
    }
  }

  private statusName(key: string): string {
    return this.meta.statuses.find(s => s.key === key)?.name ?? key
  }

  private renderIssue(issue: PMIssueDetail) {
    const { contentEl } = this
    contentEl.createEl('h2', { text: `${issue.ref}` })

    let title = issue.title
    let description = issue.description
    let priority = issue.priority

    new Setting(contentEl).setName('Title').addText(t => {
      t.setValue(issue.title)
      t.inputEl.style.width = '100%'
      t.onChange(v => (title = v))
    })

    new Setting(contentEl).setName('Description').addTextArea(t => {
      t.setValue(issue.description)
      t.inputEl.style.width = '100%'
      t.inputEl.rows = 5
      t.onChange(v => (description = v))
    })

    new Setting(contentEl).setName('Priority').addDropdown(d => {
      for (const p of this.meta.priorities) d.addOption(p, p)
      d.setValue(issue.priority)
      d.onChange(v => (priority = v))
    })

    const errorEl = contentEl.createEl('p')
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    // Transition buttons from the workflow graph for the current status.
    const targets = this.meta.transitions[issue.status] ?? []
    const tRow = contentEl.createDiv({ cls: 'nnn-pm-transitions' })
    tRow.style.margin = '6px 0 12px 0'
    tRow.createSpan({ text: `Status: ${this.statusName(issue.status)}` })
    if (targets.length) {
      tRow.createSpan({ text: '  →  ' })
      for (const to of targets) {
        const btn = tRow.createEl('button', { text: this.statusName(to) })
        btn.style.marginRight = '6px'
        btn.onclick = async () => {
          btn.disabled = true
          try {
            await this.client.transition(issue.id, to)
            new Notice(`Moved to ${this.statusName(to)}`)
            this.close()
            this.onChanged()
          } catch (e) {
            btn.disabled = false
            errorEl.setText(errMsg(e))
          }
        }
      }
    }

    new Setting(contentEl)
      .addButton(b =>
        b
          .setButtonText('Save')
          .setCta()
          .onClick(async () => {
            b.setDisabled(true)
            try {
              await this.client.patchIssue(issue.id, {
                title: title.trim(),
                description,
                priority,
              })
              new Notice('Saved')
              this.close()
              this.onChanged()
            } catch (e) {
              b.setDisabled(false)
              errorEl.setText(errMsg(e))
            }
          }),
      )
      .addButton(b => b.setButtonText('Close').onClick(() => this.close()))

    void this.renderComments(contentEl, issue.id)
    void this.renderActivity(contentEl, issue.id)
  }

  // Comment thread + composer (Phase 2). Bodies are rendered via setText
  // (textContent), so any HTML or @mention markup is shown as literal text —
  // the stored-XSS guard. The server fans out @mention + assignee notifications.
  private async renderComments(parent: HTMLElement, issueId: number) {
    const wrap = parent.createDiv({ cls: 'nnn-pm-comments' })
    wrap.createEl('h4', { text: 'Comments' })
    const listEl = wrap.createDiv({ cls: 'nnn-pm-comment-list' })

    const renderList = (items: PMComment[]) => {
      listEl.empty()
      if (!items.length) {
        listEl.createEl('p', { text: 'No comments yet.', cls: 'nnn-pm-loading' })
        return
      }
      for (const c of items) {
        const row = listEl.createDiv({ cls: 'nnn-pm-comment' })
        const who = c.author ?? 'someone'
        const when = new Date(c.createdAt).toLocaleString()
        row
          .createDiv({ cls: 'nnn-pm-comment-meta' })
          .setText(`${who} · ${when}${c.edited ? ' · edited' : ''}`)
        row.createDiv({ cls: 'nnn-pm-comment-body' }).setText(c.body)
      }
    }

    try {
      renderList(await this.client.comments(issueId))
    } catch (e) {
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }

    // Composer.
    const composer = wrap.createDiv({ cls: 'nnn-pm-comment-composer' })
    const ta = composer.createEl('textarea')
    ta.rows = 3
    ta.placeholder = 'Add a comment… use @username to notify someone'
    ta.style.width = '100%'
    const cErr = composer.createEl('p', { cls: 'nnn-pm-error' })
    cErr.style.minHeight = '1.2em'
    const sendBtn = composer.createEl('button', { text: 'Comment' })
    sendBtn.onclick = async () => {
      const body = ta.value.trim()
      if (!body) {
        cErr.setText('Comment cannot be empty.')
        return
      }
      sendBtn.disabled = true
      cErr.setText('')
      try {
        await this.client.createComment(issueId, body)
        ta.value = ''
        renderList(await this.client.comments(issueId))
      } catch (e) {
        cErr.setText(errMsg(e))
      } finally {
        sendBtn.disabled = false
      }
    }
  }

  private async renderActivity(parent: HTMLElement, issueId: number) {
    try {
      const items = await this.client.activity(issueId)
      const wrap = parent.createDiv({ cls: 'nnn-pm-activity' })
      wrap.createEl('h4', { text: 'Activity' })
      if (!items.length) {
        wrap.createEl('p', { text: 'No activity yet.' })
        return
      }
      const ul = wrap.createEl('ul')
      for (const a of items.slice(0, 20)) {
        const when = new Date(a.createdAt).toLocaleString()
        const who = a.actor ?? 'someone'
        ul.createEl('li', { text: `${when} — ${who} ${a.action}` })
      }
    } catch {
      /* activity is best-effort — don't block the modal on it */
    }
  }

  onClose() {
    this.contentEl.empty()
  }
}
