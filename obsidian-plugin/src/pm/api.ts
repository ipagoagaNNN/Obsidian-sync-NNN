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
  PMBoard,
  PMComment,
  PMIssueDetail,
  PMMeta,
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
}
