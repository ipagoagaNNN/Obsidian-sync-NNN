// Shared note helpers for the vault-plane Summary view (ADR-014, P2):
// frontmatter stripping, a "properties" table, and wiring rendered-markdown
// internal links so a click opens the real note. Used by the note modal and
// the canonical root-document renderer.

import type { App } from 'obsidian'
import { asString, enumColor } from './columns'

const ENUMISH = /status|severity|risk|outcome|category|priority|state|level/i

/** Strip a leading YAML frontmatter block so the body renders without the raw
 *  `--- … ---` (properties are shown in a table instead). */
export function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? raw.slice(m[0].length) : raw
}

/** Render a note's frontmatter as an Obsidian-style "properties" table. Enum-ish
 *  keys (status/severity/…) render as colored pills. No-op when empty. */
export function renderPropsTable(host: HTMLElement, fm: Record<string, unknown>): void {
  const entries = Object.entries(fm).filter(([k]) => k !== 'position')
  if (!entries.length) return
  const wrap = host.createDiv({ cls: 'nnn-pm-st-props-wrap' })
  const table = wrap.createEl('table', { cls: 'nnn-pm-st-props' })
  for (const [k, v] of entries) {
    const tr = table.createEl('tr')
    tr.createEl('td', { cls: 'nnn-pm-st-prop-k', text: k })
    const vtd = tr.createEl('td', { cls: 'nnn-pm-st-prop-v' })
    const s = asString(v)
    if (ENUMISH.test(k) && s) {
      const p = vtd.createSpan({ cls: 'nnn-pm-st-pill', text: s })
      p.style.setProperty('--pill', enumColor(s))
    } else if (s) {
      vtd.setText(s)
    } else {
      vtd.createSpan({ cls: 'nnn-pm-st-dim', text: '—' })
    }
  }
}

/** Delegate clicks on rendered-markdown internal links to Obsidian navigation
 *  (opens the real note in a new tab). External links fall through to default.
 *  `onNavigate` fires before navigation (e.g. to close a modal). */
export function wireInternalLinks(
  app: App,
  container: HTMLElement,
  sourcePath: string,
  onNavigate?: () => void,
): void {
  container.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const internal = a.classList.contains('internal-link') || a.hasAttribute('data-href')
    if (!internal) return
    e.preventDefault()
    const href = a.getAttribute('data-href') || a.getAttribute('href') || ''
    if (!href) return
    onNavigate?.()
    void app.workspace.openLinkText(href, sourcePath, true)
  })
}
