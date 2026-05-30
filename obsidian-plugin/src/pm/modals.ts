// Create + detail modals for the PM board. Both consume the typed PMClient and
// surface PMError messages inline rather than throwing to the console.

import { App, Modal, Notice, Setting } from 'obsidian'
import { PMClient, PMError } from './api'
import type { PMIssueDetail, PMMeta } from './types'

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

    void this.renderActivity(contentEl, issue.id)
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
