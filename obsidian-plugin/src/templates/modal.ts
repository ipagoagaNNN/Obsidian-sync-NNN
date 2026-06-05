// New-from-template UI (Phase 3): a fuzzy template picker + a single-form
// property wizard. Native Obsidian Modal / FuzzySuggestModal / Setting only —
// no Templater, no `<% %>` syntax (clean-room, AGPL-safe).

import { App, FuzzySuggestModal, Modal, Notice, Setting } from 'obsidian'
import { FolderSuggestModal } from '../home/modals'
import { fillTokens, type TemplateField, type TemplateSpec, type TemplateValues } from './registry'

export interface NewNoteRequest {
  values: TemplateValues
  fileName: string
  destFolder: string
}

/** Fuzzy picker over the available templates. */
export class TemplatePickModal extends FuzzySuggestModal<TemplateSpec> {
  constructor(
    app: App,
    private specs: TemplateSpec[],
    private onPick: (spec: TemplateSpec) => void,
  ) {
    super(app)
    this.setPlaceholder('Pick a template…')
  }
  getItems(): TemplateSpec[] {
    return this.specs
  }
  getItemText(spec: TemplateSpec): string {
    return spec.name
  }
  onChooseItem(spec: TemplateSpec): void {
    this.onPick(spec)
  }
}

/** One-screen form: a row per schema field + file name + destination folder. */
export class TemplateFormModal extends Modal {
  private values: TemplateValues = {}
  private fileNameInput?: HTMLInputElement
  private fileNameTouched = false
  private folderInput?: HTMLInputElement
  private done = false

  constructor(
    app: App,
    private spec: TemplateSpec,
    private opts: { defaultDest: string },
    private onSubmit: (req: NewNoteRequest | null) => void,
  ) {
    super(app)
    // Seed defaults from the schema.
    for (const f of spec.fields) {
      if (f.default !== undefined) {
        this.values[f.key] = typeof f.default === 'boolean' ? f.default : String(f.default)
      }
    }
  }

  onOpen() {
    const { contentEl } = this
    contentEl.addClass('nnn-tmpl-modal')
    contentEl.createEl('h3', { text: `New from “${this.spec.name}”` })
    if (this.spec.fields.length === 0) {
      contentEl.createEl('p', {
        cls: 'nnn-tmpl-hint',
        text: 'This template has no properties — it will be copied as a new note.',
      })
    }

    for (const f of this.spec.fields) this.renderField(contentEl, f)

    contentEl.createEl('hr')

    new Setting(contentEl)
      .setName('File name')
      .setDesc('Name of the new note (without “.md”).')
      .addText((t) => {
        this.fileNameInput = t.inputEl
        t.setPlaceholder(this.spec.titlePattern ? 'Filled from the title' : this.spec.name)
        const seed = this.suggestFileName()
        if (seed) t.setValue(seed)
        t.inputEl.addEventListener('input', () => {
          this.fileNameTouched = true
        })
      })

    new Setting(contentEl)
      .setName('Folder')
      .setDesc('Destination folder (blank = vault root).')
      .addText((t) => {
        this.folderInput = t.inputEl
        t.setPlaceholder('e.g. Meetings')
        t.setValue(this.opts.defaultDest)
      })
      .addExtraButton((b) =>
        b
          .setIcon('folder')
          .setTooltip('Pick a folder')
          .onClick(() => {
            new FolderSuggestModal(this.app, (folder) => {
              if (this.folderInput) this.folderInput.value = folder.path
            }).open()
          }),
      )

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Create').setCta().onClick(() => this.finish(true)))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
  }

  private renderField(parent: HTMLElement, f: TemplateField) {
    const s = new Setting(parent).setName(f.label + (f.required ? ' *' : ''))
    if (f.description) s.setDesc(f.description)
    const cur = this.values[f.key]
    switch (f.kind) {
      case 'enum':
        s.addDropdown((d) => {
          d.addOption('', '—')
          for (const o of f.options) d.addOption(o, o)
          d.setValue(typeof cur === 'string' ? cur : '')
          d.onChange((v) => {
            this.values[f.key] = v
            this.maybeSyncName(f, v)
          })
        })
        break
      case 'checkbox':
        s.addToggle((t) => {
          t.setValue(cur === true)
          t.onChange((v) => {
            this.values[f.key] = v
          })
        })
        break
      case 'textarea':
        s.addTextArea((t) => {
          t.setValue(typeof cur === 'string' ? cur : '')
          t.onChange((v) => {
            this.values[f.key] = v
          })
        })
        break
      case 'date':
        s.addText((t) => {
          t.inputEl.type = 'date'
          t.setValue(typeof cur === 'string' ? cur : '')
          t.onChange((v) => {
            this.values[f.key] = v
            this.maybeSyncName(f, v)
          })
        })
        break
      case 'number':
        s.addText((t) => {
          t.inputEl.type = 'number'
          t.setValue(typeof cur === 'string' ? cur : '')
          t.onChange((v) => {
            this.values[f.key] = v
          })
        })
        break
      case 'tags':
        s.addText((t) => {
          t.setPlaceholder('comma, separated')
          t.setValue(typeof cur === 'string' ? cur : '')
          t.onChange((v) => {
            this.values[f.key] = v
          })
        })
        break
      default:
        s.addText((t) => {
          t.setValue(typeof cur === 'string' ? cur : '')
          t.onChange((v) => {
            this.values[f.key] = v
            this.maybeSyncName(f, v)
          })
        })
    }
  }

  /** Mirror a title/name field into the file-name box until the user edits it. */
  private maybeSyncName(f: TemplateField, v: string) {
    if (this.fileNameTouched) return
    if (f.key !== 'title' && f.key !== 'name') return
    if (this.fileNameInput) this.fileNameInput.value = v
  }

  private suggestFileName(): string {
    for (const key of ['title', 'name']) {
      const cur = this.values[key]
      if (typeof cur === 'string' && cur.trim()) return cur.trim()
    }
    if (this.spec.titlePattern) {
      const filled = fillTokens(this.spec.titlePattern, this.values).trim()
      if (filled && !filled.includes('{{')) return filled
    }
    return ''
  }

  private resolveFileName(): string {
    const explicit = this.fileNameInput?.value.trim()
    if (explicit) return explicit
    const suggested = this.suggestFileName()
    if (suggested) return suggested
    return this.spec.name
  }

  private resolveFolder(): string {
    const explicit = this.folderInput?.value.trim()
    if (explicit) return explicit
    if (this.spec.targetPattern) {
      const filled = fillTokens(this.spec.targetPattern, this.values).trim()
      if (filled && !filled.includes('{{')) return filled
    }
    return this.opts.defaultDest
  }

  private finish(create: boolean) {
    if (this.done) return
    if (create) {
      const missing = this.spec.fields.filter(
        (f) => f.required && !String(this.values[f.key] ?? '').trim(),
      )
      if (missing.length) {
        new Notice(`Please fill: ${missing.map((m) => m.label).join(', ')}`)
        return
      }
    }
    this.done = true
    this.close()
    this.onSubmit(
      create
        ? { values: this.values, fileName: this.resolveFileName(), destFolder: this.resolveFolder() }
        : null,
    )
  }

  onClose() {
    this.contentEl.empty()
    if (!this.done) {
      this.done = true
      this.onSubmit(null)
    }
  }
}
