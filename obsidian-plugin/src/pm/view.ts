// PMBoardView — a full-tab ItemView hosting the kanban board with a project
// picker. Opened via the ribbon icon or the "Open PM board" command.

import { ItemView, WorkspaceLeaf } from 'obsidian'
import { PMClient, PMError } from './api'
import { renderBoard } from './board'
import type { PMProject } from './types'

export const PM_VIEW_TYPE = 'nnn-pm-board'

export class PMBoardView extends ItemView {
  private projectKey = ''

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
    return 'NNN-PM board'
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

    const picker = contentEl.createDiv({ cls: 'nnn-pm-picker' })
    picker.style.marginBottom = '10px'
    picker.createSpan({ text: 'Project: ' })
    const select = picker.createEl('select')
    const boardHost = contentEl.createDiv({ cls: 'nnn-pm-view-host' })

    const client = this.getClient()
    let projects: PMProject[] = []
    try {
      projects = await client.projects()
    } catch (e) {
      boardHost.createEl('p', {
        text: `NNN-PM: ${e instanceof PMError ? e.message : String(e)}`,
        cls: 'nnn-pm-error',
      })
      return
    }
    if (!projects.length) {
      boardHost.createEl('p', {
        text: 'You are not a member of any project yet — ask an admin to add you.',
      })
      return
    }

    for (const p of projects) {
      select.createEl('option', { text: `${p.key} — ${p.name}`, value: p.key })
    }
    if (!this.projectKey) this.projectKey = projects[0].key
    select.value = this.projectKey

    const paint = () => {
      void renderBoard(this.app, client, boardHost, { projectKey: this.projectKey })
    }
    select.onchange = () => {
      this.projectKey = select.value
      paint()
    }
    paint()
  }
}
