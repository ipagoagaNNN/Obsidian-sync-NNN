// HomeView — the customizable home tab (Phase 1).
//
// A non-file-backed ItemView that doubles as Obsidian's new-tab experience:
// a centered fuzzy search, personally-organized quick-link "collections", and
// recently-opened / recently-viewed / favorites sections. A notification bell
// reuses the existing PM notification stack. All state is per-user (plugin
// settings.home); editing is gated behind an in-view "customize" toggle.

import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from 'obsidian'
import type NNNSyncPlugin from '../main'
import type { HomeCollection, HomeConfig, HomeLink } from '../types'
import {
  blankLink,
  defaultIconFor,
  ensureHomeConfig,
  importBookmarkPaths,
  newId,
} from './config'
import { searchFiles } from './search'
import { EditLinkModal, PromptModal } from './modals'

export const HOME_VIEW_TYPE = 'nnn-home'

interface CardOpts {
  iconId: string
  label: string
  sub?: string
  color?: string
  onClick: (evt: MouseEvent) => void
}

export class HomeView extends ItemView {
  private editMode = false
  private searchDebounce: ReturnType<typeof setTimeout> | null = null
  private results: TFile[] = []
  private selIdx = -1

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: NNNSyncPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return HOME_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Home'
  }
  getIcon(): string {
    return 'home'
  }

  private get cfg(): HomeConfig {
    return ensureHomeConfig(this.plugin.settings)
  }

  async onOpen() {
    this.render()
  }
  async onClose() {
    this.contentEl.empty()
  }

  private async save() {
    await this.plugin.saveSettings()
  }

  // ── top-level render ───────────────────────────────────────────────────────

  private render() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('nnn-home')

    this.renderTopBar(contentEl)

    const scroll = contentEl.createDiv({ cls: 'nnn-home-scroll' })
    this.renderHero(scroll)
    this.renderCollections(scroll)
    this.renderRecents(scroll)
    this.renderViewed(scroll)
    this.renderFavorites(scroll)
  }

  private renderTopBar(root: HTMLElement) {
    const bar = root.createDiv({ cls: 'nnn-home-topbar' })
    bar.createDiv({ cls: 'nnn-home-brand', text: this.cfg.greeting?.trim() || 'Home' })

    const actions = bar.createDiv({ cls: 'nnn-home-actions' })

    // Notification bell (reuses the existing PM notification stack).
    const bellWrap = actions.createDiv({ cls: 'nnn-home-bell' })
    const bellBtn = bellWrap.createEl('button', {
      cls: 'nnn-home-iconbtn',
      attr: { 'aria-label': 'Notifications', title: 'Notifications' },
    })
    setIcon(bellBtn, 'bell')
    bellBtn.onclick = () => this.plugin.openPMNotifications()
    const badge = bellWrap.createSpan({ cls: 'nnn-home-badge' })
    badge.hide()
    void this.plugin
      .pmClient()
      .unreadCount()
      .then((r) => {
        if (r.unread > 0) {
          badge.setText(r.unread > 99 ? '99+' : String(r.unread))
          badge.show()
        }
      })
      .catch(() => {
        /* PM disabled / offline / no session — leave the badge hidden */
      })

    // Edit (customize) toggle.
    const editBtn = actions.createEl('button', {
      cls: this.editMode ? 'nnn-home-iconbtn is-active' : 'nnn-home-iconbtn',
      attr: { title: this.editMode ? 'Done customizing' : 'Customize home' },
    })
    setIcon(editBtn, this.editMode ? 'check' : 'pencil')
    editBtn.onclick = () => {
      this.editMode = !this.editMode
      this.render()
    }
  }

  // ── centered search ──────────────────────────────────────────────────────────

  private renderHero(root: HTMLElement) {
    const hero = root.createDiv({ cls: 'nnn-home-hero' })
    const input = hero.createEl('input', {
      cls: 'nnn-home-search-input',
      attr: { type: 'text', placeholder: 'Search your vault…', spellcheck: 'false' },
    })
    const resultsEl = hero.createDiv({ cls: 'nnn-home-results' })
    resultsEl.hide()

    const run = () => {
      const q = input.value
      if (!q.trim()) {
        this.results = []
        this.selIdx = -1
        resultsEl.hide()
        resultsEl.empty()
        return
      }
      this.results = searchFiles(this.app, q, 12).map((h) => h.file)
      this.selIdx = this.results.length ? 0 : -1
      this.paintResults(resultsEl)
    }

    input.addEventListener('input', () => {
      if (this.searchDebounce) clearTimeout(this.searchDebounce)
      this.searchDebounce = setTimeout(run, 80)
    })
    input.addEventListener('keydown', (e) => {
      if (!this.results.length) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.selIdx = (this.selIdx + 1) % this.results.length
        this.paintResults(resultsEl)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.selIdx = (this.selIdx - 1 + this.results.length) % this.results.length
        this.paintResults(resultsEl)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const f = this.results[this.selIdx] ?? this.results[0]
        if (f) this.openFile(f, e)
      } else if (e.key === 'Escape') {
        input.value = ''
        run()
      }
    })

    // Autofocus the search on open — the headline interaction.
    window.setTimeout(() => input.focus(), 0)
  }

  private paintResults(resultsEl: HTMLElement) {
    resultsEl.empty()
    if (!this.results.length) {
      resultsEl.hide()
      return
    }
    resultsEl.show()
    this.results.forEach((f, i) => {
      const row = resultsEl.createDiv({
        cls: i === this.selIdx ? 'nnn-home-result is-selected' : 'nnn-home-result',
      })
      const ic = row.createSpan({ cls: 'nnn-home-result-icon' })
      setIcon(ic, 'file-text')
      row.createSpan({ cls: 'nnn-home-result-title', text: f.basename })
      const parent = f.parent && f.parent.path !== '/' ? f.parent.path : ''
      if (parent) row.createSpan({ cls: 'nnn-home-result-path', text: parent })
      row.onmousedown = (e) => {
        // mousedown (not click) so the input doesn't steal focus first
        e.preventDefault()
        this.openFile(f, e)
      }
    })
  }

  // ── collections (the customizable headline) ──────────────────────────────────

  private renderCollections(root: HTMLElement) {
    const section = root.createDiv({ cls: 'nnn-home-section' })
    const head = section.createDiv({ cls: 'nnn-home-section-head' })
    head.createSpan({ cls: 'nnn-home-section-title', text: 'Collections' })
    if (this.editMode) {
      const add = head.createDiv({ cls: 'nnn-home-section-actions' })
      const addBtn = add.createEl('button', { cls: 'nnn-home-textbtn', text: '+ Collection' })
      addBtn.onclick = () => {
        new PromptModal(
          this.app,
          { title: 'New collection', placeholder: 'e.g. Daily, Projects, Dashboards', cta: 'Create' },
          (name) => {
            if (!name) return
            this.cfg.collections.push({ id: newId('col'), title: name, links: [] })
            void this.save().then(() => this.render())
          },
        ).open()
      }
    }

    if (!this.cfg.collections.length) {
      const empty = section.createDiv({ cls: 'nnn-home-empty' })
      empty.createSpan({
        text: this.editMode
          ? 'No collections yet. Click “+ Collection” to create one, then add quick-link cards.'
          : 'No collections yet — click the pencil (top-right) to build your personalized home.',
      })
      return
    }

    for (const col of this.cfg.collections) this.renderCollection(section, col)
  }

  private renderCollection(parent: HTMLElement, col: HomeCollection) {
    const wrap = parent.createDiv({ cls: 'nnn-home-collection' })
    const head = wrap.createDiv({ cls: 'nnn-home-collection-head' })
    if (col.icon) {
      const ic = head.createSpan({ cls: 'nnn-home-collection-icon' })
      setIcon(ic, col.icon)
    }
    head.createSpan({ cls: 'nnn-home-collection-title', text: col.title })

    if (this.editMode) {
      const acts = head.createDiv({ cls: 'nnn-home-collection-actions' })
      this.iconButton(acts, 'plus', 'Add quick link', () => {
        new EditLinkModal(this.app, blankLink('note'), (link) => {
          if (!link) return
          col.links.push(link)
          void this.save().then(() => this.render())
        }).open()
      })
      this.iconButton(acts, 'pencil', 'Rename collection', () => {
        new PromptModal(
          this.app,
          { title: 'Rename collection', value: col.title, cta: 'Save' },
          (name) => {
            if (!name) return
            col.title = name
            void this.save().then(() => this.render())
          },
        ).open()
      })
      this.iconButton(acts, 'trash-2', 'Delete collection', () => {
        this.cfg.collections = this.cfg.collections.filter((c) => c.id !== col.id)
        void this.save().then(() => this.render())
      })
    }

    const cards = wrap.createDiv({ cls: 'nnn-home-cards' })
    for (const link of col.links) this.renderLinkCard(cards, col, link)

    if (this.editMode && !col.links.length) {
      cards.createDiv({ cls: 'nnn-home-empty nnn-home-empty-inline' }).setText(
        'Empty — use the + above to add a card.',
      )
    }
  }

  private renderLinkCard(parent: HTMLElement, col: HomeCollection, link: HomeLink) {
    const { card } = this.makeCard(parent, {
      iconId: link.icon || defaultIconFor(link.kind),
      label: link.label,
      sub: this.linkSub(link),
      color: link.color,
      onClick: (e) => {
        if (this.editMode) return // clicks edit-safe in customize mode
        void this.openLink(link, e)
      },
    })

    if (this.editMode) {
      card.addClass('is-editing')
      card.setAttr('draggable', 'true')
      card.dataset.linkId = link.id
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', link.id)
        card.addClass('is-dragging')
      })
      card.addEventListener('dragend', () => card.removeClass('is-dragging'))
      card.addEventListener('dragover', (e) => e.preventDefault())
      card.addEventListener('drop', (e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer?.getData('text/plain')
        if (draggedId) this.reorderLink(col, draggedId, link.id)
      })

      const acts = card.createDiv({ cls: 'nnn-home-card-actions' })
      this.iconButton(acts, 'pencil', 'Edit', () => {
        new EditLinkModal(this.app, link, (updated) => {
          if (!updated) return
          const i = col.links.findIndex((l) => l.id === link.id)
          if (i >= 0) col.links[i] = updated
          void this.save().then(() => this.render())
        }).open()
      })
      this.iconButton(acts, 'x', 'Remove', () => {
        col.links = col.links.filter((l) => l.id !== link.id)
        void this.save().then(() => this.render())
      })
    }
  }

  private reorderLink(col: HomeCollection, draggedId: string, targetId: string) {
    if (draggedId === targetId) return
    const from = col.links.findIndex((l) => l.id === draggedId)
    const to = col.links.findIndex((l) => l.id === targetId)
    if (from < 0 || to < 0) return
    const [moved] = col.links.splice(from, 1)
    col.links.splice(to, 0, moved)
    void this.save().then(() => this.render())
  }

  private linkSub(link: HomeLink): string | undefined {
    switch (link.kind) {
      case 'url':
        return link.target.replace(/^https?:\/\//, '').slice(0, 40)
      case 'folder':
        return link.target
      case 'pmview':
        return 'PM'
      case 'command':
        return 'command'
      default: {
        const parent = link.target.includes('/') ? link.target.slice(0, link.target.lastIndexOf('/')) : ''
        return parent || undefined
      }
    }
  }

  // ── recents / viewed / favorites ─────────────────────────────────────────────

  private renderRecents(root: HTMLElement) {
    const files = this.app.workspace
      .getLastOpenFiles()
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
      .slice(0, 8)
    this.renderFileSection(root, 'Recently opened', 'clock', files)
  }

  private renderViewed(root: HTMLElement) {
    const files = this.cfg.mru
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 8)
    this.renderFileSection(root, 'Recently modified (viewed)', 'history', files)
  }

  private renderFavorites(root: HTMLElement) {
    const files = this.cfg.favorites
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)

    const section = root.createDiv({ cls: 'nnn-home-section' })
    const head = section.createDiv({ cls: 'nnn-home-section-head' })
    head.createSpan({ cls: 'nnn-home-section-title', text: 'Favorites' })
    if (this.editMode) {
      const acts = head.createDiv({ cls: 'nnn-home-section-actions' })
      const imp = acts.createEl('button', { cls: 'nnn-home-textbtn', text: 'Import bookmarks' })
      imp.onclick = () => {
        const paths = importBookmarkPaths(this.app)
        if (!paths.length) {
          new Notice('No Obsidian bookmarks found to import.')
          return
        }
        const existing = new Set(this.cfg.favorites)
        let added = 0
        for (const p of paths) if (!existing.has(p)) {
          this.cfg.favorites.push(p)
          added++
        }
        void this.save().then(() => this.render())
        new Notice(added ? `Imported ${added} bookmark(s).` : 'All bookmarks already favorited.')
      }
    }

    if (!files.length) {
      section.createDiv({ cls: 'nnn-home-empty' }).setText(
        'No favorites yet — hover a file card below and click the star to add one.',
      )
      return
    }

    const cards = section.createDiv({ cls: 'nnn-home-cards' })
    for (const f of files) this.renderFileCard(cards, f, true)
  }

  private renderFileSection(root: HTMLElement, title: string, iconId: string, files: TFile[]) {
    const section = root.createDiv({ cls: 'nnn-home-section' })
    const head = section.createDiv({ cls: 'nnn-home-section-head' })
    head.createSpan({ cls: 'nnn-home-section-title', text: title })
    if (!files.length) {
      section.createDiv({ cls: 'nnn-home-empty' }).setText('Nothing here yet.')
      return
    }
    const cards = section.createDiv({ cls: 'nnn-home-cards' })
    void iconId
    for (const f of files) this.renderFileCard(cards, f, false)
  }

  private renderFileCard(parent: HTMLElement, file: TFile, isFavorite: boolean) {
    const { card } = this.makeCard(parent, {
      iconId: 'file-text',
      label: file.basename,
      sub: file.parent && file.parent.path !== '/' ? file.parent.path : undefined,
      onClick: (e) => this.openFile(file, e),
    })
    const acts = card.createDiv({ cls: 'nnn-home-card-actions nnn-home-card-star' })
    const fav = isFavorite || this.cfg.favorites.includes(file.path)
    this.iconButton(acts, fav ? 'star' : 'star', fav ? 'Unfavorite' : 'Add to favorites', () => {
      this.toggleFavorite(file.path)
    }).toggleClass('is-fav', fav)
  }

  private toggleFavorite(path: string) {
    if (this.cfg.favorites.includes(path)) {
      this.cfg.favorites = this.cfg.favorites.filter((p) => p !== path)
    } else {
      this.cfg.favorites = [...this.cfg.favorites, path]
    }
    void this.save().then(() => this.render())
  }

  // ── open actions ─────────────────────────────────────────────────────────────

  private openFile(file: TFile, evt?: { ctrlKey: boolean; metaKey: boolean }) {
    const newTab = !!evt && (evt.ctrlKey || evt.metaKey)
    const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.leaf
    void leaf.openFile(file)
  }

  private async openLink(link: HomeLink, evt?: { ctrlKey: boolean; metaKey: boolean }) {
    const { app } = this
    try {
      switch (link.kind) {
        case 'note': {
          const f = app.vault.getAbstractFileByPath(link.target)
          if (f instanceof TFile) this.openFile(f, evt)
          else new Notice(`Note not found: ${link.target}`)
          break
        }
        case 'folder': {
          const f = app.vault.getAbstractFileByPath(link.target)
          if (!(f instanceof TFolder)) {
            new Notice(`Folder not found: ${link.target}`)
            break
          }
          // Best-effort reveal in the file explorer (internal API, guarded).
          const exp = app.workspace.getLeavesOfType('file-explorer')[0]
          if (exp) {
            app.workspace.revealLeaf(exp)
            try {
              ;(exp.view as unknown as { revealInFolder?: (f: TFolder) => void }).revealInFolder?.(f)
            } catch {
              /* older Obsidian without revealInFolder — explorer still focused */
            }
          } else {
            new Notice(`Folder: ${link.target}`)
          }
          break
        }
        case 'url':
          window.open(link.target, '_blank')
          break
        case 'pmview':
          await this.plugin.openPMBoard()
          break
        case 'command':
          ;(app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands?.executeCommandById?.(
            link.target,
          )
          break
      }
    } catch (e) {
      new Notice(`Couldn't open link: ${(e as Error).message}`)
    }
  }

  // ── small DOM helpers ─────────────────────────────────────────────────────────

  private makeCard(parent: HTMLElement, opts: CardOpts): { card: HTMLElement } {
    const card = parent.createDiv({ cls: 'nnn-home-card' })
    if (opts.color) card.style.setProperty('--nnn-home-accent', opts.color)
    const ic = card.createDiv({ cls: 'nnn-home-card-icon' })
    setIcon(ic, opts.iconId)
    const body = card.createDiv({ cls: 'nnn-home-card-body' })
    body.createDiv({ cls: 'nnn-home-card-label', text: opts.label || 'Untitled' })
    if (opts.sub) body.createDiv({ cls: 'nnn-home-card-sub', text: opts.sub })
    card.onclick = (e) => opts.onClick(e)
    return { card }
  }

  private iconButton(
    parent: HTMLElement,
    iconId: string,
    tooltip: string,
    onClick: () => void,
  ): HTMLElement {
    const btn = parent.createEl('button', { cls: 'nnn-home-iconbtn nnn-home-iconbtn-sm', attr: { title: tooltip } })
    setIcon(btn, iconId)
    btn.onclick = (e) => {
      e.stopPropagation()
      onClick()
    }
    return btn
  }
}
