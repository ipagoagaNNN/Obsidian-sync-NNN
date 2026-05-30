// NNN-PM API types — TypeScript mirrors of the backend JSON (handlers_pm.go).
// Kept deliberately small and flat; the board renderer + modals consume these.

/** A project the caller belongs to, with their effective PM role. */
export interface PMProject {
  id: number
  key: string
  name: string
  role: string // admin | lead | member | viewer
}

/** One workflow status (board column). */
export interface PMStatusMeta {
  key: string
  name: string
  category: string
  sortOrder: number
}

/** Static board config from GET /pm/meta. */
export interface PMMeta {
  statuses: PMStatusMeta[]
  /** from-status -> allowed to-statuses (drives drag-target dimming). */
  transitions: Record<string, string[]>
  priorities: string[]
}

/** Issue as it appears in lists + board columns. */
export interface PMIssueSummary {
  id: number
  projectKey: string
  number: number
  ref: string // "ENG-42"
  title: string
  status: string
  priority: string
  assigneeId?: number | null
  updatedAt: string
}

export interface PMBoardColumn {
  status: string
  name: string
  issues: PMIssueSummary[]
}

export interface PMBoard {
  projectKey: string
  columns: PMBoardColumn[]
}

/** Full issue from GET /pm/issues/:id. */
export interface PMIssueDetail {
  id: number
  ref: string
  projectKey: string
  number: number
  title: string
  description: string
  status: string
  priority: string
  assigneeId?: number | null
  reporterId?: number | null
  createdAt: string
  updatedAt: string
}

/** One row from GET /pm/issues/:id/activity. */
export interface PMActivityEntry {
  id: number
  actorId?: number
  actor?: string
  action: string
  detail?: unknown
  createdAt: string
}
