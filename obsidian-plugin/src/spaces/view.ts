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

export const SPACES_VIEW_TYPE = 'nnn-spaces'

const CANONICAL_NAMES = new Set(['Index', 'Dashboard', 'Status', 'Schema', 'Roadmap'])

export class SpacesView extends ItemView {
  private refreshDebounce: ReturnType<typeof setTimeout> | null = null

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
        text: `No private notes yet. Create notes under: ${roots}`,
      })
    }
  }

  // ── tree rendering ─────────────────────────────────────────────────────────────

  private renderTree(parent: HTMLElement, folder: TFolder, aclFilter: boolean) {
    for (const child of this.sortedChildren(folder)) {
      if (child instanceof TFolder) {
        if (aclFilter && isPrivatePath(child.path)) continue
        if (!this.folderHasVisible(child, aclFilter)) continue
        this.renderFolderRow(parent, child, aclFilter)
      } else if (child instanceof TFile) {
        if (!this.fileVisible(child, aclFilter)) continue
        this.renderFileRow(parent, child, aclFilter)
      }
    }
  }

  private renderFolderRow(parent: HTMLElement, folder: TFolder, aclFilter: boolean) {
    const wrap = parent.createDiv({ cls: 'nnn-spaces-folder' })
    const row = wrap.createDiv({ cls: 'nnn-spaces-row nnn-spaces-folder-row' })
    const chev = row.createSpan({ cls: 'nnn-spaces-chevron' })
    setIcon(chev, 'chevron-down')
    setIcon(row.createSpan({ cls: 'nnn-spaces-row-icon' }), 'folder')
    row.createSpan({ cls: 'nnn-spaces-row-label', text: folder.name })
    const children = wrap.createDiv({ cls: 'nnn-spaces-children' })
    this.renderTree(children, folder, aclFilter)
    row.onclick = () => wrap.toggleClass('is-collapsed', !wrap.hasClass('is-collapsed'))
  }

  private renderFileRow(parent: HTMLElement, file: TFile, aclFilter: boolean) {
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
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private sortedChildren(folder: TFolder): TAbstractFile[] {
    return folder.children.slice().sort((a, b) => {
      const af = a instanceof TFolder
      const bf = b instanceof TFolder
      if (af !== bf) return af ? -1 : 1
      return a.name.localeCompare(b.name)
    })
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
