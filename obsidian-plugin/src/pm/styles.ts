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

/* ── Layer-2: detail rows, label chips, epic/cycle/parent selects ───────────── */
.nnn-pm-details { margin-top: 12px; }
.nnn-pm-detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.nnn-pm-detail-label {
  flex: 0 0 64px;
  font-size: 0.82rem;
  color: var(--text-muted);
}
.nnn-pm-detail-row select { max-width: 60%; }

.nnn-pm-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nnn-pm-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 11px;
  font-size: 0.8rem;
  background: var(--background-modifier-hover, rgba(0,0,0,0.06));
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1));
}
.nnn-pm-chip-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
.nnn-pm-chip-x { cursor: pointer; color: var(--text-muted); font-weight: 600; }
.nnn-pm-chip-x:hover { color: var(--text-error, #e5534b); }
.nnn-pm-chip-add { display: inline-flex; gap: 4px; align-items: center; }
.nnn-pm-chip-add button { cursor: pointer; }

/* ── v2: assignees, links, wikilinks, toggle chips, dept queue ──────────────── */
.nnn-pm-wikilink {
  cursor: pointer;
  color: var(--text-accent, var(--interactive-accent, #7c6cf0));
  text-decoration: underline;
}
.nnn-pm-wikilink:hover { text-decoration: none; }

.nnn-pm-assignees, .nnn-pm-links { margin-top: 12px; }
.nnn-pm-assignee-list, .nnn-pm-link-list { margin: 4px 0 6px; }
.nnn-pm-assignee-row, .nnn-pm-link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.nnn-pm-assignee-name { flex: 0 0 auto; font-weight: 500; }
.nnn-pm-assignee-status { font-size: 0.8rem; }
.nnn-pm-link-row .nnn-pm-subissue-link { flex: 1 1 auto; word-break: break-all; }

/* Toggle chip (label picker in the create modal) */
.nnn-pm-chip-toggle { cursor: pointer; opacity: 0.65; }
.nnn-pm-chip-toggle:hover { opacity: 0.9; }
.nnn-pm-chip-on {
  opacity: 1;
  border-color: var(--interactive-accent, #7c6cf0);
  box-shadow: 0 0 0 1px var(--interactive-accent, #7c6cf0) inset;
}

.nnn-pm-subissues { margin-top: 10px; }
.nnn-pm-subissue-list { padding-left: 1.1em; margin: 4px 0; }
.nnn-pm-subissue-link { cursor: pointer; color: var(--text-accent, var(--interactive-accent, #7c6cf0)); }
.nnn-pm-subissue-link:hover { text-decoration: underline; }

/* ── Manage modal (labels / epics / cycles) ────────────────────────────────── */
.nnn-pm-manage-section { margin-bottom: 16px; }
.nnn-pm-manage-form { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.nnn-pm-manage-form input[type="text"] { flex: 1 1 140px; }
.nnn-pm-manage-form button { cursor: pointer; }
.nnn-pm-manage-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 3px 0;
  border-top: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08));
}
.nnn-pm-manage-name { font-weight: 500; }
.nnn-pm-manage-meta { font-size: 0.78rem; color: var(--text-muted); }

/* ── Analytics modal ───────────────────────────────────────────────────────── */
.nnn-pm-stat-row { display: flex; gap: 12px; margin: 8px 0 14px; }
.nnn-pm-stat {
  flex: 1 1 0;
  text-align: center;
  padding: 8px;
  border-radius: 8px;
  background: var(--background-secondary);
}
.nnn-pm-stat-value { font-size: 1.5rem; font-weight: 700; }
.nnn-pm-stat-label { font-size: 0.76rem; color: var(--text-muted); }
.nnn-pm-analytics-block { margin: 12px 0; }
.nnn-pm-bar-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
.nnn-pm-bar-label { flex: 0 0 110px; font-size: 0.82rem; text-align: right; }
.nnn-pm-bar-track {
  flex: 1 1 auto;
  height: 14px;
  background: var(--background-modifier-border, rgba(0,0,0,0.08));
  border-radius: 7px;
  overflow: hidden;
}
.nnn-pm-bar-fill {
  height: 100%;
  min-width: 2px;
  background: var(--interactive-accent, #7c6cf0);
  border-radius: 7px;
}
.nnn-pm-bar-value { flex: 0 0 28px; font-size: 0.8rem; color: var(--text-muted); }
.nnn-pm-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.nnn-pm-table th, .nnn-pm-table td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08));
}
.nnn-pm-table th:last-child, .nnn-pm-table td:last-child { text-align: right; width: 56px; }

/* ── Board filter bar ──────────────────────────────────────────────────────── */
.nnn-pm-filterbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
  padding: 8px 10px;
  margin-bottom: 10px;
  background: var(--background-secondary);
  border-radius: 8px;
}
.nnn-pm-filter { display: inline-flex; align-items: center; gap: 5px; }
.nnn-pm-filter-label { font-size: 0.75rem; color: var(--text-muted); }
.nnn-pm-filterbar select, .nnn-pm-filterbar input { font-size: 0.82rem; }
.nnn-pm-filterbar button { cursor: pointer; }
.nnn-pm-filter-active {
  font-weight: 600;
  color: var(--text-accent, var(--interactive-accent, #7c6cf0));
}

/* ── Full-tab host (view selector + multi-select scope) ────────────────────── */
.nnn-pm-host-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  align-items: center;
  padding: 8px 4px 12px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1));
  margin-bottom: 12px;
}
.nnn-pm-host-views, .nnn-pm-host-scope { display: inline-flex; align-items: center; gap: 8px; }
.nnn-pm-host-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.nnn-pm-scope-pills { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.nnn-pm-scope-pill {
  cursor: pointer;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.15));
  background: var(--background-secondary);
  color: var(--text-muted);
}
.nnn-pm-scope-pill:hover { color: var(--text-normal); }
.nnn-pm-scope-on {
  background: var(--interactive-accent, #7c6cf0);
  color: var(--text-on-accent, #fff);
  border-color: var(--interactive-accent, #7c6cf0);
}

/* Stacked multi-project board sections */
.nnn-pm-board-section { margin-bottom: 22px; }
.nnn-pm-board-section-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin: 4px 0 8px;
  color: var(--text-normal);
}
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
