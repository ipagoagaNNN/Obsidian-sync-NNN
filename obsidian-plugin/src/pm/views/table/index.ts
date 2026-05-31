// Summary view (ADR-014, Phase 2) — the vault data plane, VizLab-Studio-style.
//
//   department picker → subdir subtabs (+ canonical root tabs) → toolbar → content
//
// A DEPARTMENT is a top-level vault folder (e.g. "IT team"). Its immediate
// SUBDIRECTORIES become subtabs (the VizLab Sessions/Bugs/Decisions pattern),
// each rendered as an Obsidian-Bases-style Table / Cards view with a status
// filter + find. The canonical root files — Index, Dashboard, Status, Schema,
// Roadmap — become individual ROOT TABS; selecting one renders that file's
// properties + markdown inline. "All Departments" (management scope) flattens
// every note across departments into one table with a Folder column. A row/card
// click opens the note in a modal (properties + rendered body).
//
// No backend: reads app.vault + metadataCache via the vault adapter.

import { Component, MarkdownRenderer, TFile } from 'obsidian'
import type { PMView, ViewContext } from '../../registry'
import { topFolders, vaultRows, type VaultRow } from '../../data/vaultAdapter'
import {
  asString,
  cellText,
  inferColumns,
  prettyLabel,
  renderCell,
  slug,
  sortValue,
  statusKeyFor,
  type ColumnDef,
} from './columns'
import { renderCards } from './cards'
import { NoteModal } from './modal'
import { renderPropsTable, stripFrontmatter, wireInternalLinks } from './note'

/** Management scope: flatten every note across departments. */
const ALL_DEPTS = '__all_depts__'

const CANON_ORDER = ['index', 'dashboard', 'status', 'schema', 'roadmap']
const canonRank = (file: string): number => CANON_ORDER.indexOf(file.toLowerCase().replace(/^_+/, ''))
const isCanonical = (file: string): boolean => canonRank(file) !== -1

interface Section {
  id: string
  label: string
  rows: VaultRow[]
}
interface RootDoc {
  path: string
  label: string
}
interface DeptModel {
  sections: Section[]
  docs: RootDoc[]
  allDepts: boolean
}
type Active = { kind: 'section'; id: string } | { kind: 'doc'; path: string; label: string }

interface TableState {
  dept: string
  active: Active | null
  view: 'table' | 'cards'
  sortKey: string
  sortDir: 'asc' | 'desc'
  filterText: string
  filterStatus: string
}

/** Group a department's notes into subdir sections + ordered canonical root docs.
 *  ALL_DEPTS → one flat "All notes" section across the whole vault. */
function buildDept(app: ViewContext['app'], dept: string): DeptModel {
  if (dept === ALL_DEPTS) {
    return { sections: [{ id: '__all__', label: 'All notes', rows: vaultRows(app) }], docs: [], allDepts: true }
  }
  const prefix = dept.replace(/\/+$/, '') + '/'
  const all = vaultRows(app, dept)
  const subMap = new Map<string, VaultRow[]>()
  const rootLoose: VaultRow[] = []
  const docs: RootDoc[] = []
  for (const r of all) {
    const rel = r.path.startsWith(prefix) ? r.path.slice(prefix.length) : `${r.file}.md`
    const slash = rel.indexOf('/')
    if (slash === -1) {
      if (isCanonical(r.file)) docs.push({ path: r.path, label: prettyLabel(r.file) })
      else rootLoose.push(r)
    } else {
      const sub = rel.slice(0, slash)
      const arr = subMap.get(sub) ?? []
      arr.push(r)
      subMap.set(sub, arr)
    }
  }
  const sections: Section[] = []
  if (rootLoose.length) sections.push({ id: '__general__', label: 'General', rows: rootLoose })
  for (const sub of [...subMap.keys()].sort((a, b) => a.localeCompare(b))) {
    sections.push({ id: sub, label: prettyLabel(sub), rows: subMap.get(sub) ?? [] })
  }
  docs.sort((a, b) => canonRank(a.path.split('/').pop() ?? '') - canonRank(b.path.split('/').pop() ?? ''))
  return { sections, docs, allDepts: false }
}

function applyFilters(
  rows: VaultRow[],
  cols: ColumnDef[],
  statusKey: string,
  filterText: string,
  filterStatus: string,
): VaultRow[] {
  const q = filterText.trim().toLowerCase()
  return rows.filter(r => {
    if (filterStatus && slug(r.frontmatter[statusKey]) !== slug(filterStatus)) return false
    if (!q) return true
    return cols.some(c => cellText(c, r).toLowerCase().includes(q))
  })
}

function sortRows(rows: VaultRow[], cols: ColumnDef[], sortKey: string, dir: 'asc' | 'desc'): VaultRow[] {
  const col = cols.find(c => c.key === sortKey) ?? cols[0]
  const out = [...rows]
  out.sort((a, b) => {
    const av = sortValue(col, a)
    const bv = sortValue(col, b)
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  })
  return out
}

export const tableView: PMView = {
  id: 'table',
  label: 'Summary',
  icon: 'table',
  render(host: HTMLElement, ctx: ViewContext): void {
    host.empty()
    host.addClass('nnn-pm-st')

    const departments = topFolders(ctx.app)
    if (!departments.length) {
      host.createEl('div', {
        cls: 'nnn-pm-st-placeholder',
        text: 'No top-level folders to render as a department.',
      })
      return
    }

    const state: TableState = {
      dept:
        ctx.scope.collection &&
        (ctx.scope.collection === ALL_DEPTS || departments.includes(ctx.scope.collection))
          ? ctx.scope.collection
          : departments[0],
      active: null,
      view: 'table',
      sortKey: 'file',
      sortDir: 'asc',
      filterText: '',
      filterStatus: '',
    }

    let docComp: Component | null = null
    let model = buildDept(ctx.app, state.dept)

    // ── Static shell ────────────────────────────────────────────────────────
    const headWrap = host.createDiv({ cls: 'nnn-pm-st-head' })
    const deptRow = headWrap.createDiv({ cls: 'nnn-pm-st-deptrow' })
    deptRow.createSpan({ cls: 'nnn-pm-st-deptlabel', text: 'Department' })
    const deptSel = deptRow.createEl('select', { cls: 'nnn-pm-st-dept' })
    deptSel.createEl('option', { text: 'All Departments' }).value = ALL_DEPTS
    for (const d of departments) deptSel.createEl('option', { text: d }).value = d
    deptSel.value = state.dept
    const subtabs = headWrap.createDiv({ cls: 'nnn-pm-st-subtabs' })

    const toolbar = host.createDiv({ cls: 'nnn-pm-st-toolbar' })
    const content = host.createDiv({ cls: 'nnn-pm-st-content' })

    const currentSection = (): Section | undefined => {
      if (state.active?.kind !== 'section') return undefined
      const id = state.active.id
      return model.sections.find(s => s.id === id)
    }

    // Inferred columns for a section, plus a Folder column in management scope.
    const colsFor = (rows: VaultRow[]): ColumnDef[] => {
      const cols = inferColumns(rows)
      if (model.allDepts) cols.splice(1, 0, { key: 'folder', label: 'Folder', kind: 'text' })
      return cols
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const drawTabs = () => {
      subtabs.empty()
      for (const s of model.sections) {
        const on = state.active?.kind === 'section' && state.active.id === s.id
        const btn = subtabs.createEl('button', { cls: 'nnn-pm-st-subtab' + (on ? ' active' : '') })
        btn.createSpan({ text: s.label })
        btn.createSpan({ cls: 'nnn-pm-st-subtab-n', text: String(s.rows.length) })
        btn.onclick = () => selectSection(s.id)
      }
      if (model.docs.length) {
        subtabs.createSpan({ cls: 'nnn-pm-st-subtab-sep' })
        for (const d of model.docs) {
          const on = state.active?.kind === 'doc' && state.active.path === d.path
          const btn = subtabs.createEl('button', {
            cls: 'nnn-pm-st-subtab nnn-pm-st-roottab' + (on ? ' active' : ''),
            text: d.label,
          })
          btn.onclick = () => selectDoc(d)
        }
      }
    }

    // ── Toolbar ─────────────────────────────────────────────────────────────
    const drawToolbar = () => {
      toolbar.empty()
      if (state.active?.kind === 'doc') {
        toolbar.createDiv({
          cls: 'nnn-pm-st-describe',
          text: 'Root document · rendered markdown (as Obsidian shows it)',
        })
        return
      }
      const sec = currentSection()
      if (!sec) return
      const statusKey = statusKeyFor(colsFor(sec.rows))

      const sw = toolbar.createDiv({ cls: 'nnn-pm-st-viewswitch' })
      const mkView = (id: 'table' | 'cards', label: string) => {
        const b = sw.createEl('button', {
          cls: 'nnn-pm-st-vbtn' + (state.view === id ? ' active' : ''),
          text: label,
        })
        b.onclick = () => {
          state.view = id
          drawToolbar()
          drawContent()
        }
      }
      mkView('table', '▤ Table')
      mkView('cards', '▦ Cards')
      sw.createEl('button', {
        cls: 'nnn-pm-st-vbtn disabled',
        text: '◔ Viz',
        attr: { title: 'D3 view-type — later increment' },
      })

      toolbar.createDiv({ cls: 'nnn-pm-st-describe', text: `Notes in the ${sec.label} collection.` })
      toolbar.createDiv({ cls: 'nnn-pm-st-toolbar-spacer' })

      const statuses = [...new Set(sec.rows.map(r => asString(r.frontmatter[statusKey])).filter(Boolean))].sort()
      if (statuses.length) {
        const sel = toolbar.createEl('select', { cls: 'nnn-pm-st-filter-status' })
        sel.createEl('option', { text: 'All' }).value = ''
        for (const st of statuses) sel.createEl('option', { text: st }).value = st
        sel.value = state.filterStatus
        sel.onchange = () => {
          state.filterStatus = sel.value
          drawContent()
        }
      }

      const find = toolbar.createEl('input', {
        cls: 'nnn-pm-st-filter-text',
        type: 'search',
        attr: { placeholder: `Filter ${sec.rows.length} notes…` },
      })
      find.value = state.filterText
      find.oninput = () => {
        state.filterText = find.value
        drawContent()
      }
    }

    // ── Content ───────────────────────────────────────────────────────────────
    const drawContent = () => {
      if (docComp) {
        docComp.unload()
        docComp = null
      }
      content.empty()

      if (state.active?.kind === 'doc') {
        const docPath = state.active.path
        const file = ctx.app.vault.getAbstractFileByPath(docPath)
        if (!(file instanceof TFile)) {
          content.createDiv({ cls: 'nnn-pm-st-error', text: 'File not found.' })
          return
        }
        const fm = (ctx.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>
        renderPropsTable(content, fm)
        const art = content.createDiv({ cls: 'nnn-pm-st-doc markdown-preview-view markdown-rendered' })
        wireInternalLinks(ctx.app, art, docPath)
        const comp = new Component()
        docComp = comp
        comp.load()
        void ctx.app.vault
          .cachedRead(file)
          .then(raw => MarkdownRenderer.render(ctx.app, stripFrontmatter(raw), art, docPath, comp))
          .catch(() => art.createEl('p', { cls: 'nnn-pm-st-dim', text: '(could not render document)' }))
        return
      }

      const sec = currentSection()
      if (!sec) {
        content.createDiv({ cls: 'nnn-pm-st-placeholder', text: 'Select a collection.' })
        return
      }
      const cols = colsFor(sec.rows)
      if (!cols.some(c => c.key === state.sortKey)) state.sortKey = 'file'
      const statusKey = statusKeyFor(cols)
      const rows = applyFilters(sec.rows, cols, statusKey, state.filterText, state.filterStatus)

      if (state.view === 'cards') {
        renderCards(content, cols, rows, openNote)
        return
      }
      drawTable(cols, sortRows(rows, cols, state.sortKey, state.sortDir))
    }

    const drawTable = (cols: ColumnDef[], rows: VaultRow[]) => {
      const table = content.createEl('table', { cls: 'nnn-pm-st-table' })
      const htr = table.createEl('thead').createEl('tr')
      for (const c of cols) {
        const sorted = c.key === state.sortKey
        const arrow = sorted ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''
        const th = htr.createEl('th', { text: c.label + arrow })
        if (c.align === 'right') th.addClass('r')
        if (sorted) th.addClass('sorted')
        th.onclick = () => {
          if (c.key === state.sortKey) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
          else {
            state.sortKey = c.key
            state.sortDir = 'asc'
          }
          drawContent()
        }
      }
      const tbody = table.createEl('tbody')
      if (!rows.length) {
        const td = tbody.createEl('tr').createEl('td', { cls: 'nnn-pm-st-empty' })
        td.colSpan = cols.length
        td.setText('No notes match the filter.')
        return
      }
      for (const row of rows) {
        const tr = tbody.createEl('tr')
        for (const c of cols) {
          const td = tr.createEl('td')
          if (c.align === 'right') td.addClass('r')
          renderCell(td, c, row)
        }
        tr.onclick = () => openNote(row)
      }
    }

    const openNote = (row: VaultRow) => new NoteModal(ctx.app, row).open()

    // ── Selection ─────────────────────────────────────────────────────────────
    const selectSection = (id: string) => {
      state.active = { kind: 'section', id }
      state.view = 'table'
      state.sortKey = 'file'
      state.sortDir = 'asc'
      state.filterText = ''
      state.filterStatus = ''
      drawTabs()
      drawToolbar()
      drawContent()
    }
    const selectDoc = (d: RootDoc) => {
      state.active = { kind: 'doc', path: d.path, label: d.label }
      drawTabs()
      drawToolbar()
      drawContent()
    }

    const defaultActive = () => {
      const firstSection = model.sections[0]
      if (firstSection) selectSection(firstSection.id)
      else if (model.docs.length) selectDoc(model.docs[0])
      else {
        drawTabs()
        drawToolbar()
        content.empty()
        content.createDiv({ cls: 'nnn-pm-st-placeholder', text: 'No notes in this department.' })
      }
    }

    deptSel.onchange = () => {
      state.dept = deptSel.value
      ctx.scope.collection = deptSel.value // persist across view switches
      model = buildDept(ctx.app, state.dept)
      state.active = null
      defaultActive()
    }

    defaultActive()
  },
}
