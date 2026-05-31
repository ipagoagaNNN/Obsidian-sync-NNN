// Create + detail modals for the PM board. Both consume the typed PMClient and
// surface PMError messages inline rather than throwing to the console.

import { App, Modal, Notice, Setting } from 'obsidian'
import { PMClient, PMError } from './api'
import type {
  PMActivityEntry,
  PMAnalytics,
  PMAssignee,
  PMComment,
  PMCycle,
  PMEpic,
  PMIssueDetail,
  PMIssueLink,
  PMLabel,
  PMMember,
  PMMeta,
  PMStatusMeta,
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

  /** Workflow statuses in board order (sortOrder) — drives the status control. */
  private orderedStatuses(): PMStatusMeta[] {
    return [...this.meta.statuses].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  private renderIssue(issue: PMIssueDetail) {
    const { contentEl } = this
    contentEl.addClass('nnn-pm-detail')

    // Editable fields, shared with the footer Save button.
    let title = issue.title
    let description = issue.description
    let priority = issue.priority

    // ── Header: ref + priority chip, an at-a-glance summary grid, the status
    //    control, and a shared error line. ──────────────────────────────────────
    const header = contentEl.createDiv({ cls: 'nnn-pm-detail-header' })
    const titleRow = header.createDiv({ cls: 'nnn-pm-detail-titlerow' })
    titleRow.createEl('h2', { text: issue.ref, cls: 'nnn-pm-detail-ref' })
    titleRow.createSpan({
      cls: `nnn-pm-prio nnn-pm-prio-${issue.priority}`,
      text: issue.priority,
    })

    const grid = header.createDiv({ cls: 'nnn-pm-summary-grid' })
    const summaryCell = (k: string, v: string) => {
      const c = grid.createDiv({ cls: 'nnn-pm-summary-cell' })
      c.createDiv({ cls: 'nnn-pm-summary-key', text: k })
      c.createDiv({ cls: 'nnn-pm-summary-val', text: v })
    }
    const aCount = (issue.assignees ?? []).length
    summaryCell('Status', this.statusName(issue.status))
    summaryCell('Assignees', aCount ? `${aCount} assigned` : 'Unassigned')
    summaryCell('Dept queue', issue.assignedDepartment || '—')
    summaryCell('Updated', new Date(issue.updatedAt).toLocaleDateString())

    const errorEl = header.createEl('p', { cls: 'nnn-pm-error' })
    errorEl.style.minHeight = '1.2em'

    this.renderStatusControl(header, issue, errorEl)

    // ── Tab strip + panels ─────────────────────────────────────────────────────
    const tabDefs: { id: string; label: string }[] = [
      { id: 'details', label: 'Details' },
      { id: 'people', label: 'Assignees & Links' },
      { id: 'comments', label: 'Comments' },
      { id: 'activity', label: 'Activity' },
    ]
    const strip = contentEl.createDiv({ cls: 'nnn-pm-tabstrip' })
    const panelHost = contentEl.createDiv({ cls: 'nnn-pm-tabbody' })
    const panels: Record<string, HTMLElement> = {}
    const buttons: Record<string, HTMLButtonElement> = {}
    const select = (id: string) => {
      for (const d of tabDefs) {
        buttons[d.id].toggleClass('nnn-pm-tab-on', d.id === id)
        panels[d.id].toggleClass('nnn-pm-tab-active', d.id === id)
      }
    }
    for (const d of tabDefs) {
      const b = strip.createEl('button', { cls: 'nnn-pm-tab', text: d.label })
      buttons[d.id] = b
      panels[d.id] = panelHost.createDiv({ cls: 'nnn-pm-tabpanel' })
      b.onclick = () => select(d.id)
    }

    // Details tab: a 4-column field grid — section headers + field labels in
    // column 1, controls spanning columns 2-4 — replacing the stacked Setting rows.
    const det = panels.details
    const detailGrid = det.createDiv({ cls: 'nnn-pm-fieldgrid' })
    const section = (t: string) => detailGrid.createDiv({ cls: 'nnn-pm-fieldgrid-section', text: t })
    const field = (label: string): HTMLElement => {
      detailGrid.createDiv({ cls: 'nnn-pm-fieldgrid-label', text: label })
      return detailGrid.createDiv({ cls: 'nnn-pm-fieldgrid-control' })
    }

    section('Issue')
    const titleIn = field('Title').createEl('input', { type: 'text' })
    titleIn.value = issue.title
    titleIn.oninput = () => (title = titleIn.value)
    const descTa = field('Description').createEl('textarea')
    descTa.rows = 4
    descTa.value = issue.description
    descTa.oninput = () => (description = descTa.value)
    const prioSel = field('Priority').createEl('select')
    for (const p of this.meta.priorities) prioSel.createEl('option', { text: p }).value = p
    prioSel.value = issue.priority
    prioSel.onchange = () => (priority = prioSel.value)

    section('Classification')
    void this.renderTaxonomy(detailGrid, issue, field)

    // Assignees & Links tab.
    void this.renderAssignees(panels.people, issue)
    void this.renderLinks(panels.people, issue)
    void this.renderSubIssues(panels.people, issue)

    // Comments + Activity tabs.
    void this.renderComments(panels.comments, issue.id)
    void this.renderActivity(panels.activity, issue.id)

    // ── Footer: Save / Close (always visible, below the tab body) ──────────────
    const footer = contentEl.createDiv({ cls: 'nnn-pm-detail-footer' })
    new Setting(footer)
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

    select('details')
  }

  // Status control: a dropdown (native chevron) of the current status plus the
  // workflow's allowed transitions for it. Selecting a target transitions the
  // issue and closes (dirty) so the board reflects the move. Only legal targets
  // appear — the workflow graph (/pm/meta) still gates what's offered.
  private renderStatusControl(host: HTMLElement, issue: PMIssueDetail, errorEl: HTMLElement) {
    const wrap = host.createDiv({ cls: 'nnn-pm-status-control' })
    wrap.createSpan({ cls: 'nnn-pm-field-label', text: 'Status' })
    const sel = wrap.createEl('select', { cls: 'nnn-pm-status-select' })
    const cur = sel.createEl('option', { text: `${this.statusName(issue.status)} (current)` })
    cur.value = issue.status
    for (const to of this.meta.transitions[issue.status] ?? []) {
      sel.createEl('option', { text: `→ ${this.statusName(to)}` }).value = to
    }
    sel.value = issue.status
    sel.onchange = async () => {
      const to = sel.value
      if (to === issue.status) return
      sel.disabled = true
      try {
        await this.client.transition(issue.id, to)
        new Notice(`Moved to ${this.statusName(to)}`)
        this.dirty = true
        this.close()
      } catch (e) {
        sel.value = issue.status
        sel.disabled = false
        errorEl.setText(errMsg(e))
      }
    }
  }

  // Layer-2 + v2 taxonomy controls rendered into the shared Details field grid via
  // `field(label)` (which returns the control cell spanning columns 2-4): labels,
  // epic, cycle, parent, milestone, and the department queue. Each control mutates
  // immediately via PATCH or the label endpoints and sets this.dirty so the board
  // refreshes on close. Write-gating is server-enforced (a viewer's edit 403s).
  private async renderTaxonomy(
    grid: HTMLElement,
    issue: PMIssueDetail,
    field: (label: string) => HTMLElement,
  ) {
    // ── Labels (chips + add) ──────────────────────────────────────────────────
    const labelCell = field('Labels')
    const chips = labelCell.createDiv({ cls: 'nnn-pm-chips' })
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
    const addWrap = labelCell.createDiv({ cls: 'nnn-pm-chip-add' })
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
      .catch(() => undefined)

    // ── Epic / Cycle / Parent / Milestone selects ─────────────────────────────
    const selField = (label: string): HTMLSelectElement => {
      const sel = field(label).createEl('select')
      sel.createEl('option', { text: '— none —' }).value = '0'
      return sel
    }

    const epicSel = selField('Epic')
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

    const cycleSel = selField('Cycle')
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

    const parentSel = selField('Parent')
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
      void this.patchRelation(issue, { parentId: Number(parentSel.value) }, 'Parent', parentSel, issue.parentId)

    const msSel = selField('Milestone')
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
      void this.patchRelation(issue, { milestoneId: Number(msSel.value) }, 'Milestone', msSel, issue.milestoneId)

    // ── Department queue (v2): unclaimed work routed to a department ───────────
    const deptIn = field('Dept queue').createEl('input', { type: 'text' })
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
  }

  // Sub-issues (read-only list; click to open the child). Lives in the
  // Assignees & Links tab alongside the linked-notes section.
  private async renderSubIssues(parent: HTMLElement, issue: PMIssueDetail) {
    const subWrap = parent.createDiv({ cls: 'nnn-pm-subissues' })
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
        if (!ms.length) {
          // No project members → nobody to assign. Point the user to Manage.
          addSel.createEl('option', { text: '(no members — add in Manage)' }).disabled = true
          return
        }
        for (const m of ms) {
          const o = addSel.createEl('option', { text: `${m.username} (${m.role})` })
          o.value = String(m.userId)
        }
      })
      .catch(() => undefined)
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

  // Richer activity feed: each entry shows the actor, a humanized action phrase,
  // a parsed detail line (field changes render as "from → to"), and the timestamp.
  // The detail JSON shape is defensively handled — it's typed `unknown`.
  private async renderActivity(parent: HTMLElement, issueId: number) {
    const wrap = parent.createDiv({ cls: 'nnn-pm-activity' })
    wrap.createEl('h4', { text: 'Activity' })
    const listEl = wrap.createDiv()
    listEl.createEl('p', { text: 'Loading…', cls: 'nnn-pm-loading' })
    try {
      const items = await this.client.activity(issueId)
      listEl.empty()
      if (!items.length) {
        listEl.createEl('p', { text: 'No activity yet.', cls: 'nnn-pm-loading' })
        return
      }
      const feed = listEl.createEl('ul', { cls: 'nnn-pm-activity-feed' })
      for (const a of items.slice(0, 50)) {
        const li = feed.createEl('li', { cls: 'nnn-pm-activity-item' })
        li.createSpan({ cls: 'nnn-pm-activity-dot' })
        const main = li.createDiv({ cls: 'nnn-pm-activity-main' })
        const line = main.createDiv({ cls: 'nnn-pm-activity-line' })
        line.createSpan({ cls: 'nnn-pm-activity-actor', text: a.actor ?? 'someone' })
        line.appendText(' ')
        line.createSpan({ cls: 'nnn-pm-activity-action', text: this.activityPhrase(a) })
        const detail = this.activityDetail(a)
        if (detail) main.createDiv({ cls: 'nnn-pm-activity-detail', text: detail })
        main.createDiv({
          cls: 'nnn-pm-activity-when',
          text: new Date(a.createdAt).toLocaleString(),
        })
      }
    } catch {
      /* activity is best-effort — don't block the modal on it */
      listEl.empty()
    }
  }

  /** Humanize a snake_case action verb ("status_changed" -> "status changed"). */
  private activityPhrase(a: PMActivityEntry): string {
    return a.action.replace(/_/g, ' ')
  }

  /** Format the activity detail JSON into one line. `from`/`to` shapes render as a
   *  transition; everything else collapses to a compact "key: value" list. Never
   *  throws — `detail` is typed `unknown` and may be anything (or absent). */
  private activityDetail(a: PMActivityEntry): string {
    const d = a.detail
    if (!d || typeof d !== 'object') return ''
    const o = d as Record<string, unknown>
    if ('from' in o || 'to' in o) {
      const f = o.from == null || o.from === '' ? '∅' : String(o.from)
      const t = o.to == null || o.to === '' ? '∅' : String(o.to)
      const field = 'field' in o && o.field != null ? `${String(o.field)}: ` : ''
      return `${field}${f} → ${t}`
    }
    const parts: string[] = []
    for (const [k, v] of Object.entries(o)) {
      if (v == null || typeof v === 'object') continue
      parts.push(`${k}: ${String(v)}`)
    }
    return parts.join(' · ')
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
    void this.renderMembers(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderLabels(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderEpics(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderCycles(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
    void this.renderMilestones(contentEl.createDiv({ cls: 'nnn-pm-manage-section' }))
  }

  // Project members (migration 009): who can access the board AND who can be
  // assigned to issues — the assignee picker reads this list, so an empty roster
  // is why "can't assign" happens. Add by username; remove by the × control.
  // Server-gated to admin|lead (a viewer's add/remove 403s + surfaces a Notice).
  private async renderMembers(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Members' })
    sec.createEl('p', {
      cls: 'nnn-pm-manage-meta',
      text: 'Members can be assigned to issues. Add teammates by username.',
    })
    const listEl = sec.createDiv()
    try {
      const members = await this.client.members(this.projectKey)
      if (!members.length) listEl.createEl('p', { text: 'No members yet.', cls: 'nnn-pm-loading' })
      for (const m of members) {
        const row = listEl.createDiv({ cls: 'nnn-pm-manage-row' })
        row.createSpan({ cls: 'nnn-pm-manage-name', text: m.username })
        row.createSpan({ cls: 'nnn-pm-manage-meta', text: m.role })
        const x = row.createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
        x.setAttribute('aria-label', `Remove ${m.username}`)
        x.onclick = async () => {
          try {
            await this.client.removeMember(this.projectKey, m.userId)
            void this.renderMembers(sec)
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
    nameIn.placeholder = 'username'
    const roleSel = form.createEl('select')
    for (const r of ['member', 'lead', 'viewer']) roleSel.createEl('option', { text: r }).value = r
    const addBtn = form.createEl('button', { text: 'Add member' })
    addBtn.onclick = async () => {
      const username = nameIn.value.trim()
      if (!username) return
      addBtn.disabled = true
      try {
        await this.client.addMember(this.projectKey, { username, role: roleSel.value })
        nameIn.value = ''
        void this.renderMembers(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  private async renderMilestones(sec: HTMLElement) {
    sec.empty()
    sec.createEl('h3', { text: 'Milestones' })
    sec.createEl('p', {
      cls: 'nnn-pm-manage-meta',
      text: 'A dated delivery target with a goal (definition of done). Status + goal edit inline.',
    })
    const listEl = sec.createDiv()
    try {
      const ms = await this.client.milestones(this.projectKey)
      if (!ms.length) {
        listEl.createEl('p', { text: 'No milestones yet.', cls: 'nnn-pm-loading' })
      } else {
        const table = listEl.createEl('table', { cls: 'nnn-pm-ms-table' })
        const htr = table.createEl('thead').createEl('tr')
        for (const h of ['Milestone', 'Status', 'Due', 'Goal', '']) htr.createEl('th', { text: h })
        const tb = table.createEl('tbody')
        for (const m of ms) {
          const tr = tb.createEl('tr')
          tr.createEl('td', { cls: 'nnn-pm-ms-name', text: m.name })

          const stSel = tr.createEl('td').createEl('select', { cls: 'nnn-pm-ms-status' })
          for (const s of ['open', 'done', 'cancelled']) stSel.createEl('option', { text: s }).value = s
          stSel.value = m.status
          stSel.onchange = () => void this.patchMilestone(sec, m.id, { status: stSel.value })

          tr.createEl('td', { cls: 'nnn-pm-ms-due', text: m.dueOn ?? '—' })

          const goalIn = tr.createEl('td').createEl('input', { type: 'text', cls: 'nnn-pm-ms-goal' })
          goalIn.placeholder = 'set a goal…'
          goalIn.value = m.goal ?? ''
          let goalPrev = m.goal ?? ''
          goalIn.onchange = () => {
            const v = goalIn.value.trim()
            if (v === goalPrev) return
            goalPrev = v
            void this.patchMilestone(sec, m.id, { goal: v }, false)
          }

          const x = tr.createEl('td').createSpan({ cls: 'nnn-pm-chip-x', text: '×' })
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
      }
    } catch (e) {
      listEl.createEl('p', { text: errMsg(e), cls: 'nnn-pm-error' })
    }

    const form = sec.createDiv({ cls: 'nnn-pm-manage-form' })
    const nameIn = form.createEl('input', { type: 'text' })
    nameIn.placeholder = 'New milestone name'
    const dueIn = form.createEl('input', { type: 'date' })
    const goalNew = form.createEl('input', { type: 'text' })
    goalNew.placeholder = 'goal (optional)'
    const addBtn = form.createEl('button', { text: 'Add milestone' })
    addBtn.onclick = async () => {
      const name = nameIn.value.trim()
      if (!name) return
      addBtn.disabled = true
      try {
        await this.client.createMilestone(this.projectKey, {
          name,
          dueOn: dueIn.value || null,
          goal: goalNew.value.trim() || null,
        })
        nameIn.value = ''
        dueIn.value = ''
        goalNew.value = ''
        void this.renderMilestones(sec)
      } catch (e) {
        new Notice(`NNN-PM: ${errMsg(e)}`)
      } finally {
        addBtn.disabled = false
      }
    }
  }

  // PATCH one milestone (status / goal / due / name). `repaint` redraws the table
  // for structural edits; the inline goal input passes false so a mid-typing
  // commit doesn't steal focus.
  private async patchMilestone(
    sec: HTMLElement,
    id: number,
    fields: { name?: string; dueOn?: string | null; status?: string; goal?: string | null },
    repaint = true,
  ) {
    try {
      await this.client.updateMilestone(this.projectKey, id, fields)
      if (repaint) void this.renderMilestones(sec)
    } catch (e) {
      new Notice(`NNN-PM: ${errMsg(e)}`)
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
