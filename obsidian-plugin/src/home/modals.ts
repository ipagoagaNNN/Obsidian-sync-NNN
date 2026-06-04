// Home-tab edit modals (Phase 1).
//
// Small, dependency-free modals built on Obsidian's own Modal / FuzzySuggestModal
// / Setting primitives. All callbacks fire exactly once (cancel/close → null).

import {
  App,
  FuzzySuggestModal,
  Modal,
  Setting,
  TFile,
  TFolder,
  Vault,
  type TextComponent,
} from 'obsidian'
import type { HomeLink, HomeLinkKind } from '../types'

/** A single-line text prompt. Resolves with the entered string, or null on cancel. */
export class PromptModal extends Modal {
  private done = false
  constructor(
    app: App,
    private opts: { title: string; placeholder?: string; value?: string; cta?: string },
    private onSubmit: (value: string | null) => void,
  ) {
    super(app)
  }

  onOpen() {
    const { contentEl } = this
    contentEl.createEl('h3', { text: this.opts.title })
    const input = contentEl.createEl('input', { type: 'text', cls: 'nnn-home-prompt-input' })
    input.value = this.opts.value ?? ''
    input.placeholder = this.opts.placeholder ?? ''
    window.setTimeout(() => input.focus(), 0)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.finish(input.value)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.finish(null)
      }
    })

    const row = contentEl.createDiv({ cls: 'nnn-home-modal-actions' })
    const ok = row.createEl('button', { text: this.opts.cta ?? 'Save', cls: 'mod-cta' })
    ok.onclick = () => this.finish(input.value)
    const cancel = row.createEl('button', { text: 'Cancel' })
    cancel.onclick = () => this.finish(null)
  }

  private finish(value: string | null) {
    if (this.done) return
    this.done = true
    this.close()
    this.onSubmit(value === null ? null : value.trim())
  }

  onClose() {
    this.contentEl.empty()
    if (!this.done) {
      this.done = true
      this.onSubmit(null)
    }
  }
}

/** Fuzzy picker over every markdown note. */
export class FileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private onChoose: (file: TFile) => void,
  ) {
    super(app)
    this.setPlaceholder('Pick a note…')
  }
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles()
  }
  getItemText(file: TFile): string {
    return file.path
  }
  onChooseItem(file: TFile): void {
    this.onChoose(file)
  }
}

/** Fuzzy picker over every folder. */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onChoose: (folder: TFolder) => void,
  ) {
    super(app)
    this.setPlaceholder('Pick a folder…')
  }
  getItems(): TFolder[] {
    const out: TFolder[] = []
    Vault.recurseChildren(this.app.vault.getRoot(), (f) => {
      if (f instanceof TFolder) out.push(f)
    })
    return out
  }
  getItemText(folder: TFolder): string {
    return folder.path || '/'
  }
  onChooseItem(folder: TFolder): void {
    this.onChoose(folder)
  }
}

/** Create / edit a quick-link card. Resolves with the edited link, or null. */
export class EditLinkModal extends Modal {
  private done = false
  private link: HomeLink
  constructor(
    app: App,
    link: HomeLink,
    private onSave: (link: HomeLink | null) => void,
  ) {
    super(app)
    this.link = { ...link }
  }

  onOpen() {
    const { contentEl } = this
    const l = this.link
    contentEl.createEl('h3', { text: l.label ? 'Edit quick link' : 'New quick link' })

    new Setting(contentEl).setName('Label').addText((t) =>
      t.setValue(l.label).onChange((v) => {
        l.label = v
      }),
    )

    new Setting(contentEl).setName('Type').addDropdown((d) => {
      d.addOption('note', 'Note')
      d.addOption('folder', 'Folder')
      d.addOption('url', 'URL')
      d.addOption('pmview', 'PM view')
      d.addOption('command', 'Command')
      d.setValue(l.kind).onChange((v) => {
        l.kind = v as HomeLinkKind
      })
    })

    let targetInput: TextComponent
    new Setting(contentEl)
      .setName('Target')
      .setDesc('Note/folder path, URL, PM view id, or command id')
      .addText((t) => {
        targetInput = t
        t.setValue(l.target).onChange((v) => {
          l.target = v
        })
      })
      .addExtraButton((b) =>
        b
          .setIcon('search')
          .setTooltip('Pick a note or folder')
          .onClick(() => {
            const apply = (path: string) => {
              l.target = path
              targetInput.setValue(path)
            }
            if (l.kind === 'folder') new FolderSuggestModal(this.app, (f) => apply(f.path)).open()
            else new FileSuggestModal(this.app, (f) => apply(f.path)).open()
          }),
      )

    new Setting(contentEl)
      .setName('Icon')
      .setDesc('lucide icon id, e.g. "file-text", "folder", "link" (optional)')
      .addText((t) =>
        t.setValue(l.icon ?? '').onChange((v) => {
          l.icon = v.trim() || undefined
        }),
      )

    new Setting(contentEl).setName('Accent color').setDesc('CSS color, e.g. "#7c6cf0" (optional)').addText((t) =>
      t.setValue(l.color ?? '').onChange((v) => {
        l.color = v.trim() || undefined
      }),
    )

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Save')
          .setCta()
          .onClick(() => this.finish(true)),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
  }

  private finish(save: boolean) {
    if (this.done) return
    const l = this.link
    if (save && !l.label.trim()) {
      // derive a label from the target so an unnamed card still reads sensibly
      l.label = l.target.split('/').pop()?.replace(/\.md$/, '') || l.target || 'Untitled'
    }
    this.done = true
    this.close()
    this.onSave(save ? l : null)
  }

  onClose() {
    this.contentEl.empty()
    if (!this.done) {
      this.done = true
      this.onSave(null)
    }
  }
}
