// SpacesView — the Private vs. Organization navigator (Phase 2).
//
// A left-dock ItemView with two collapsible sections over the SAME vault,
// split by the existing sync + ACL machinery (no new backend):
//   • Organization — the synced subtree, ACL-filtered per the server's
//     effectivePermission (hide `none`, badge `read-only`), with the PM
//     dashboards + canonical docs surfaced on top.
//   • Private — folders configured as local-only (isPrivatePath); these never
//     enter the y-sweet doc, so the "local only" guarantee is structural.

import {
  ItemView,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  setIcon,
} from 'obsidian'
import type NNNSyncPlugin from '../main'
import type { SpacesConfig } from '../types'
import { ensureSpacesConfig } from './config'
import { isPrivatePath } from '../fsutil'
import { PromptModal } from '../home/modals'

export const SPACES_VIEW_TYPE = 'nnn-spaces'

const CANONICAL_NAMES = new Set(['Index', 'Dashboard', 'Status', 'Schema', 'Roadmap'])

/** Strip characters Obsidian/Windows reject in a file or folder name. */
function sanitizeName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
}

export class SpacesView extends ItemView {
  private refreshDebounce: ReturnType<typeof setTimeout> | null = null
  /** In-flight drag: the dragged child's name + its parent folder path. A drop
   *  is only honored when it lands on a sibling under the same parent. */
  private dragState: { name: string; parentPath: string } | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: NNNSyncPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return SPACES_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Spaces'
  }
  getIcon(): string {
    return 'layers'
  }

  private get cfg(): SpacesConfig {
    return ensureSpacesConfig(this.plugin.settings)
  }

  /** The manual-order map, guaranteed non-null (ensureSpacesConfig normalizes
   *  it, but the field is optional on the on-disk type). */
  private get orderMap(): Record<string, string[]> {
    const c = this.cfg
    if (!c.order) c.order = {}
    return c.order
  }

  async onOpen() {
    this.render()
    const refresh = () => {
      if (this.refreshDebounce) clearTimeout(this.refreshDebounce)
      this.refreshDebounce = setTimeout(() => this.render(), 300)
    }
    this.registerEvent(this.app.vault.on('create', refresh))
    this.registerEvent(this.app.vault.on('delete', refresh))
    this.registerEvent(this.app.vault.on('rename', refresh))
  }

  async onClose() {
    if (this.refreshDebounce) clearTimeout(this.refreshDebounce)
    this.contentEl.empty()
  }

  /** Public re-render (after a settings change). */
  refresh() {
    this.render()
  }

  // ── render ───────────────────────────────────────────────────────────────────

  private render() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('nnn-spaces')

    const bar = contentEl.createDiv({ cls: 'nnn-spaces-topbar' })
    bar.createSpan({ cls: 'nnn-spaces-title', text: 'Spaces' })
    const refresh = bar.createEl('button', {
      cls: 'nnn-spaces-iconbtn',
      attr: { 'aria-label': 'Refresh', title: 'Refresh' },
    })
    setIcon(refresh, 'refresh-cw')
    refresh.onclick = () => this.render()

    const scroll = contentEl.createDiv({ cls: 'nnn-spaces-scroll' })
    this.renderOrg(this.section(scroll, 'Organization', 'building-2'))
    this.renderPrivate(this.section(scroll, 'Private', 'lock', 'local'))
  }

  /** A collapsible section; returns its body container. */
  private section(parent: HTMLElement, title: string, iconId: string, badge?: string): HTMLElement {
    const sec = parent.createDiv({ cls: 'nnn-spaces-section' })
    const head = sec.createDiv({ cls: 'nnn-spaces-section-head' })
    const chev = head.createSpan({ cls: 'nnn-spaces-chevron' })
    setIcon(chev, 'chevron-down')
    const ic = head.createSpan({ cls: 'nnn-spaces-section-icon' })
    setIcon(ic, iconId)
    head.createSpan({ cls: 'nnn-spaces-section-title', text: title })
    if (badge) head.createSpan({ cls: 'nnn-spaces-section-badge', text: badge })
    const body = sec.createDiv({ cls: 'nnn-spaces-section-body' })
    head.onclick = () => sec.toggleClass('is-collapsed', !sec.hasClass('is-collapsed'))
    return body
  }

  // ── Organization (synced + ACL-filtered) ─────────────────────────────────────

  private renderOrg(body: HTMLElement) {
    if (this.cfg.showDashboards) this.renderDashboards(body)
    if (!this.plugin.settings.sessionToken) {
      body.createDiv({ cls: 'nnn-spaces-hint', text: 'Connect sync to see live permissions.' })
    }
    const tree = body.createDiv({ cls: 'nnn-spaces-tree' })
    this.renderTree(tree, this.app.vault.getRoot(), true)
    if (!tree.hasChildNodes()) {
      body.createDiv({ cls: 'nnn-spaces-empty', text: 'No shared notes yet.' })
    }
  }

  private renderDashboards(body: HTMLElement) {
    const group = body.createDiv({ cls: 'nnn-spaces-dash' })
    group.createDiv({ cls: 'nnn-spaces-subhead', text: 'Dashboards' })

    const board = group.createDiv({ cls: 'nnn-spaces-row nnn-spaces-file-row' })
    setIcon(board.createSpan({ cls: 'nnn-spaces-row-icon' }), 'layout-grid')
    board.createSpan({ cls: 'nnn-spaces-row-label', text: 'Project board' })
    board.onclick = () => {
      void this.plugin.openPMBoard()
    }

    for (const f of this.canonicalDocs()) {
      const r = group.createDiv({ cls: 'nnn-spaces-row nnn-spaces-file-row' })
      setIcon(r.createSpan({ cls: 'nnn-spaces-row-icon' }), 'layout-dashboard')
      r.createSpan({ cls: 'nnn-spaces-row-label', text: f.basename })
      r.onclick = () => {
        void this.app.workspace.getLeaf(false).openFile(f)
      }
    }
  }

  /** Canonical docs (frontmatter type:canonical, or one of the 5 named docs),
   *  visible to this user, capped for the sidebar. */
  private canonicalDocs(): TFile[] {
    const out: TFile[] = []
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (isPrivatePath(f.path)) continue
      if (this.plugin.permissionForPath(f.path) === 'none') continue
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined
      const isCanon = !!fm && (fm.type === 'canonical' || !!fm.canonical)
      if (isCanon || CANONICAL_NAMES.has(f.basename)) out.push(f)
    }
    return out.sort((a, b) => a.basename.localeCompare(b.basename)).slice(0, 12)
  }

  // ── Private (local-only) ──────────────────────────────────────────────────────

  private renderPrivate(body: HTMLElement) {
    body.createDiv({ cls: 'nnn-spaces-hint', text: 'Local only — never synced.' })

    // New-note / new-folder actions (create under the primary private root).
    const primary = this.cfg.privateRoots[0] ?? ''
    const actions = body.createDiv({ cls: 'nnn-spaces-actions' })
    const mkBtn = (icon: string, label: string, onClick: () => void) => {
      const b = actions.createEl('button', { cls: 'nnn-spaces-newbtn', attr: { title: label } })
      setIcon(b.createSpan({ cls: 'nnn-spaces-newbtn-icon' }), icon)
      b.createSpan({ text: label })
      b.onclick = onClick
    }
    mkBtn('file-plus', 'New note', () => this.promptCreate('note', primary))
    mkBtn('folder-plus', 'New folder', () => this.promptCreate('folder', primary))

    let any = false
    for (const root of this.cfg.privateRoots) {
      const folder = this.app.vault.getAbstractFileByPath(root)
      if (folder instanceof TFolder) {
        const tree = body.createDiv({ cls: 'nnn-spaces-tree' })
        this.renderTree(tree, folder, false)
        if (tree.hasChildNodes()) any = true
        else tree.remove()
      }
    }
    if (!any) {
      const roots = this.cfg.privateRoots.join(', ') || '(none configured)'
      body.createDiv({
        cls: 'nnn-spaces-empty',
        text: `No private notes yet. Use “New note” above (creates under: ${roots}).`,
      })
    }
  }

  // ── tree rendering ─────────────────────────────────────────────────────────────

  private renderTree(parent: HTMLElement, folder: TFolder, aclFilter: boolean) {
    for (const child of this.sortedChildren(folder)) {
      if (child instanceof TFolder) {
        if (aclFilter && isPrivatePath(child.path)) continue
        if (!this.folderHasVisible(child, aclFilter)) continue
        this.renderFolderRow(parent, child, folder, aclFilter)
      } else if (child instanceof TFile) {
        if (!this.fileVisible(child, aclFilter)) continue
        this.renderFileRow(parent, child, folder, aclFilter)
      }
    }
  }

  private renderFolderRow(
    parent: HTMLElement,
    folder: TFolder,
    parentFolder: TFolder,
    aclFilter: boolean,
  ) {
    const wrap = parent.createDiv({ cls: 'nnn-spaces-folder' })
    const row = wrap.createDiv({ cls: 'nnn-spaces-row nnn-spaces-folder-row' })
    const chev = row.createSpan({ cls: 'nnn-spaces-chevron' })
    setIcon(chev, 'chevron-down')
    setIcon(row.createSpan({ cls: 'nnn-spaces-row-icon' }), 'folder')
    row.createSpan({ cls: 'nnn-spaces-row-label', text: folder.name })
    // Private folders get a hover "+" to create a note directly inside them.
    if (!aclFilter) {
      const add = row.createSpan({
        cls: 'nnn-spaces-row-add',
        attr: { 'aria-label': 'New note here', title: 'New note here' },
      })
      setIcon(add, 'plus')
      add.onclick = (e) => {
        e.stopPropagation()
        this.promptCreate('note', folder.path)
      }
    }
    const children = wrap.createDiv({ cls: 'nnn-spaces-children' })
    this.renderTree(children, folder, aclFilter)
    row.onclick = () => wrap.toggleClass('is-collapsed', !wrap.hasClass('is-collapsed'))
    this.attachDrag(row, folder, parentFolder)
  }

  private renderFileRow(
    parent: HTMLElement,
    file: TFile,
    parentFolder: TFolder,
    aclFilter: boolean,
  ) {
    const row = parent.createDiv({ cls: 'nnn-spaces-row nnn-spaces-file-row' })
    setIcon(row.createSpan({ cls: 'nnn-spaces-row-icon' }), 'file-text')
    row.createSpan({ cls: 'nnn-spaces-row-label', text: file.basename })
    if (aclFilter && this.plugin.permissionForPath(file.path) === 'read-only') {
      const b = row.createSpan({ cls: 'nnn-spaces-badge', text: 'read-only' })
      b.setAttr('title', 'You have read-only access to this file')
    }
    row.onclick = () => {
      void this.app.workspace.getLeaf(false).openFile(file)
    }
    this.attachDrag(row, file, parentFolder)
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private sortedChildren(folder: TFolder): TAbstractFile[] {
    // Default order: folders first, then alphabetical.
    const def = folder.children.slice().sort((a, b) => {
      const af = a instanceof TFolder
      const bf = b instanceof TFolder
      if (af !== bf) return af ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const ord = this.orderMap[folder.path]
    if (!ord || ord.length === 0) return def
    // Apply the saved manual order; unknown (new) children keep their default
    // position via the stable sort (Array.sort is stable in the Electron VM).
    const rank = (name: string) => {
      const i = ord.indexOf(name)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return def.sort((a, b) => rank(a.name) - rank(b.name))
  }

  // ── drag-to-reorder ────────────────────────────────────────────────────────────

  /** Make a tree row draggable + a drop target. Reorders are confined to
   *  siblings under the SAME parent folder; the resulting order persists in
   *  SpacesConfig.order keyed by the parent's path. */
  private attachDrag(row: HTMLElement, child: TAbstractFile, parent: TFolder) {
    row.setAttr('draggable', 'true')
    row.addEventListener('dragstart', (e) => {
      this.dragState = { name: child.name, parentPath: parent.path }
      row.addClass('is-dragging')
      e.dataTransfer?.setData('text/plain', child.path)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      row.removeClass('is-dragging')
      this.clearDropMarkers()
      this.dragState = null
    })
    row.addEventListener('dragover', (e) => {
      const ds = this.dragState
      if (!ds || ds.parentPath !== parent.path || ds.name === child.name) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      row.removeClass('drop-before')
      row.removeClass('drop-after')
      row.addClass(this.isAfter(row, e) ? 'drop-after' : 'drop-before')
    })
    row.addEventListener('dragleave', () => {
      row.removeClass('drop-before')
      row.removeClass('drop-after')
    })
    row.addEventListener('drop', (e) => {
      const ds = this.dragState
      row.removeClass('drop-before')
      row.removeClass('drop-after')
      if (!ds || ds.parentPath !== parent.path || ds.name === child.name) return
      e.preventDefault()
      void this.reorder(parent, ds.name, child.name, this.isAfter(row, e))
    })
  }

  private isAfter(row: HTMLElement, e: DragEvent): boolean {
    const rect = row.getBoundingClientRect()
    return e.clientY > rect.top + rect.height / 2
  }

  private clearDropMarkers() {
    this.contentEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after')
    })
  }

  /** Persist a new sibling order for `parent`, then re-render. */
  private async reorder(parent: TFolder, dragged: string, target: string, after: boolean) {
    const names = this.sortedChildren(parent).map((c) => c.name)
    const from = names.indexOf(dragged)
    if (from === -1) return
    names.splice(from, 1)
    let to = names.indexOf(target)
    if (to === -1) return
    if (after) to += 1
    names.splice(to, 0, dragged)
    this.orderMap[parent.path] = names
    await this.plugin.saveSettings()
    this.render()
  }

  // ── create note / folder (private space) ────────────────────────────────────────

  private promptCreate(kind: 'note' | 'folder', parentPath: string) {
    if (!parentPath) {
      new Notice('No private root configured. Add one in Settings → Spaces.')
      return
    }
    new PromptModal(
      this.app,
      {
        title: kind === 'note' ? 'New private note' : 'New private folder',
        placeholder: kind === 'note' ? 'Note name' : 'Folder name',
        cta: 'Create',
      },
      (value) => {
        if (value) void this.doCreate(kind, parentPath, value)
      },
    ).open()
  }

  private async doCreate(kind: 'note' | 'folder', parentPath: string, rawName: string) {
    const name = sanitizeName(rawName)
    if (!name) {
      new Notice('Invalid name.')
      return
    }
    try {
      await this.ensureFolder(parentPath)
      if (kind === 'folder') {
        await this.app.vault.createFolder(`${parentPath}/${name}`)
      } else {
        const fileName = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
        const path = `${parentPath}/${fileName}`
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice('A note with that name already exists.')
          return
        }
        const file = await this.app.vault.create(path, '')
        await this.app.workspace.getLeaf(false).openFile(file)
      }
      this.render()
    } catch (err) {
      new Notice(`Create failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Ensure a (possibly nested) folder path exists. */
  private async ensureFolder(path: string) {
    if (!path) return
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return
    try {
      await this.app.vault.createFolder(path)
    } catch {
      // already exists (race) — fine
    }
  }

  private isTextFile(f: TFile): boolean {
    const e = f.extension.toLowerCase()
    return e === 'md' || e === 'txt'
  }

  private fileVisible(f: TFile, aclFilter: boolean): boolean {
    if (!this.isTextFile(f)) return false
    if (aclFilter) {
      if (isPrivatePath(f.path)) return false
      if (this.plugin.permissionForPath(f.path) === 'none') return false
    }
    return true
  }

  private folderHasVisible(folder: TFolder, aclFilter: boolean): boolean {
    for (const c of folder.children) {
      if (c instanceof TFile) {
        if (this.fileVisible(c, aclFilter)) return true
      } else if (c instanceof TFolder) {
        if (aclFilter && isPrivatePath(c.path)) continue
        if (this.folderHasVisible(c, aclFilter)) return true
      }
    }
    return false
  }
}
