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

.nnn-pm-comments { margin-top: 12px; }
.nnn-pm-comment {
  padding: 6px 0;
  border-top: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1));
}
.nnn-pm-comment-meta { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 2px; }
.nnn-pm-comment-body { white-space: pre-wrap; word-break: break-word; }
.nnn-pm-comment-composer { margin-top: 8px; }
.nnn-pm-comment-composer button { margin-top: 6px; cursor: pointer; }

.nnn-pm-notif-toolbar { margin-bottom: 8px; }
.nnn-pm-notif-toolbar button { cursor: pointer; }
.nnn-pm-notif {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  border-top: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1));
}
.nnn-pm-notif:hover { background: var(--background-modifier-hover, rgba(0,0,0,0.05)); }
.nnn-pm-notif-unread { border-left: 3px solid var(--interactive-accent, #7c6cf0); }
.nnn-pm-notif-text { font-size: 0.9rem; }
.nnn-pm-notif-unread .nnn-pm-notif-text { font-weight: 600; }
.nnn-pm-notif-meta { font-size: 0.75rem; color: var(--text-muted); }
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
