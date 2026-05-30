// NNN-PM API types — TypeScript mirrors of the backend JSON (handlers_pm.go).
// Kept deliberately small and flat; the board renderer + modals consume these.

/** A project the caller belongs to, with their effective PM role. */
export interface PMProject {
  id: number
  key: string
  name: string
  role: string // admin | lead | member | viewer
}

/** A project member from GET /pm/projects/:key/members. */
export interface PMMember {
  userId: number
  username: string
  role: string // lead | member | viewer (admins are implicit, not rows)
}

/** Board/list filter state. Every value is a string (ids stringified); an absent
 *  or empty field means "any". Mirrors the s32 server-side filter compiler. */
export interface PMIssueFilters {
  q?: string
  status?: string // status key
  priority?: string
  assignee?: string // user id
  label?: string // label id
  epic?: string // epic id
  cycle?: string // cycle id
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

/** A project label (migration 011). */
export interface PMLabel {
  id: number
  name: string
  color: string
}

/** A project epic (migration 011). */
export interface PMEpic {
  id: number
  name: string
  description: string
  status: string // open | done | cancelled
}

/** A project cycle / sprint (migration 011). Dates are YYYY-MM-DD or null. */
export interface PMCycle {
  id: number
  name: string
  startsOn?: string | null
  endsOn?: string | null
}

/** On-demand rollup from GET /pm/projects/:key/analytics (Phase 3). */
export interface PMAnalytics {
  projectKey: string
  totals: { active: number; done: number; unassigned: number }
  /** status key -> count (active issues). */
  byStatus: Record<string, number>
  /** priority -> count (active issues). */
  byPriority: Record<string, number>
  /** open issues per assignee, top 10. */
  workload: { assignee: string; open: number }[]
}

/** A project milestone (v2, migration 012). Date is YYYY-MM-DD or null. */
export interface PMMilestone {
  id: number
  name: string
  dueOn?: string | null
  status: string // open | done | cancelled
}

/** One assignee on an issue with their per-user status (v2, migration 012). */
export interface PMAssignee {
  userId: number
  username: string
  status: string // per-user progress (free vocab; the UI maps to chips)
  addedAt: string
}

/** An issue↔note (or url/issue) link (v2, migration 012). */
export interface PMIssueLink {
  id: number
  targetPath: string
  kind: string // note | url | issue
  createdAt: string
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
  /** Layer-2 relations (migration 011); null when unset. */
  parentId?: number | null
  epicId?: number | null
  cycleId?: number | null
  /** v2 relations (migration 012); null when unset. */
  milestoneId?: number | null
  assignedDepartment?: string | null
  /** Labels attached to this issue (always present, possibly empty). */
  labels: PMLabel[]
  /** Multi-assignee roster + per-user status (always present, possibly empty). */
  assignees: PMAssignee[]
  /** Linked notes/urls/issues (always present, possibly empty). */
  links: PMIssueLink[]
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

/** One comment from GET /pm/issues/:id/comments (Phase 2). */
export interface PMComment {
  id: number
  authorId?: number | null
  author?: string | null
  body: string
  edited: boolean
  createdAt: string
  updatedAt: string
}

/** One in-app notification from GET /pm/notifications (Phase 2). */
export interface PMNotification {
  id: number
  kind: string // mention | assigned | commented
  issueId?: number | null
  issueRef?: string // "ENG-42" when resolvable
  commentId?: number | null
  actorId?: number | null
  actor?: string | null
  read: boolean
  createdAt: string
}
