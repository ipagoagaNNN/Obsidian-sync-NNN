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

/* Milestones table (Manage) — name / status / due / goal, inline-editable */
.nnn-pm-ms-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 4px 0 8px; }
.nnn-pm-ms-table th {
  text-align: left;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  padding: 4px 6px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12));
}
.nnn-pm-ms-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.06));
  vertical-align: middle;
}
.nnn-pm-ms-name { font-weight: 600; }
.nnn-pm-ms-due { color: var(--text-muted); white-space: nowrap; }
.nnn-pm-ms-status { font-size: 0.78rem; }
.nnn-pm-ms-goal { width: 100%; box-sizing: border-box; font-size: 0.8rem; }

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
  gap: 5px 12px;
  align-items: center;
  padding: 4px 2px 6px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1));
  margin-bottom: 8px;
}
.nnn-pm-host-views, .nnn-pm-host-scope { display: inline-flex; align-items: center; gap: 6px; }
.nnn-pm-host-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint, var(--text-muted)); }
.nnn-pm-host-views select { font-size: 0.82rem; padding: 2px 6px; }
.nnn-pm-scope-pills { display: inline-flex; flex-wrap: wrap; gap: 5px; }
.nnn-pm-scope-pill {
  cursor: pointer;
  padding: 2px 9px;
  border-radius: 11px;
  font-size: 0.78rem;
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.15));
  background: var(--background-secondary);
  color: var(--text-muted);
  box-shadow: none;
}
.nnn-pm-scope-all { font-weight: 600; }
.nnn-pm-scope-all:not(.nnn-pm-scope-on) { border-style: dashed; color: var(--text-normal); }
.nnn-pm-scope-pill:hover { color: var(--text-normal); }
.nnn-pm-scope-on {
  background: var(--interactive-accent, #7c6cf0);
  color: var(--text-on-accent, #fff);
  border-color: var(--interactive-accent, #7c6cf0);
}
.nnn-pm-host-refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.15));
  border-radius: var(--radius-s, 6px);
  color: var(--text-muted);
  padding: 4px 7px;
  box-shadow: none;
}
.nnn-pm-host-refresh:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
.nnn-pm-host-refresh svg { width: 15px; height: 15px; }

/* Stacked multi-project board sections */
.nnn-pm-board-section { margin-bottom: 22px; }
.nnn-pm-board-section-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin: 4px 0 8px;
  color: var(--text-normal);
}

/* ── P1.7: tabbed issue-detail modal (header grid + status control + tabs) ───── */
.nnn-pm-detail-header { margin-bottom: 10px; }
.nnn-pm-detail-titlerow { display: flex; align-items: baseline; gap: 10px; }
.nnn-pm-detail-ref { margin: 0; flex: 0 0 auto; }
.nnn-pm-prio {
  text-transform: capitalize;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 1px 9px;
  border-radius: 10px;
  background: var(--background-modifier-hover, rgba(0,0,0,0.06));
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12));
  color: var(--text-muted);
}
.nnn-pm-prio-low { color: #3a8f5a; border-color: #3a8f5a55; }
.nnn-pm-prio-medium { color: #b88a1a; border-color: #b88a1a55; }
.nnn-pm-prio-high { color: #d2691e; border-color: #d2691e55; }
.nnn-pm-prio-urgent {
  color: var(--text-on-accent, #fff);
  background: var(--text-error, #e5534b);
  border-color: var(--text-error, #e5534b);
}

.nnn-pm-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin: 10px 0;
}
.nnn-pm-summary-cell {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
}
.nnn-pm-summary-key {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.nnn-pm-summary-val { font-size: 0.92rem; font-weight: 600; margin-top: 1px; }

.nnn-pm-status-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0 4px; }
.nnn-pm-field-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  flex: 0 0 auto;
}
.nnn-pm-status-track { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.nnn-pm-status-pill {
  cursor: pointer;
  padding: 3px 12px;
  border-radius: 13px;
  font-size: 0.8rem;
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.15));
  background: var(--background-secondary);
  color: var(--text-muted);
}
.nnn-pm-status-pill.nnn-pm-status-current {
  background: var(--interactive-accent, #7c6cf0);
  color: var(--text-on-accent, #fff);
  border-color: var(--interactive-accent, #7c6cf0);
  cursor: default;
}
.nnn-pm-status-pill.nnn-pm-status-target { color: var(--text-normal); border-color: var(--interactive-accent, #7c6cf0); }
.nnn-pm-status-pill.nnn-pm-status-target:hover {
  background: var(--interactive-accent, #7c6cf0);
  color: var(--text-on-accent, #fff);
}
.nnn-pm-status-pill.nnn-pm-status-disabled { opacity: 0.4; cursor: not-allowed; }
.nnn-pm-status-select {
  padding: 4px 9px;
  border-radius: var(--radius-s, 6px);
  border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.18));
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: 0.85rem;
  cursor: pointer;
}

.nnn-pm-tabstrip {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12));
  margin-top: 10px;
}
.nnn-pm-tab {
  cursor: pointer;
  padding: 6px 14px;
  font-size: 0.85rem;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  box-shadow: none;
}
.nnn-pm-tab:hover { color: var(--text-normal); }
.nnn-pm-tab.nnn-pm-tab-on {
  color: var(--text-normal);
  font-weight: 600;
  border-bottom-color: var(--interactive-accent, #7c6cf0);
}
.nnn-pm-tabbody { padding-top: 10px; }
.nnn-pm-tabpanel { display: none; }
.nnn-pm-tabpanel.nnn-pm-tab-active { display: block; }

.nnn-pm-detail-footer {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12));
}

/* 4-column field grid for the Details tab: section headers + labels in column 1,
   controls spanning columns 2-4. */
.nnn-pm-fieldgrid {
  display: grid;
  grid-template-columns: minmax(92px, 132px) 1fr 1fr 1fr;
  gap: 8px 12px;
  align-items: start;
  margin: 4px 0 8px;
}
.nnn-pm-fieldgrid-section {
  grid-column: 1 / -1;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-normal);
  margin: 12px 0 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12));
}
.nnn-pm-fieldgrid-section:first-child { margin-top: 0; }
.nnn-pm-fieldgrid-label {
  grid-column: 1;
  font-size: 0.82rem;
  color: var(--text-muted);
  padding-top: 6px;
}
.nnn-pm-fieldgrid-control { grid-column: 2 / -1; min-width: 0; }
.nnn-pm-fieldgrid-control input[type="text"],
.nnn-pm-fieldgrid-control textarea,
.nnn-pm-fieldgrid-control select { width: 100%; box-sizing: border-box; }
.nnn-pm-fieldgrid-control textarea { resize: vertical; font-family: inherit; }
.nnn-pm-fieldgrid-control .nnn-pm-chip-add { margin-top: 6px; }

/* Richer activity feed */
.nnn-pm-activity-feed { list-style: none; padding: 0; margin: 4px 0; }
.nnn-pm-activity-item { display: flex; gap: 8px; padding: 5px 0; align-items: flex-start; }
.nnn-pm-activity-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--interactive-accent, #7c6cf0);
}
.nnn-pm-activity-main { flex: 1 1 auto; min-width: 0; }
.nnn-pm-activity-line { font-size: 0.86rem; }
.nnn-pm-activity-actor { font-weight: 600; }
.nnn-pm-activity-action { color: var(--text-normal); }
.nnn-pm-activity-detail {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 1px 0;
  word-break: break-word;
}
.nnn-pm-activity-when { font-size: 0.74rem; color: var(--text-muted); }

/* ── P2: vault-plane table view — VizLab Studio aesthetics (ported 1:1) ─────── */
.nnn-pm-st { display: flex; flex-direction: column; min-width: 0; }

/* Head: department picker + subtabs */
.nnn-pm-st-head { border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 0; }
.nnn-pm-st-deptrow { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.nnn-pm-st-deptlabel {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}
.nnn-pm-st-dept {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-normal);
  border-radius: var(--radius-s);
  padding: 4px 9px;
  font-size: var(--font-ui-small);
}
.nnn-pm-st-subtabs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.nnn-pm-st-subtab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);
  padding: 8px 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-shadow: none;
  transition: color 0.12s, border-color 0.12s;
}
.nnn-pm-st-subtab:hover { color: var(--text-normal); }
.nnn-pm-st-subtab.active { color: var(--text-accent); border-bottom-color: var(--interactive-accent); }
.nnn-pm-st-subtab-n { font-family: var(--font-monospace); font-size: 10px; color: var(--text-faint); }
.nnn-pm-st-subtab.active .nnn-pm-st-subtab-n { color: var(--text-accent); }
.nnn-pm-st-roottab { font-family: var(--font-monospace); font-size: var(--font-ui-smaller); opacity: 0.85; }
.nnn-pm-st-subtab-sep { width: 1px; align-self: stretch; background: var(--background-modifier-border); margin: 6px 8px; }

/* Toolbar: view switch + describe + status filter + find */
.nnn-pm-st-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-wrap: wrap;
}
.nnn-pm-st-toolbar:empty { display: none; }
.nnn-pm-st-viewswitch {
  display: flex;
  gap: 2px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: 2px;
}
.nnn-pm-st-vbtn {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  box-shadow: none;
}
.nnn-pm-st-vbtn:hover { color: var(--text-normal); }
.nnn-pm-st-vbtn.active { background: var(--background-modifier-active); color: var(--text-accent); }
.nnn-pm-st-vbtn.disabled { opacity: 0.4; cursor: not-allowed; }
.nnn-pm-st-describe { font-size: var(--font-ui-smaller); color: var(--text-faint); font-style: italic; }
.nnn-pm-st-toolbar-spacer { flex: 1 1 auto; }
.nnn-pm-st-filter-text, .nnn-pm-st-filter-status {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-normal);
  border-radius: var(--radius-s);
  padding: 5px 9px;
  font-family: var(--font-interface);
  font-size: var(--font-ui-smaller);
  outline: none;
}
.nnn-pm-st-filter-text { width: 200px; }
.nnn-pm-st-filter-text:focus, .nnn-pm-st-filter-status:focus { border-color: var(--background-modifier-border-focus); }

/* Content */
.nnn-pm-st-content { padding: 16px 0 28px; }
.nnn-pm-st-placeholder, .nnn-pm-st-loading, .nnn-pm-st-empty {
  color: var(--text-faint);
  font-style: italic;
  padding: 28px 6px;
  font-size: var(--font-ui-small);
}
.nnn-pm-st-error { color: var(--text-error); padding: 20px 6px; font-family: var(--font-monospace); font-size: var(--font-ui-smaller); }
.nnn-pm-st-dim { color: var(--text-faint); }

/* Table */
.nnn-pm-st-table { width: 100%; border-collapse: collapse; font-size: var(--font-ui-small); }
.nnn-pm-st-table thead th {
  position: sticky;
  top: 0;
  background: var(--background-primary);
  text-align: left;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-weight: 600;
  color: var(--text-muted);
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.nnn-pm-st-table thead th:hover { color: var(--text-normal); }
.nnn-pm-st-table thead th.sorted { color: var(--text-accent); }
.nnn-pm-st-table thead th.r, .nnn-pm-st-table td.r { text-align: right; }
.nnn-pm-st-table tbody tr { border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; transition: background 0.1s; }
.nnn-pm-st-table tbody tr:hover { background: var(--background-modifier-hover); }
.nnn-pm-st-table td { padding: 7px 12px; vertical-align: top; color: var(--text-normal); }
.nnn-pm-st-cell-title { font-weight: 500; color: var(--text-normal); }
.nnn-pm-st-table tbody tr:hover .nnn-pm-st-cell-title { color: var(--text-accent); }
.nnn-pm-st-empty { text-align: center; }

/* Pills / tags / links */
.nnn-pm-st-pill {
  display: inline-block;
  font-family: var(--font-monospace);
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  color: var(--pill, var(--text-muted));
  background: color-mix(in srgb, var(--pill, var(--text-faint)) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--pill, var(--text-faint)) 35%, transparent);
  white-space: nowrap;
}
.nnn-pm-st-tags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.nnn-pm-st-tag { font-family: var(--font-monospace); font-size: 10px; color: var(--tag-color); background: var(--tag-background); border-radius: 4px; padding: 1px 6px; }
.nnn-pm-st-tag.nnn-pm-st-more { color: var(--text-faint); background: transparent; }
.nnn-pm-st-link { font-family: var(--font-monospace); font-size: var(--font-ui-smaller); color: var(--text-accent); }

/* Cards */
.nnn-pm-st-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.nnn-pm-st-card {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  padding: 13px 14px;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.08s;
}
.nnn-pm-st-card:hover { border-color: var(--background-modifier-border-hover); transform: translateY(-1px); }
.nnn-pm-st-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.nnn-pm-st-card-title { font-weight: 600; color: var(--text-normal); line-height: 1.3; }
.nnn-pm-st-card-badges { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; }
.nnn-pm-st-cardmeta { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 10px; }
.nnn-pm-st-cardmeta-item { font-family: var(--font-monospace); font-size: 10.5px; color: var(--text-muted); }
.nnn-pm-st-cardmeta-item .k { color: var(--text-faint); }
.nnn-pm-st-card .nnn-pm-st-tags { margin-top: 9px; }

/* Doc (canonical root file rendered as markdown) */
.nnn-pm-st-doc { max-width: 820px; line-height: 1.6; color: var(--text-normal); }

/* Note drill-down modal (frontmatter props + rendered body) */
.nnn-pm-st-modal { width: min(860px, 92vw); max-width: 92vw; }
.nnn-pm-st-modal .modal-content { padding-top: 8px; max-height: 78vh; overflow: auto; }
.nnn-pm-st-modal-title { display: flex; align-items: center; gap: 8px; font-family: var(--font-monospace); font-weight: 600; color: var(--text-normal); margin-bottom: 14px; }
.nnn-pm-st-modal-open { display: inline-flex; cursor: pointer; color: var(--text-muted); }
.nnn-pm-st-modal-open:hover { color: var(--text-accent); }
.nnn-pm-st-modal-open svg { width: 15px; height: 15px; }
.nnn-pm-st-props-wrap { margin-bottom: 18px; }
.nnn-pm-st-props {
  width: 100%;
  border-collapse: collapse;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  overflow: hidden;
}
.nnn-pm-st-props td { padding: 5px 12px; border-bottom: 1px solid var(--background-modifier-border); font-size: var(--font-ui-smaller); vertical-align: top; }
.nnn-pm-st-prop-k { font-family: var(--font-monospace); color: var(--text-muted); width: 180px; }
.nnn-pm-st-prop-v { color: var(--text-normal); }
.nnn-pm-st-note { margin-top: 4px; }
.nnn-pm-st-modal-foot { margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--background-modifier-border); font-size: var(--font-ui-smaller); color: var(--text-faint); }
.nnn-pm-st-modal-foot code { font-family: var(--font-monospace); }

/* ── P3/P4: Roadmap (Gantt) + Data viz views ──────────────────────────────── */
.nnn-pm-viz-host { display: flex; flex-direction: column; min-width: 0; }
.nnn-pm-viz-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--background-modifier-border);
  padding-bottom: 8px;
}
.nnn-pm-viz-title { font-weight: 700; font-size: 1rem; }
.nnn-pm-viz-sub { font-size: var(--font-ui-smaller, 0.75rem); color: var(--text-faint, var(--text-muted)); font-style: italic; }
.nnn-pm-viz-body { overflow-x: auto; }
.nnn-pm-gantt { display: block; min-width: 640px; }
.nnn-pm-viz-panel { margin: 0 0 18px; }
.nnn-pm-viz-panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.nnn-pm-viz-panel-title { font-weight: 600; font-size: 0.9rem; }
.nnn-pm-viz-live, .nnn-pm-viz-skel {
  font-family: var(--font-monospace);
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border-radius: 8px;
}
.nnn-pm-viz-live { color: #3a9f5a; background: color-mix(in srgb, #3a9f5a 16%, transparent); }
.nnn-pm-viz-skel { color: var(--text-muted); background: var(--background-modifier-border); }
.nnn-pm-viz-panel-body { overflow-x: auto; }
.nnn-pm-viz-panel-body svg { display: block; min-width: 560px; }

/* ── Home tab (Phase 1) ──────────────────────────────────────────────────────── */
.nnn-home { display: flex; flex-direction: column; height: 100%; }
.nnn-home-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; flex-shrink: 0;
  border-bottom: 1px solid var(--background-modifier-border);
}
.nnn-home-brand { font-weight: 700; font-size: 1.05rem; color: var(--text-normal); }
.nnn-home-actions { display: flex; align-items: center; gap: 6px; }
.nnn-home-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 6px; border: none; cursor: pointer;
  background: transparent; color: var(--text-muted); border-radius: var(--radius-s, 6px);
}
.nnn-home-iconbtn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
.nnn-home-iconbtn.is-active { color: var(--interactive-accent); }
.nnn-home-iconbtn-sm { width: 24px; height: 24px; padding: 3px; }
.nnn-home-iconbtn-sm.is-fav { color: var(--text-accent, #e0af68); }
.nnn-home-iconbtn svg { width: 17px; height: 17px; }
.nnn-home-iconbtn-sm svg { width: 14px; height: 14px; }
.nnn-home-bell { position: relative; display: inline-flex; }
.nnn-home-badge {
  position: absolute; top: -2px; right: -2px; box-sizing: border-box;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--interactive-accent); color: var(--text-on-accent, #fff);
  font-size: 0.62rem; font-weight: 700; line-height: 16px; text-align: center;
}

.nnn-home-scroll { flex: 1; overflow-y: auto; padding: 22px 18px 60px; }

/* hero search */
.nnn-home-hero { max-width: 640px; margin: 14px auto 30px; position: relative; }
.nnn-home-search-input {
  width: 100%; box-sizing: border-box; text-align: center;
  font-size: 1.15rem; padding: 13px 18px; color: var(--text-normal);
  background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-l, 12px); transition: border-color 0.12s, box-shadow 0.12s;
}
.nnn-home-search-input:focus {
  outline: none; border-color: var(--interactive-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 25%, transparent);
}
.nnn-home-results {
  margin-top: 8px; overflow: hidden; background: var(--background-primary);
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.18);
}
.nnn-home-result {
  display: flex; align-items: center; gap: 9px; padding: 8px 13px; cursor: pointer;
  border-bottom: 1px solid var(--background-modifier-border);
}
.nnn-home-result:last-child { border-bottom: none; }
.nnn-home-result:hover, .nnn-home-result.is-selected { background: var(--background-modifier-hover); }
.nnn-home-result.is-selected { box-shadow: inset 2px 0 0 var(--interactive-accent); }
.nnn-home-result-icon { display: inline-flex; color: var(--text-muted); }
.nnn-home-result-icon svg { width: 15px; height: 15px; }
.nnn-home-result-title { color: var(--text-normal); font-weight: 500; }
.nnn-home-result-path {
  margin-left: auto; color: var(--text-faint);
  font-size: 0.78rem; font-family: var(--font-monospace);
}

/* sections */
.nnn-home-section { max-width: 980px; margin: 0 auto 26px; }
.nnn-home-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.nnn-home-section-title {
  font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--text-muted);
}
.nnn-home-section-actions { margin-left: auto; display: flex; gap: 6px; }
.nnn-home-textbtn {
  background: transparent; border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s, 6px); color: var(--text-muted); cursor: pointer;
  font-size: 0.78rem; padding: 3px 9px;
}
.nnn-home-textbtn:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
.nnn-home-empty { color: var(--text-faint); font-size: 0.85rem; padding: 4px 2px; }
.nnn-home-empty-inline { padding: 6px 2px; }

/* collections */
.nnn-home-collection { margin-bottom: 18px; }
.nnn-home-collection-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.nnn-home-collection-icon { display: inline-flex; color: var(--text-muted); }
.nnn-home-collection-icon svg { width: 15px; height: 15px; }
.nnn-home-collection-title { font-weight: 600; color: var(--text-normal); }
.nnn-home-collection-actions { display: flex; gap: 2px; margin-left: 6px; }

/* card grid */
.nnn-home-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 10px; }
.nnn-home-card {
  --nnn-home-accent: var(--interactive-accent);
  position: relative; display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 11px 13px; cursor: pointer;
  background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
  border-left: 3px solid var(--nnn-home-accent); border-radius: var(--radius-m, 8px);
  transition: border-color 0.12s, transform 0.08s, box-shadow 0.12s;
}
.nnn-home-card:hover {
  transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
  border-color: var(--background-modifier-border-hover);
}
.nnn-home-card.is-editing { cursor: default; }
.nnn-home-card.is-dragging { opacity: 0.5; }
.nnn-home-card-icon { display: inline-flex; flex-shrink: 0; color: var(--nnn-home-accent); }
.nnn-home-card-icon svg { width: 18px; height: 18px; }
.nnn-home-card-body { min-width: 0; }
.nnn-home-card-label {
  font-weight: 500; color: var(--text-normal);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nnn-home-card-sub {
  font-size: 0.72rem; color: var(--text-faint); font-family: var(--font-monospace);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nnn-home-card-actions {
  position: absolute; top: 4px; right: 4px; display: none; gap: 1px; padding: 1px;
  background: var(--background-secondary); border-radius: var(--radius-s, 6px);
}
.nnn-home-card:hover .nnn-home-card-actions { display: flex; }
.nnn-home-card-star:has(.is-fav) { display: flex; }

/* home modals (prompt + edit-link) */
.nnn-home-prompt-input {
  width: 100%; box-sizing: border-box; margin: 8px 0; padding: 8px 10px;
  color: var(--text-normal); background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px);
}
.nnn-home-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.nnn-home-modal-actions button { cursor: pointer; }
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
