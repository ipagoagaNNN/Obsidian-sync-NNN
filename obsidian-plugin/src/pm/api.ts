// PMClient — typed wrapper over the backend /pm/* endpoints.
//
// Every call sends the plugin's session token as a Bearer header (the same
// token the sync engine obtains via login). The client is intentionally thin:
// no caching, no retry — the board re-fetches on demand and the server's own
// in-memory cache absorbs the load. On a 401 we surface a clear "reconnect"
// message rather than duplicating the sync engine's ReauthModal flow; the user
// clicks Connect (sync) to refresh the session, then the board works.

import { PLUGIN_VERSION } from '../version'
import type {
  PMActivityEntry,
  PMAnalytics,
  PMAssignee,
  PMBoard,
  PMComment,
  PMCycle,
  PMEpic,
  PMIssueDetail,
  PMIssueFilters,
  PMIssueLink,
  PMIssueSummary,
  PMLabel,
  PMMember,
  PMMeta,
  PMMilestone,
  PMNotification,
  PMProject,
} from './types'

/** Error carrying the HTTP status so callers can branch (401/403/503/...). */
export class PMError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'PMError'
    this.status = status
  }
}

export interface CreateIssueInput {
  project: string
  title: string
  description?: string
  priority?: string
  assigneeId?: number
}

export interface PatchIssueInput {
  title?: string
  description?: string
  priority?: string
  assigneeId?: number // 0 clears the assignee
  parentId?: number // 0 clears the parent; >0 sets (same-project, no cycle)
  epicId?: number // 0 clears the epic; >0 sets (same-project)
  cycleId?: number // 0 clears the cycle; >0 sets (same-project)
  milestoneId?: number // v2: 0 clears the milestone; >0 sets (same-project)
  assignedDepartment?: string // v2: "" clears the department queue; else sets it
}

export class PMClient {
  constructor(
    private readonly spaceUrl: string,
    private readonly getToken: () => string,
  ) {}

  private base(): string {
    return this.spaceUrl.replace(/\/$/, '')
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.getToken()
    if (!token) {
      throw new PMError(401, 'Not connected — click Connect (sync) to start a session first.')
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-Plugin-Version': PLUGIN_VERSION,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetch(this.base() + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 204) return undefined as T

    const text = await res.text()
    if (!res.ok) {
      if (res.status === 401) {
        throw new PMError(401, 'Session expired — click Connect (sync) to sign in again.')
      }
      if (res.status === 503) {
        throw new PMError(503, 'NNN-PM is not enabled on the server yet (pm schema pending).')
      }
      throw new PMError(res.status, text || res.statusText)
    }
    return (text ? JSON.parse(text) : (undefined as T)) as T
  }

  // Raw-text GET (no JSON.parse) for endpoints that return CSV/plain bodies.
  // Shares req()'s auth + error mapping.
  private async reqRaw(path: string): Promise<string> {
    const token = this.getToken()
    if (!token) {
      throw new PMError(401, 'Not connected — click Connect (sync) to start a session first.')
    }
    const res = await fetch(this.base() + path, {
      headers: { Authorization: `Bearer ${token}`, 'X-Plugin-Version': PLUGIN_VERSION },
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status === 401) {
        throw new PMError(401, 'Session expired — click Connect (sync) to sign in again.')
      }
      if (res.status === 503) {
        throw new PMError(503, 'NNN-PM is not enabled on the server yet (pm schema pending).')
      }
      throw new PMError(res.status, text || res.statusText)
    }
    return text
  }

  // ── reads ──────────────────────────────────────────────────────────────────
  meta(): Promise<PMMeta> {
    return this.req<PMMeta>('GET', '/pm/meta')
  }
  projects(): Promise<PMProject[]> {
    return this.req<PMProject[]>('GET', '/pm/projects')
  }
  board(projectKey: string): Promise<PMBoard> {
    return this.req<PMBoard>('GET', `/pm/projects/${encodeURIComponent(projectKey)}/board`)
  }
  // Filtered, paginated issue list (50/page) — the board endpoint takes no
  // filters, so the board's filter bar pages this and groups the result by
  // status. Honors the s32 injection-safe filter compiler (every value bound $N).
  listIssues(opts: { project: string; page?: number } & PMIssueFilters): Promise<PMIssueSummary[]> {
    const p = new URLSearchParams({ project: opts.project })
    if (opts.page && opts.page > 1) p.set('page', String(opts.page))
    if (opts.q) p.set('q', opts.q)
    if (opts.status) p.set('status', opts.status)
    if (opts.priority) p.set('priority', opts.priority)
    if (opts.assignee) p.set('assignee', opts.assignee)
    if (opts.label) p.set('label', opts.label)
    if (opts.epic) p.set('epic', opts.epic)
    if (opts.cycle) p.set('cycle', opts.cycle)
    return this.req<PMIssueSummary[]>('GET', `/pm/issues?${p.toString()}`)
  }
  members(projectKey: string): Promise<PMMember[]> {
    return this.req<PMMember[]>('GET', `/pm/projects/${encodeURIComponent(projectKey)}/members`)
  }
  addMember(
    projectKey: string,
    input: { username?: string; userId?: number; role?: string },
  ): Promise<void> {
    return this.req<void>('POST', `/pm/projects/${encodeURIComponent(projectKey)}/members`, input)
  }
  removeMember(projectKey: string, userId: number): Promise<void> {
    return this.req<void>(
      'DELETE',
      `/pm/projects/${encodeURIComponent(projectKey)}/members/${userId}`,
    )
  }
  getIssue(id: number): Promise<PMIssueDetail> {
    return this.req<PMIssueDetail>('GET', `/pm/issues/${id}`)
  }
  activity(id: number): Promise<PMActivityEntry[]> {
    return this.req<PMActivityEntry[]>('GET', `/pm/issues/${id}/activity`)
  }

  // ── writes ─────────────────────────────────────────────────────────────────
  createIssue(input: CreateIssueInput): Promise<{ id: number; number: number; ref: string }> {
    return this.req('POST', '/pm/issues', input)
  }
  patchIssue(id: number, fields: PatchIssueInput): Promise<void> {
    return this.req<void>('PATCH', `/pm/issues/${id}`, fields)
  }
  transition(id: number, to: string): Promise<{ id: number; status: string }> {
    return this.req('POST', `/pm/issues/${id}/transition`, { to })
  }

  // ── comments (Phase 2) ───────────────────────────────────────────────────────
  comments(issueId: number): Promise<PMComment[]> {
    return this.req<PMComment[]>('GET', `/pm/issues/${issueId}/comments`)
  }
  createComment(issueId: number, body: string): Promise<PMComment> {
    return this.req<PMComment>('POST', `/pm/issues/${issueId}/comments`, { body })
  }
  editComment(issueId: number, commentId: number, body: string): Promise<void> {
    return this.req<void>('PATCH', `/pm/issues/${issueId}/comments/${commentId}`, { body })
  }
  deleteComment(issueId: number, commentId: number): Promise<void> {
    return this.req<void>('DELETE', `/pm/issues/${issueId}/comments/${commentId}`)
  }

  // ── notifications (Phase 2; polled, unread count is server-cached) ───────────
  notifications(unreadOnly = false): Promise<PMNotification[]> {
    const q = unreadOnly ? '?unread=true' : ''
    return this.req<PMNotification[]>('GET', `/pm/notifications${q}`)
  }
  unreadCount(): Promise<{ unread: number; cached: boolean }> {
    return this.req('GET', '/pm/notifications/unread-count')
  }
  markRead(opts: { ids?: number[]; all?: boolean }): Promise<{ ok: boolean; unread?: number }> {
    return this.req('POST', '/pm/notifications/read', opts)
  }

  // ── export (Phase 2) ─────────────────────────────────────────────────────────
  // Returns the raw CSV or JSON body for the caller's visible issues (optionally
  // scoped to one project), honoring the same row-filter the list endpoint uses.
  exportIssues(format: 'csv' | 'json', opts: { project?: string } = {}): Promise<string> {
    const p = new URLSearchParams({ format })
    if (opts.project) p.set('project', opts.project)
    return this.reqRaw(`/pm/issues/export?${p.toString()}`)
  }

  // ── labels (layer-2, migration 011) ──────────────────────────────────────────
  // Project-level: list / create (manage) / delete (manage).
  private projPath(key: string): string {
    return `/pm/projects/${encodeURIComponent(key)}`
  }
  labels(projectKey: string): Promise<PMLabel[]> {
    return this.req<PMLabel[]>('GET', `${this.projPath(projectKey)}/labels`)
  }
  createLabel(projectKey: string, input: { name: string; color?: string }): Promise<PMLabel> {
    return this.req<PMLabel>('POST', `${this.projPath(projectKey)}/labels`, input)
  }
  deleteLabel(projectKey: string, labelId: number): Promise<void> {
    return this.req<void>('DELETE', `${this.projPath(projectKey)}/labels/${labelId}`)
  }
  // Per-issue: list / attach (write) / detach (write).
  issueLabels(issueId: number): Promise<PMLabel[]> {
    return this.req<PMLabel[]>('GET', `/pm/issues/${issueId}/labels`)
  }
  attachLabel(issueId: number, labelId: number): Promise<void> {
    return this.req<void>('POST', `/pm/issues/${issueId}/labels`, { labelId })
  }
  detachLabel(issueId: number, labelId: number): Promise<void> {
    return this.req<void>('DELETE', `/pm/issues/${issueId}/labels/${labelId}`)
  }

  // ── epics (layer-2) ──────────────────────────────────────────────────────────
  epics(projectKey: string): Promise<PMEpic[]> {
    return this.req<PMEpic[]>('GET', `${this.projPath(projectKey)}/epics`)
  }
  createEpic(projectKey: string, input: { name: string; description?: string }): Promise<PMEpic> {
    return this.req<PMEpic>('POST', `${this.projPath(projectKey)}/epics`, input)
  }

  // ── cycles (layer-2) ─────────────────────────────────────────────────────────
  cycles(projectKey: string): Promise<PMCycle[]> {
    return this.req<PMCycle[]>('GET', `${this.projPath(projectKey)}/cycles`)
  }
  createCycle(
    projectKey: string,
    input: { name: string; startsOn?: string | null; endsOn?: string | null },
  ): Promise<PMCycle> {
    return this.req<PMCycle>('POST', `${this.projPath(projectKey)}/cycles`, input)
  }

  // ── sub-issues (layer-2) ─────────────────────────────────────────────────────
  children(issueId: number): Promise<PMIssueSummary[]> {
    return this.req<PMIssueSummary[]>('GET', `/pm/issues/${issueId}/children`)
  }

  // ── multi-assignee + per-user status (v2, migration 012) ─────────────────────
  assignees(issueId: number): Promise<PMAssignee[]> {
    return this.req<PMAssignee[]>('GET', `/pm/issues/${issueId}/assignees`)
  }
  addAssignee(issueId: number, userId: number, status?: string): Promise<void> {
    return this.req<void>('POST', `/pm/issues/${issueId}/assignees`, { userId, status })
  }
  setAssigneeStatus(issueId: number, userId: number, status: string): Promise<void> {
    return this.req<void>('PATCH', `/pm/issues/${issueId}/assignees/${userId}`, { status })
  }
  removeAssignee(issueId: number, userId: number): Promise<void> {
    return this.req<void>('DELETE', `/pm/issues/${issueId}/assignees/${userId}`)
  }

  // ── milestones (v2) ──────────────────────────────────────────────────────────
  milestones(projectKey: string): Promise<PMMilestone[]> {
    return this.req<PMMilestone[]>('GET', `${this.projPath(projectKey)}/milestones`)
  }
  createMilestone(
    projectKey: string,
    input: { name: string; dueOn?: string | null; goal?: string | null },
  ): Promise<PMMilestone> {
    return this.req<PMMilestone>('POST', `${this.projPath(projectKey)}/milestones`, input)
  }
  updateMilestone(
    projectKey: string,
    milestoneId: number,
    input: { name?: string; dueOn?: string | null; status?: string; goal?: string | null },
  ): Promise<void> {
    return this.req<void>('PATCH', `${this.projPath(projectKey)}/milestones/${milestoneId}`, input)
  }
  deleteMilestone(projectKey: string, milestoneId: number): Promise<void> {
    return this.req<void>('DELETE', `${this.projPath(projectKey)}/milestones/${milestoneId}`)
  }

  // ── issue ↔ note links (v2) ──────────────────────────────────────────────────
  links(issueId: number): Promise<PMIssueLink[]> {
    return this.req<PMIssueLink[]>('GET', `/pm/issues/${issueId}/links`)
  }
  addLink(issueId: number, targetPath: string, kind = 'note', relation?: string): Promise<PMIssueLink> {
    return this.req<PMIssueLink>('POST', `/pm/issues/${issueId}/links`, { targetPath, kind, relation })
  }
  deleteLink(issueId: number, linkId: number): Promise<void> {
    return this.req<void>('DELETE', `/pm/issues/${issueId}/links/${linkId}`)
  }

  // ── v3: identity, assignable users, multi-department queue ───────────────────
  me(): Promise<{ username: string; role: string; department: string; isManagement: boolean }> {
    return this.req('GET', '/pm/me')
  }
  /** All active users (+ department) for the assignee picker — assignment accepts
   *  any active user, so this is broader than project members. */
  assignable(projectKey: string): Promise<{ userId: number; username: string; department: string }[]> {
    return this.req('GET', `${this.projPath(projectKey)}/assignable`)
  }
  issueDepartments(issueId: number): Promise<string[]> {
    return this.req<string[]>('GET', `/pm/issues/${issueId}/departments`)
  }
  addIssueDepartment(issueId: number, department: string): Promise<void> {
    return this.req<void>('POST', `/pm/issues/${issueId}/departments`, { department })
  }
  removeIssueDepartment(issueId: number, department: string): Promise<void> {
    return this.req<void>('DELETE', `/pm/issues/${issueId}/departments/${encodeURIComponent(department)}`)
  }

  // ── analytics (Phase 3, on-demand) ───────────────────────────────────────────
  analytics(projectKey: string): Promise<PMAnalytics> {
    return this.req<PMAnalytics>('GET', `${this.projPath(projectKey)}/analytics`)
  }
}
