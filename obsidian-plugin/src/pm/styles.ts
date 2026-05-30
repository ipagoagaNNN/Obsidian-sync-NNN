// Board styles, injected as a <style> element at load.
//
// Why injected instead of a styles.css file: the in-app updater (main.ts
// performUpdate) only fetches main.js + manifest.json, so a separate styles.css
// would go stale on update. Bundling the CSS into main.js and injecting it
// guarantees it always matches the code that's running.
//
// Layout/structure stays inline in board.ts; this file holds only the
// interactive affordances that inline styles can't express (hover, the
// drag-droppable outline) plus a couple of shared classes.

const STYLE_EL_ID = 'nnn-pm-styles'

const PM_CSS = `
.nnn-pm-error { color: var(--text-error, #e5534b); }
.nnn-pm-loading { color: var(--text-muted); }

.nnn-pm-toolbar button,
.nnn-pm-transitions button { cursor: pointer; }

.nnn-pm-card { transition: box-shadow 120ms ease, transform 120ms ease; }
.nnn-pm-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}
.nnn-pm-card:active { cursor: grabbing; }

.nnn-pm-col-droppable {
  outline: 2px dashed var(--interactive-accent, #7c6cf0);
  outline-offset: -2px;
}

.nnn-pm-activity ul { padding-left: 1.1em; margin: 4px 0; }
.nnn-pm-activity li { font-size: 0.82rem; color: var(--text-muted); }
`

/** Inject the board stylesheet once (idempotent). */
export function injectPMStyles(): void {
  if (document.getElementById(STYLE_EL_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_EL_ID
  el.textContent = PM_CSS
  document.head.appendChild(el)
}

/** Remove the injected stylesheet (called on plugin unload). */
export function removePMStyles(): void {
  document.getElementById(STYLE_EL_ID)?.remove()
}
