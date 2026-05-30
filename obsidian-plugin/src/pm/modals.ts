// Create + detail modals for the PM board. Both consume the typed PMClient and
// surface PMError messages inline rather than throwing to the console.

import { App, Modal, Notice, Setting } from 'obsidian'
import { PMClient, PMError } from './api'
import type {
  PMAnalytics,
  PMAssignee,
  PMComment,
  PMCycle,
  PMEpic,
  PMIssueDetail,
  PMIssueLink,
  PMLabel,
  PMMeta,
} from './types'

/** Markdown-file paths in the vault, for the link autocomplete + [[wikilink]]
 *  resolution. Cheap: Obsidian keeps the file list in memory (no new infra). */
function vaultNotePaths(app: App): string[] {
  return app.vault.getMarkdownFiles().map(f => f.path).sort()
}

/** Render a string into `host`, turning [[wikilink]] spans into clickable links
 *  that open the note via Obsidian. Everything else is inserted with setText
 *  (textContent) so stored markup can never inject HTML — the XSS guard. */
function renderWithWikilinks(app: App, host: HTMLElement, text: string): void {
  const re = /\[\[([^\]]+)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) host.appendText(text.slice(last, m.index))
    const target = m[1].trim()
    const a = host.createSpan({ cls: 'nnn-pm-wikilink', text: m[1] })
    a.onclick = () => app.workspace.openLinkText(target, '', false)
    last = re.lastIndex
  }
  if (last < text.length) host.appendText(text.slice(last))
}

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

    // Labels-in-create (K5): toggle chips over the project's labels; selected
    // ids are attached right after the issue is created.
    const selectedLabels = new Set<number>()
    const labelRow = contentEl.createDiv({ cls: 'nnn-pm-detail-row' })
    labelRow.createSpan({ cls: 'nnn-pm-detail-label', text: 'Labels' })
    const labelChips = labelRow.createDiv({ cls: 'nnn-pm-chips' })
    void this.client
      .labels(this.projectKey)
      .then(all => {
        if (!all.length) {
          labelChips.createSpan({ cls: 'nnn-pm-loading', text: 'none (add in Manage)' })
          return
        }
        for (const l of all) {
          const chip = labelChips.createSpan({ cls: 'nnn-pm-chip nnn-pm-chip-toggle' })
          const dot = chip.createSpan({ cls: 'nnn-pm-chip-dot' })
          dot.style.background = l.color || '#888888'
          chip.createSpan({ text: l.name })
          chip.onclick = () => {
            if (selectedLabels.has(l.id)) {
              selectedLabels.delete(l.id)
              chip.removeClass('nnn-pm-chip-on')
            } else {
              selectedLabels.add(l.id)
              chip.addClass('nnn-pm-chip-on')
            }
          }
        }
      })
      .catch(() => {
        /* no labels / no permission — leave the row empty */
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
              // Attach any selected labels (best-effort; the issue already exists).
              for (const id of selectedLabels) {
                try {
                  await this.client.attachLabel(r.id, id)
                } catch {
                  /* a single label attach failing shouldn't block the create */
                }
              }
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

  // Set by any mutation that doesn't itself close the modal (label attach/detach,
  // epic/cycle/parent change) and by Save/transition. onClose fans out a single
  // board reload when dirty, so the card grid reflects every change made here.
  private dirty = false

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
            this.dirty = true
            this.close()
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
              this.dirty = true
              this.close()
            } catch (e) {
              b.setDisabled(false)
              errorEl.setText(errMsg(e))
            }
          }),
      )
      .addButton(b => b.setButtonText('Close').onClick(() => this.close()))

    void this.renderDetails(contentEl, issue)
    void this.renderComments(contentEl, issue.id)
    void this.renderActivity(contentEl, issue.id)
  }

  // Layer-2 relations (migration 011): labels (chips + attach), epic, cycle, and
  // parent. Each control mutates immediately via PATCH /pm/issues/:id (epic/cycle/
  // parent) or the label attach/detach endpoints, and sets this.dirty so the board
  // refreshes on close. Write-gating is server-enforced (a viewer's edit 403s and
  // surfaces inline) — matching the existing Save/transition controls, which are
  // likewise shown to everyone and rely on the backend's deny-by-default check.
  private async renderDetails(parent: HTMLElement, issue: PMIssueDetail) {
    const wrap = parent.createDiv({ cls: 'nnn-pm-details' })
    wrap.createEl('h4', { text: 'Details' })

    // ── Labels (chips + add) ──────────────────────────────────────────────────
    const labelRow = wrap.createDiv({ cls: 'nnn-pm-detail-row' })
    labelRow.createSpan({ cls: 'nnn-pm-detail-label', text: 'Labels' })
    const chips = labelRow.createDiv({ cls: 'nnn-pm-chips' })

    const repaintChips = (labels: PMLabel[]) => {
      chips.empty()
      if (!labels.length) {
        chips.createSpan({ cls: 'nnn-pm-loading', text: 'none' })
        return
      }
      for (const l of labels) {
        const chip = chips.createSpan({ cls: 'nnn-pm-chip' })
        const dot = chip.createSpan({ cls: 'nnn-pm-chip-dot' })
        dot.style.background = l.color || '#888888'
        chip.createSpan({ text: l.name }) // setText path — name shown literally
        const x = chip.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Remove ${l.name}`)
        x.onclick = async () => {
          try {
            await this.client.detachLabel(issue.id, l.id)
            this.dirty = true
            repaintChips(await this.client.issueLabels(issue.id))
          } catch (e) {
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
      }
    }
    repaintChips(issue.labels ?? [])

    const addWrap = labelRow.createDiv({ cls: 'nnn-pm-chip-add' })
    const addSel = addWrap.createEl('select')
    addSel.createEl('option', { text: '— add label —' }).value = '0'
    const addBtn = addWrap.createEl('button', { text: '+ Label' })
    addBtn.onclick = async () => {
      const labelId = Number(addSel.value)
      if (!labelId) return
      try {
        await this.client.attachLabel(issue.id, labelId)
        this.dirty = true
        repaintChips(await this.client.issueLabels(issue.id))
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      }
    }
    void this.client
      .labels(issue.projectKey)
      .then(all => {
        for (const l of all) {
          const o = addSel.createEl('option', { text: l.name })
          o.value = String(l.id)
        }
      })
      .catch(() => {
        /* no project labels yet, or no permission to list — leave just the placeholder */
      })

    // ── Epic / Cycle / Parent selects ─────────────────────────────────────────
    const epicSel = this.detailSelect(wrap, 'Epic')
    void this.client
      .epics(issue.projectKey)
      .then(eps => {
        for (const e of eps) {
          const o = epicSel.createEl('option', { text: e.name })
          o.value = String(e.id)
        }
        epicSel.value = issue.epicId ? String(issue.epicId) : '0'
      })
      .catch(() => undefined)
    epicSel.onchange = () =>
      void this.patchRelation(issue, { epicId: Number(epicSel.value) }, 'Epic', epicSel, issue.epicId)

    const cycleSel = this.detailSelect(wrap, 'Cycle')
    void this.client
      .cycles(issue.projectKey)
      .then(cs => {
        for (const c of cs) {
          const range = c.startsOn || c.endsOn ? ` (${c.startsOn ?? '…'} → ${c.endsOn ?? '…'})` : ''
          const o = cycleSel.createEl('option', { text: `${c.name}${range}` })
          o.value = String(c.id)
        }
        cycleSel.value = issue.cycleId ? String(issue.cycleId) : '0'
      })
      .catch(() => undefined)
    cycleSel.onchange = () =>
      void this.patchRelation(issue, { cycleId: Number(cycleSel.value) }, 'Cycle', cycleSel, issue.cycleId)

    const parentSel = this.detailSelect(wrap, 'Parent')
    void this.client
      .board(issue.projectKey)
      .then(board => {
        for (const i of board.columns.flatMap(c => c.issues)) {
          if (i.id === issue.id) continue // can't parent to self
          const o = parentSel.createEl('option', { text: `${i.ref} · ${i.title}` })
          o.value = String(i.id)
        }
        parentSel.value = issue.parentId ? String(issue.parentId) : '0'
      })
      .catch(() => undefined)
    parentSel.onchange = () =>
      void this.patchRelation(
        issue,
        { parentId: Number(parentSel.value) },
        'Parent',
        parentSel,
        issue.parentId,
      )

    // ── Milestone select (v2) ─────────────────────────────────────────────────
    const msSel = this.detailSelect(wrap, 'Milestone')
    void this.client
      .milestones(issue.projectKey)
      .then(ms => {
        for (const m of ms) {
          const due = m.dueOn ? ` (due ${m.dueOn})` : ''
          const o = msSel.createEl('option', { text: `${m.name}${due}` })
          o.value = String(m.id)
        }
        msSel.value = issue.milestoneId ? String(issue.milestoneId) : '0'
      })
      .catch(() => undefined)
    msSel.onchange = () =>
      void this.patchRelation(
        issue,
        { milestoneId: Number(msSel.value) },
        'Milestone',
        msSel,
        issue.milestoneId,
      )

    // ── Department queue (v2): unclaimed work routed to a department ───────────
    const deptRow = wrap.createDiv({ cls: 'nnn-pm-detail-row' })
    deptRow.createSpan({ cls: 'nnn-pm-detail-label', text: 'Dept queue' })
    const deptIn = deptRow.createEl('input', { type: 'text' })
    deptIn.placeholder = 'e.g. engineering (blank = unqueued)'
    deptIn.value = issue.assignedDepartment ?? ''
    let deptPrev = issue.assignedDepartment ?? ''
    deptIn.onchange = async () => {
      const v = deptIn.value.trim()
      if (v === deptPrev) return
      try {
        await this.client.patchIssue(issue.id, { assignedDepartment: v })
        deptPrev = v
        this.dirty = true
        new Notice('Department queue updated')
      } catch (e) {
        deptIn.value = deptPrev
        new Notice(`NNN-PM: ${errMsg(e)}`)
      }
    }

    // ── Assignees (multi-assignee + per-user status) ──────────────────────────
    void this.renderAssignees(wrap, issue)

    // ── Linked notes (v2: leverage that notes are files) ──────────────────────
    void this.renderLinks(wrap, issue)

    // ── Sub-issues (read-only list; click to open) ────────────────────────────
    const subWrap = wrap.createDiv({ cls: 'nnn-pm-subissues' })
    subWrap.createEl('h4', { text: 'Sub-issues' })
    try {
      const kids = await this.client.children(issue.id)
      if (!kids.length) {
        subWrap.createEl('p', { text: 'No sub-issues.', cls: 'nnn-pm-loading' })
      } else {
        const ul = subWrap.createEl('ul', { cls: 'nnn-pm-subissue-list' })
        for (const k of kids) {
          const li = ul.createEl('li')
          const a = li.createSpan({ cls: 'nnn-pm-subissue-link', text: `${k.ref} · ${k.title}` })
          a.onclick = () => {
            // close() flushes this modal's pending reload (if dirty); the child
            // opens fresh on top and reloads again on its own close.
            this.close()
            new IssueDetailModal(this.app, this.client, this.meta, k.id, this.onChanged).open()
          }
        }
      }
    } catch {
      /* sub-issues are best-effort — don't block the modal */
    }
  }

  /** A labeled <select> row seeded with a "— none —" (value 0) option. */
  private detailSelect(parent: HTMLElement, label: string): HTMLSelectElement {
    const row = parent.createDiv({ cls: 'nnn-pm-detail-row' })
    row.createSpan({ cls: 'nnn-pm-detail-label', text: label })
    const sel = row.createEl('select')
    sel.createEl('option', { text: '— none —' }).value = '0'
    return sel
  }

  /** PATCH one relation field; on error surface a Notice and revert the select. */
  private async patchRelation(
    issue: PMIssueDetail,
    fields: { epicId?: number; cycleId?: number; parentId?: number; milestoneId?: number },
    label: string,
    sel: HTMLSelectElement,
    prev?: number | null,
  ) {
    try {
      await this.client.patchIssue(issue.id, fields)
      this.dirty = true
      new Notice(`${label} updated`)
    } catch (e) {
      sel.value = prev ? String(prev) : '0'
      new Notice(`NNN-PM: ${errMsg(e)}`)
    }
  }

  // ── Multi-assignee + per-user status (v2) ──────────────────────────────────
  // Each assignee gets a per-user status select (their personal progress on the
  // issue, distinct from the issue's workflow status) + a remove control. The add
  // control is a member picker. Every mutation re-fetches + repaints in place and
  // sets dirty so the board card's assignee badge refreshes on close.
  private async renderAssignees(parent: HTMLElement, issue: PMIssueDetail) {
    const wrap = parent.createDiv({ cls: 'nnn-pm-assignees' })
    wrap.createEl('h4', { text: 'Assignees' })
    const listEl = wrap.createDiv({ cls: 'nnn-pm-assignee-list' })

    const statusOpts = this.meta.statuses.map(s => ({ key: s.key, name: s.name }))

    const repaint = (rows: PMAssignee[]) => {
      listEl.empty()
      if (!rows.length) {
        listEl.createSpan({ cls: 'nnn-pm-loading', text: 'Unassigned' })
        return
      }
      for (const a of rows) {
        const row = listEl.createDiv({ cls: 'nnn-pm-assignee-row' })
        row.createSpan({ cls: 'nnn-pm-assignee-name', text: a.username })
        const sSel = row.createEl('select', { cls: 'nnn-pm-assignee-status' })
        let hasCur = false
        for (const o of statusOpts) {
          const opt = sSel.createEl('option', { text: o.name })
          opt.value = o.key
          if (o.key === a.status) hasCur = true
        }
        if (!hasCur) {
          // Per-user status uses a free vocab; surface an unknown value as-is.
          const opt = sSel.createEl('option', { text: a.status })
          opt.value = a.status
        }
        sSel.value = a.status
        sSel.onchange = async () => {
          try {
            await this.client.setAssigneeStatus(issue.id, a.userId, sSel.value)
            this.dirty = true
          } catch (e) {
            sSel.value = a.status
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
        const x = row.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Remove ${a.username}`)
        x.onclick = async () => {
          try {
            await this.client.removeAssignee(issue.id, a.userId)
            this.dirty = true
            repaint(await this.client.assignees(issue.id))
          } catch (e) {
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
      }
    }
    repaint(issue.assignees ?? [])

    // Add control: member picker + Add.
    const addWrap = wrap.createDiv({ cls: 'nnn-pm-chip-add' })
    const addSel = addWrap.createEl('select')
    addSel.createEl('option', { text: '— add assignee —' }).value = '0'
    const addBtn = addWrap.createEl('button', { text: '+ Assignee' })
    addBtn.onclick = async () => {
      const userId = Number(addSel.value)
      if (!userId) return
      try {
        await this.client.addAssignee(issue.id, userId)
        this.dirty = true
        repaint(await this.client.assignees(issue.id))
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      }
    }
    void this.client
      .members(issue.projectKey)
      .then(ms => {
        for (const m of ms) {
          const o = addSel.createEl('option', { text: `${m.username} (${m.role})` })
          o.value = String(m.userId)
        }
      })
      .catch(() => {
        /* no permission to list members, or none — leave just the placeholder */
      })
  }

  // ── Linked notes / urls (v2: "leverage that notes are files") ───────────────
  // note-kind links open the vault note via Obsidian; the add input autocompletes
  // against the in-memory markdown-file list (no new infra). Stored as literal
  // text and rendered via setText / openLinkText — never innerHTML.
  private async renderLinks(parent: HTMLElement, issue: PMIssueDetail) {
    const wrap = parent.createDiv({ cls: 'nnn-pm-links' })
    wrap.createEl('h4', { text: 'Linked notes' })
    const listEl = wrap.createDiv({ cls: 'nnn-pm-link-list' })

    const repaint = (rows: PMIssueLink[]) => {
      listEl.empty()
      if (!rows.length) {
        listEl.createEl('p', { text: 'No linked notes.', cls: 'nnn-pm-loading' })
        return
      }
      for (const l of rows) {
        const row = listEl.createDiv({ cls: 'nnn-pm-link-row' })
        if (l.kind === 'note') {
          const a = row.createSpan({ cls: 'nnn-pm-subissue-link', text: l.targetPath })
          a.onclick = () => this.app.workspace.openLinkText(l.targetPath, '', false)
        } else {
          row.createSpan({ text: `${l.targetPath} (${l.kind})` })
        }
        const x = row.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Remove link`)
        x.onclick = async () => {
          try {
            await this.client.deleteLink(issue.id, l.id)
            this.dirty = true
            repaint(await this.client.links(issue.id))
          } catch (e) {
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
      }
    }
    repaint(issue.links ?? [])

    // Add control: a text input backed by a <datalist> of vault note paths.
    const addWrap = wrap.createDiv({ cls: 'nnn-pm-chip-add' })
    const listId = `nnn-pm-notes-${issue.id}`
    const dl = addWrap.createEl('datalist')
    dl.id = listId
    for (const p of vaultNotePaths(this.app)) {
      dl.createEl('option').value = p
    }
    const pathIn = addWrap.createEl('input', { type: 'text' })
    pathIn.placeholder = 'Note path or [[link]] …'
    pathIn.setAttribute('list', listId)
    const addBtn = addWrap.createEl('button', { text: '+ Link note' })
    addBtn.onclick = async () => {
      let v = pathIn.value.trim()
      if (!v) return
      // Accept a [[wikilink]] paste too — strip the brackets to store the path.
      const wl = v.match(/^\[\[([^\]]+)\]\]$/)
      if (wl) v = wl[1].trim()
      try {
        await this.client.addLink(issue.id, v, 'note')
        pathIn.value = ''
        this.dirty = true
        repaint(await this.client.links(issue.id))
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      }
    }
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
        // [[wikilinks]] in the body render as clickable note links; all other
        // text is inserted as textContent (the stored-XSS guard is preserved).
        renderWithWikilinks(this.app, row.createDiv({ cls: 'nnn-pm-comment-body' }), c.body)
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
    ta.placeholder = 'Add a comment… @username to notify, [[note]] to link a file'
    ta.style.width = '100%'

    // Note-link autocomplete: a datalist-backed picker that inserts [[path]] at
    // the textarea caret. No fragile in-textarea popup — Obsidian's file list
    // drives the suggestions (no new infra), and the link renders clickable above.
    const linker = composer.createDiv({ cls: 'nnn-pm-chip-add' })
    const dlId = `nnn-pm-cnote-${issueId}`
    const dl = linker.createEl('datalist')
    dl.id = dlId
    for (const p of vaultNotePaths(this.app)) dl.createEl('option').value = p
    const noteIn = linker.createEl('input', { type: 'text' })
    noteIn.placeholder = 'Insert [[note]] …'
    noteIn.setAttribute('list', dlId)
    const insertBtn = linker.createEl('button', { text: 'Insert link' })
    insertBtn.onclick = () => {
      const v = noteIn.value.trim()
      if (!v) return
      const snippet = `[[${v}]]`
      const at = ta.selectionStart ?? ta.value.length
      ta.value = ta.value.slice(0, at) + snippet + ta.value.slice(ta.selectionEnd ?? at)
      noteIn.value = ''
      ta.focus()
    }

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
    // Fan out exactly one board reload if anything changed (Save, transition, or
    // any in-place layer-2 edit). Reset first so a re-open doesn't double-fire.
    if (this.dirty) {
      this.dirty = false
      this.onChanged()
    }
  }
}

// ── Project management (labels / epics / cycles) ───────────────────────────────
// Create + delete the project-scoped taxonomy that the issue-detail dropdowns
// consume. Write-gating is server-enforced (label create/delete = manage; epic/
// cycle create = write); a forbidden action surfaces a Notice rather than being
// hidden. Self-contained: each section re-fetches and repaints after a mutation.

export class ProjectManageModal extends Modal {
  constructor(
    app: App,
    private client: PMClient,
    private projectKey: string,
  ) {
    super(app)
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('nnn-pm-manage')
    contentEl.createEl('h2', { text: `Manage · ${this.projectKey}` })
    void this.renderLabels(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderEpics(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderCycles(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderMilestones(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
  }

  private async renderMilestones(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Milestones' })
    const listEl = sec.createDiv()
    try {
      const ms = await this.client.milestones(this.projectKey)
      if (!ms.length) listEl.createEl('p', { text: 'No milestones yet.', cls: 'nnn-pm-loading' })
      for (const m of ms) {
        const row = listEl.createDiv({ cls: 'nnn-pm-manage-row' })
        row.createSpan({ cls: 'nnn-pm-manage-name', text: m.name })
        const meta = m.dueOn ? `due ${m.dueOn} · ${m.status}` : m.status
        row.createSpan({ cls: 'nnn-pm-manage-meta', text: meta })
        const x = row.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Delete ${m.name}`)
        x.onclick = async () => {
          try {
            await this.client.deleteMilestone(this.projectKey, m.id)
            void this.renderMilestones(sec)
          } catch (e) {
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
      }
    } catch (e) {
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }

    const form = sec.createDiv({ cls: 'nnn-pm-manage-form' })
    const nameIn = form.createEl('input', { type: 'text' })
    nameIn.placeholder = 'New milestone name'
    const dueIn = form.createEl('input', { type: 'date' })
    const addBtn = form.createEl('button', { text: 'Add milestone' })
    addBtn.onclick = async () => {
      const name = nameIn.value.trim()
      if (!name) return
      addBtn.disabled = true
      try {
        await this.client.createMilestone(this.projectKey, { name, dueOn: dueIn.value || null })
        nameIn.value = ''
        dueIn.value = ''
        void this.renderMilestones(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  private async renderLabels(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Labels' })
    const listEl = sec.createDiv({ cls: 'nnn-pm-chips' })
    try {
      const labels = await this.client.labels(this.projectKey)
      if (!labels.length) listEl.createSpan({ cls: 'nnn-pm-loading', text: 'No labels yet.' })
      for (const l of labels) {
        const chip = listEl.createSpan({ cls: 'nnn-pm-chip' })
        const dot = chip.createSpan({ cls: 'nnn-pm-chip-dot' })
        dot.style.background = l.color || '#888888'
        chip.createSpan({ text: l.name })
        const x = chip.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Delete ${l.name}`)
        x.onclick = async () => {
          try {
            await this.client.deleteLabel(this.projectKey, l.id)
            void this.renderLabels(sec)
          } catch (e) {
            new Notice(`NNN-PM: ${errMsg(e)}`)
          }
        }
      }
    } catch (e) {
      listEl.createSpan({ cls: 'nnn-pm-error', text: errMsg(e) })
    }

    const form = sec.createDiv({ cls: 'nnn-pm-manage-form' })
    const nameIn = form.createEl('input', { type: 'text' })
    nameIn.placeholder = 'New label name'
    const colorIn = form.createEl('input', { type: 'color' })
    colorIn.value = '#888888'
    const addBtn = form.createEl('button', { text: 'Add label' })
    addBtn.onclick = async () => {
      const name = nameIn.value.trim()
      if (!name) return
      addBtn.disabled = true
      try {
        await this.client.createLabel(this.projectKey, { name, color: colorIn.value })
        nameIn.value = ''
        void this.renderLabels(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  private async renderEpics(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Epics' })
    const listEl = sec.createDiv()
    try {
      const epics = await this.client.epics(this.projectKey)
      if (!epics.length) listEl.createEl('p', { text: 'No epics yet.', cls: 'nnn-pm-loading' })
      for (const e of epics) {
        const row = listEl.createDiv({ cls: 'nnn-pm-manage-row' })
        row.createSpan({ cls: 'nnn-pm-manage-name', text: e.name })
        row.createSpan({ cls: 'nnn-pm-manage-meta', text: e.status })
      }
    } catch (e) {
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }

    const form = sec.createDiv({ cls: 'nnn-pm-manage-form' })
    const nameIn = form.createEl('input', { type: 'text' })
    nameIn.placeholder = 'New epic name'
    const descIn = form.createEl('input', { type: 'text' })
    descIn.placeholder = 'Description (optional)'
    const addBtn = form.createEl('button', { text: 'Add epic' })
    addBtn.onclick = async () => {
      const name = nameIn.value.trim()
      if (!name) return
      addBtn.disabled = true
      try {
        await this.client.createEpic(this.projectKey, { name, description: descIn.value })
        nameIn.value = ''
        descIn.value = ''
        void this.renderEpics(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  private async renderCycles(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Cycles' })
    const listEl = sec.createDiv()
    try {
      const cycles = await this.client.cycles(this.projectKey)
      if (!cycles.length) listEl.createEl('p', { text: 'No cycles yet.', cls: 'nnn-pm-loading' })
      for (const c of cycles) {
        const row = listEl.createDiv({ cls: 'nnn-pm-manage-row' })
        row.createSpan({ cls: 'nnn-pm-manage-name', text: c.name })
        const range = c.startsOn || c.endsOn ? `${c.startsOn ?? '…'} → ${c.endsOn ?? '…'}` : ''
        if (range) row.createSpan({ cls: 'nnn-pm-manage-meta', text: range })
      }
    } catch (e) {
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }

    const form = sec.createDiv({ cls: 'nnn-pm-manage-form' })
    const nameIn = form.createEl('input', { type: 'text' })
    nameIn.placeholder = 'New cycle name'
    const startIn = form.createEl('input', { type: 'date' })
    const endIn = form.createEl('input', { type: 'date' })
    const addBtn = form.createEl('button', { text: 'Add cycle' })
    addBtn.onclick = async () => {
      const name = nameIn.value.trim()
      if (!name) return
      addBtn.disabled = true
      try {
        await this.client.createCycle(this.projectKey, {
          name,
          startsOn: startIn.value || null,
          endsOn: endIn.value || null,
        })
        nameIn.value = ''
        startIn.value = ''
        endIn.value = ''
        void this.renderCycles(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  onClose() {
    this.contentEl.empty()
  }
}

// ── Analytics (read-only rollup) ───────────────────────────────────────────────
// Renders the on-demand GET /pm/projects/:key/analytics payload: totals, a
// status + priority breakdown as proportional bars, and the assignee workload.

export class AnalyticsModal extends Modal {
  constructor(
    app: App,
    private client: PMClient,
    private meta: PMMeta,
    private projectKey: string,
  ) {
    super(app)
  }

  async onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('nnn-pm-analytics')
    contentEl.createEl('h2', { text: `Analytics · ${this.projectKey}` })
    contentEl.createEl('p', { text: 'Loading…', cls: 'nnn-pm-loading' })
    try {
      const a = await this.client.analytics(this.projectKey)
      contentEl.empty()
      contentEl.createEl('h2', { text: `Analytics · ${this.projectKey}` })
      this.renderAnalytics(contentEl, a)
    } catch (e) {
      contentEl.empty()
      contentEl.createEl('h2', { text: `Analytics · ${this.projectKey}` })
      contentEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }
  }

  private statusName(key: string): string {
    return this.meta.statuses.find(s => s.key === key)?.name ?? key
  }

  private renderAnalytics(parent: HTMLElement, a: PMAnalytics) {
    // Totals
    const totals = parent.createDiv({ cls: 'nnn-pm-stat-row' })
    this.stat(totals, 'Open', a.totals.active)
    this.stat(totals, 'Done', a.totals.done)
    this.stat(totals, 'Unassigned', a.totals.unassigned)

    // By status (named) + by priority — proportional bars.
    this.bars(
      parent,
      'By status',
      Object.entries(a.byStatus).map(([k, v]): [string, number] => [this.statusName(k), v]),
    )
    this.bars(parent, 'By priority', Object.entries(a.byPriority))

    // Workload table.
    const wWrap = parent.createDiv({ cls: 'nnn-pm-analytics-block' })
    wWrap.createEl('h4', { text: 'Workload (open issues by assignee)' })
    if (!a.workload.length) {
      wWrap.createEl('p', { text: 'No assigned open issues.', cls: 'nnn-pm-loading' })
      return
    }
    const table = wWrap.createEl('table', { cls: 'nnn-pm-table' })
    const head = table.createEl('tr')
    head.createEl('th', { text: 'Assignee' })
    head.createEl('th', { text: 'Open' })
    for (const row of a.workload) {
      const tr = table.createEl('tr')
      tr.createEl('td', { text: row.assignee })
      tr.createEl('td', { text: String(row.open) })
    }
  }

  private stat(parent: HTMLElement, label: string, value: number) {
    const box = parent.createDiv({ cls: 'nnn-pm-stat' })
    box.createDiv({ cls: 'nnn-pm-stat-value', text: String(value) })
    box.createDiv({ cls: 'nnn-pm-stat-label', text: label })
  }

  private bars(parent: HTMLElement, title: string, entries: [string, number][]) {
    const block = parent.createDiv({ cls: 'nnn-pm-analytics-block' })
    block.createEl('h4', { text: title })
    if (!entries.length) {
      block.createEl('p', { text: 'No data.', cls: 'nnn-pm-loading' })
      return
    }
    const max = Math.max(...entries.map(([, v]) => v), 1)
    for (const [k, v] of entries) {
      const row = block.createDiv({ cls: 'nnn-pm-bar-row' })
      row.createSpan({ cls: 'nnn-pm-bar-label', text: k })
      const track = row.createDiv({ cls: 'nnn-pm-bar-track' })
      const fill = track.createDiv({ cls: 'nnn-pm-bar-fill' })
      fill.style.width = `${Math.round((v / max) * 100)}%`
      row.createSpan({ cls: 'nnn-pm-bar-value', text: String(v) })
    }
  }

  onClose() {
    this.contentEl.empty()
  }
}
