// Note drill-down modal for the vault-plane Summary view (ADR-014, P2) — the
// VizLab modal.ts behavior, Obsidian-native: a frontmatter "properties" table
// plus the note's markdown body rendered as Obsidian shows it. A quicklink icon
// by the title opens the real file; rendered internal links are clickable too.

import { App, Component, MarkdownRenderer, Modal, TFile, setIcon } from 'obsidian'
import type { VaultRow } from '../../data/vaultAdapter'
import { renderPropsTable, stripFrontmatter, wireInternalLinks } from './note'

export class NoteModal extends Modal {
  private comp = new Component()

  constructor(
    app: App,
    private row: VaultRow,
  ) {
    super(app)
  }

  private openFile() {
    this.close()
    void this.app.workspace.openLinkText(this.row.path, '', true)
  }

  async onOpen() {
    this.comp.load()
    const { contentEl, modalEl } = this
    modalEl.addClass('nnn-pm-st-modal')
    contentEl.empty()

    const titleRow = contentEl.createDiv({ cls: 'nnn-pm-st-modal-title' })
    titleRow.createSpan({ text: `${this.row.file}.md` })
    const open = titleRow.createSpan({ cls: 'nnn-pm-st-modal-open', attr: { 'aria-label': 'Open note' } })
    setIcon(open, 'lucide-external-link')
    open.onclick = () => this.openFile()

    renderPropsTable(contentEl, this.row.frontmatter)

    const note = contentEl.createDiv({
      cls: 'nnn-pm-st-note markdown-preview-view markdown-rendered',
    })
    wireInternalLinks(this.app, note, this.row.path, () => this.close())

    const file = this.app.vault.getAbstractFileByPath(this.row.path)
    if (file instanceof TFile) {
      try {
        const raw = await this.app.vault.cachedRead(file)
        await MarkdownRenderer.render(this.app, stripFrontmatter(raw), note, this.row.path, this.comp)
      } catch {
        note.createEl('p', { cls: 'nnn-pm-st-dim', text: '(could not render note body)' })
      }
    }

    contentEl.createDiv({ cls: 'nnn-pm-st-modal-foot' }).createEl('code', { text: this.row.path })
  }

  onClose() {
    this.comp.unload()
    this.contentEl.empty()
  }
}
