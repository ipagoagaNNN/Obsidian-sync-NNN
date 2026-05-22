/**
 * NNN HF Sync — Obsidian plugin
 * v1.2.0 — Vault sync (Phase 4c) + live co-editing (Phase 4d)
 *
 * Auth flow
 * ─────────
 * 1. POST /auth/login  { username, password }
 *      → 200 { sessionToken, expiresAt, role }
 *      → 403 { requiresPasswordChange: true }
 * 2. If 403: PasswordChangeModal → POST /auth/first-login
 * 3. POST /token  { sessionToken, docId } → { clientToken, role, pathAcls }
 * 4. POST /auth/logout  on stopSync / unload
 *
 * Vault sync (Phase 4c)
 * ─────────────────────
 * The y-sweet document for docId holds a shared Y.Map<path, Y.Text> under
 * the key 'files'. This map IS the vault:
 *
 *   files["Daily/2026-05-21.md"] = Y.Text("# Today...")
 *   files["Projects/NNN.md"]     = Y.Text("# NNN Docs")
 *
 * On connect:
 *   - Pull: remote files missing locally  → create in vault
 *   - Push: local files missing in remote → add to Y.Map
 *   - Observe Y.Map for remote add/delete → mirror to vault
 *   - Observe each Y.Text for content changes → write to disk or editor
 *   - Watch vault events → push changes to Y.Map
 *
 * Live co-editing (Phase 4d)
 * ──────────────────────────
 * - editor-change event (debounced 200 ms) → flush to Y.Text
 * - Remote Y.Text change → editor.setValue() if that file is open
 * - Cursor position is preserved on remote updates (best-effort)
 *
 * Note: character-level CRDT with live cursors (y-codemirror.next) is
 * Phase 4d-advanced. Current impl gives ~200 ms latency — sufficient for
 * a doc-hub use case. True concurrent keystroke merging is a follow-up.
 */

import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  Vault,
  normalizePath,
} from 'obsidian'
import * as Y from 'yjs'
import { YSweetProvider } from '@y-sweet/client'
import type { ClientToken } from '@y-sweet/sdk'

const PLUGIN_VERSION = '1.5.0'

// Pinned source for in-app updates (must match install-windows.ps1 / install-macos.sh).
const PLUGIN_REPO_OWNER = 'ipagoagaNNN'
const PLUGIN_REPO_NAME  = 'Obsidian-sync-NNN'

// ── ACL types (mirrors server's pathACL struct in types.go) ───────────────────

/** Server-side ACL row. permission is "read" | "write" | "none" (raw DB value). */
interface PathACL {
  path: string
  permission: 'read' | 'write' | 'none'
  /**
   * Tier of this rule. Server returns rows in user → role → default order
   * and the plugin walks them as-is — first match wins. Added in v1.4.0
   * to support path-default ACLs (everyone-default policy, enabling
   * "private folder" semantics).
   */
  source?: 'user' | 'role' | 'default'
}

/** Effective per-file permission derived from pathAcls + user role. */
type Permission = 'write' | 'read-only' | 'none'

// ── Settings ──────────────────────────────────────────────────────────────────

interface NNNSyncSettings {
  /** Full URL of the HF Space */
  spaceUrl: string
  /** @deprecated Space is public; kept to avoid breaking saved data */
  hfToken: string
  username: string
  /** Temp password — cleared after first-login */
  password: string
  sessionToken: string
  sessionExpiresAt: string
  /** y-sweet logical doc ID — represents the entire shared vault */
  docId: string
  enabled: boolean
}

const DEFAULT_SETTINGS: NNNSyncSettings = {
  spaceUrl: 'https://ipagoaga-obsidian-sync.hf.space',
  hfToken: '',
  username: '',
  password: '',
  sessionToken: '',
  sessionExpiresAt: '',
  docId: '',
  enabled: false,
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

/** Only sync plain-text files; skip hidden files and binary formats */
function isSyncable(path: string): boolean {
  const base = path.split('/').pop() ?? path
  if (base.startsWith('.')) return false
  const ext = base.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'txt'
}

/** Create all ancestor directories of filePath that do not yet exist */
async function ensureParentDirs(vault: Vault, filePath: string): Promise<void> {
  const segments = normalizePath(filePath).split('/')
  segments.pop()
  for (let depth = 1; depth <= segments.length; depth++) {
    const dir = segments.slice(0, depth).join('/')
    if (!vault.getAbstractFileByPath(dir)) {
      try { await vault.createFolder(dir) } catch { /* already exists — race */ }
    }
  }
}

// ── ACL helpers ───────────────────────────────────────────────────────────────

/**
 * Glob match implementing Go's `path.Match` semantics so the plugin's
 * client-side enforcement agrees with the server's `resolveEffectivePermission`.
 *
 * Supported:
 *   *        any sequence of non-separator characters
 *   ?        single non-separator character
 *   literal  exact character match
 *
 * NOT supported (matches the server's choice):
 *   **       recursive directory wildcard
 *   [chars]  character class
 *
 * Both pattern and name are normalized to forward slashes and have any
 * leading slash stripped before matching — admins sometimes type Windows-style
 * backslashes (e.g. "TestDir2\new test 1.md") in the AclTab; the server
 * normalizes on save as well, but doing it here makes the plugin tolerant
 * of any stale rows that slipped through earlier server versions.
 */
function globMatch(pattern: string, name: string): boolean {
  const p = pattern.replace(/\\/g, '/').replace(/^\/+/, '')
  const n = name.replace(/\\/g, '/').replace(/^\/+/, '')
  const regex = '^' + p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
    .replace(/\*/g, '[^/]*')                // * → [^/]*
    .replace(/\?/g, '[^/]')                 // ? → [^/]
    + '$'
  try { return new RegExp(regex).test(n) }
  catch { return false }
}

/** Role default permission — mirrors server's roleDefault() in handlers_token.go. */
function roleDefaultPerm(role: string): Permission {
  if (role === 'viewer') return 'read-only'
  return 'write' // admin and editor default to full
}

/**
 * Compute the effective permission for a file path given the user's role
 * and the path ACLs received from the /token response.
 *
 * Server returns ACLs already sorted with user-specific entries first,
 * then role-specific entries (see fetchACLs SQL: ORDER BY user_id NOT NULL DESC).
 * First glob match wins. Falls back to the role default when nothing matches.
 *
 * Permission string mapping: DB "write" → "write", "read" → "read-only",
 * "none" → "none".
 */
function effectivePermission(role: string, acls: PathACL[], path: string): Permission {
  for (const acl of acls) {
    if (globMatch(acl.path, path)) {
      if (acl.permission === 'write') return 'write'
      if (acl.permission === 'read')  return 'read-only'
      if (acl.permission === 'none')  return 'none'
    }
  }
  return roleDefaultPerm(role)
}

// ── In-app updater helpers (mirrors install-windows.ps1 / install-macos.sh) ───

/** Compare two dot-separated versions. Returns -1, 0, or 1. Treats "1.3.0" < "1.3.1" < "1.4". */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return  1
  }
  return 0
}

/** SHA256 hash of a string (UTF-8 encoded), returned as lowercase hex. */
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

interface ReleaseAsset { name: string; browser_download_url: string }
interface ReleaseMeta  { tag_name: string; assets: ReleaseAsset[] }

/** Fetch the latest release metadata from the pinned GitHub repo. */
async function fetchLatestRelease(): Promise<ReleaseMeta> {
  const url = `https://api.github.com/repos/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/releases/latest`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NNN-Sync-Plugin', 'Accept': 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return await res.json() as ReleaseMeta
}

// ── Password-change modal ─────────────────────────────────────────────────────

class PasswordChangeModal extends Modal {
  private username: string
  private tempPassword: string
  private spaceUrl: string
  private resolve!: (result: { sessionToken: string; expiresAt: string }) => void
  private reject!: (reason: Error) => void

  constructor(app: App, username: string, tempPassword: string, spaceUrl: string) {
    super(app)
    this.username = username
    this.tempPassword = tempPassword
    this.spaceUrl = spaceUrl
  }

  waitForResult(): Promise<{ sessionToken: string; expiresAt: string }> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.open()
    })
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: '🔐 Set your password' })
    contentEl.createEl('p', {
      text: 'Your account was created with a temporary password. Please set a new permanent password to continue.',
      cls: 'nnn-modal-desc',
    })

    let newPassword = ''
    let confirmPassword = ''
    const errorEl = contentEl.createEl('p', { cls: 'nnn-modal-error' })
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    new Setting(contentEl)
      .setName('New password')
      .setDesc('Minimum 10 characters.')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'new-password'
        text.onChange(v => { newPassword = v })
      })

    new Setting(contentEl)
      .setName('Confirm password')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'new-password'
        text.onChange(v => { confirmPassword = v })
      })

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Set password & connect')
        .setCta()
        .onClick(async () => {
          errorEl.setText('')
          if (newPassword.length < 10) {
            errorEl.setText('Password must be at least 10 characters.')
            return
          }
          if (newPassword !== confirmPassword) {
            errorEl.setText('Passwords do not match.')
            return
          }
          if (newPassword === this.tempPassword) {
            errorEl.setText('New password must differ from your temporary password.')
            return
          }
          btn.setDisabled(true).setButtonText('Setting password…')
          try {
            const url = this.spaceUrl.replace(/\/$/, '') + '/auth/first-login'
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
              body: JSON.stringify({
                username: this.username,
                tempPassword: this.tempPassword,
                newPassword,
              }),
            })
            if (!res.ok) {
              const text = await res.text().catch(() => res.statusText)
              throw new Error(`Server error (${res.status}): ${text}`)
            }
            const body = await res.json()
            this.close()
            this.resolve({ sessionToken: body.sessionToken, expiresAt: body.expiresAt })
          } catch (e) {
            errorEl.setText((e as Error).message)
            btn.setDisabled(false).setButtonText('Set password & connect')
          }
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close()
          this.reject(new Error('Password change cancelled by user.'))
        }))
  }

  onClose() {
    this.contentEl.empty()
  }
}

// ── Re-auth modal — Phase 6a (no stored password) ────────────────────────────
//
// Shown whenever the plugin needs to log in but the password isn't already
// in memory. This is the ONLY place a password is collected from the user
// outside of the temp-password first-login flow. The password is consumed
// in a single /auth/login call and never persisted to disk.
//
// Triggers:
//   - First time the user clicks Connect (no session yet)
//   - Session token expires/invalidated and the plugin needs to reconnect
//   - Username changed in settings; previous session no longer applies

class ReauthModal extends Modal {
  private username: string
  private spaceUrl: string
  private resolve!: (result: { sessionToken: string; expiresAt: string; password: string }) => void
  private reject!: (reason: Error) => void

  constructor(app: App, username: string, spaceUrl: string) {
    super(app)
    this.username = username
    this.spaceUrl = spaceUrl
  }

  waitForResult(): Promise<{ sessionToken: string; expiresAt: string; password: string }> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.open()
    })
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: '🔐 Log in' })
    contentEl.createEl('p', {
      text: `Logging in as ${this.username}. Your password is only used to obtain a session token — it is never stored on disk by this plugin.`,
      cls: 'nnn-modal-desc',
    })

    let password = ''
    const errorEl = contentEl.createEl('p', { cls: 'nnn-modal-error' })
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    new Setting(contentEl)
      .setName('Password')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'current-password'
        text.inputEl.focus()
        text.onChange(v => { password = v })
        // Enter submits
        text.inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitBtn.buttonEl.click()
          }
        })
      })

    const actions = new Setting(contentEl)
    const submitBtn = actions
      .addButton(btn => btn
        .setButtonText('Log in')
        .setCta()
        .onClick(async () => {
          errorEl.setText('')
          if (!password) {
            errorEl.setText('Enter your password.')
            return
          }
          btn.setDisabled(true).setButtonText('Logging in…')
          try {
            const url = this.spaceUrl.replace(/\/$/, '') + '/auth/login'
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
              body: JSON.stringify({ username: this.username, password }),
            })
            if (res.status === 403) {
              const body = await res.json().catch(() => ({}))
              if (body.requiresPasswordChange) {
                // Hand off to the password-change modal (chained flow).
                this.close()
                const changeModal = new PasswordChangeModal(this.app, this.username, password, this.spaceUrl)
                const result = await changeModal.waitForResult()
                this.resolve({ ...result, password: '' })
                return
              }
            }
            if (!res.ok) {
              const text = await res.text().catch(() => res.statusText)
              throw new Error(`Login failed (${res.status}): ${text}`)
            }
            const body = await res.json()
            this.close()
            this.resolve({
              sessionToken: body.sessionToken,
              expiresAt:    body.expiresAt,
              password:     '', // we deliberately drop the password here
            })
          } catch (e) {
            errorEl.setText((e as Error).message)
            btn.setDisabled(false).setButtonText('Log in')
          }
        }))

    actions.addButton(btn => btn
      .setButtonText('Cancel')
      .onClick(() => {
        this.close()
        this.reject(new Error('Login cancelled by user.'))
      }))
  }

  onClose() {
    this.contentEl.empty()
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function isSessionValid(settings: NNNSyncSettings): boolean {
  if (!settings.sessionToken || !settings.sessionExpiresAt) return false
  const expiresAt = new Date(settings.sessionExpiresAt).getTime()
  return expiresAt - Date.now() > 5 * 60 * 1000
}

class LoginRequiresPasswordChange extends Error {
  constructor() { super('requiresPasswordChange') }
}

async function login(settings: NNNSyncSettings): Promise<{ sessionToken: string; expiresAt: string }> {
  const url = settings.spaceUrl.replace(/\/$/, '') + '/auth/login'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
    body: JSON.stringify({ username: settings.username, password: settings.password }),
  })
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    if (body.requiresPasswordChange) throw new LoginRequiresPasswordChange()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Login failed (${res.status}): ${text}`)
  }
  const body = await res.json()
  return { sessionToken: body.sessionToken, expiresAt: body.expiresAt }
}

function logout(settings: NNNSyncSettings): void {
  if (!settings.sessionToken) return
  const url = settings.spaceUrl.replace(/\/$/, '') + '/auth/logout'
  fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.sessionToken}`, 'X-Plugin-Version': PLUGIN_VERSION },
  }).catch(() => { /* best-effort */ })
}

/**
 * /token result shape — includes ACL metadata the plugin needs for path
 * enforcement, not just the y-sweet client token.
 */
interface TokenResult {
  clientToken: ClientToken
  role: string                // "admin" | "editor" | "viewer" | ""
  pathAcls: PathACL[]
}

async function fetchClientToken(
  app: App,
  settings: NNNSyncSettings,
  onSessionRefresh: (token: string, expiresAt: string) => Promise<void>,
): Promise<TokenResult> {

  const ensureSession = async () => {
    if (isSessionValid(settings)) return

    // Phase 6a: never authenticate from settings.password. If there's a
    // stale password on disk from a pre-v1.5.0 install, drop it before
    // doing anything else.
    if (settings.password) {
      settings.password = ''
      await onSessionRefresh(settings.sessionToken, settings.sessionExpiresAt)
    }

    // No valid session and no in-memory password → ask the user.
    const modal = new ReauthModal(app, settings.username, settings.spaceUrl)
    const { sessionToken, expiresAt } = await modal.waitForResult()
    settings.sessionToken = sessionToken
    settings.sessionExpiresAt = expiresAt
    settings.password = '' // belt-and-suspenders: ReauthModal already drops it
    await onSessionRefresh(sessionToken, expiresAt)
  }

  await ensureSession()

  const tokenUrl = settings.spaceUrl.replace(/\/$/, '') + '/token'
  const attempt = () => fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
    body: JSON.stringify({ sessionToken: settings.sessionToken, docId: settings.docId }),
  })

  let res = await attempt()

  if (res.status === 401) {
    settings.sessionToken = ''
    settings.sessionExpiresAt = ''
    await ensureSession()
    res = await attempt()
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Token fetch failed (${res.status}): ${text}`)
  }

  const body = await res.json()
  // Server returns { clientToken, role, pathAcls } since v1.3.0. If we hit an
  // older server it may still return just the raw clientToken — handle both.
  if (body && typeof body === 'object' && 'clientToken' in body) {
    return {
      clientToken: body.clientToken as ClientToken,
      role:        typeof body.role === 'string' ? body.role : '',
      pathAcls:    Array.isArray(body.pathAcls) ? body.pathAcls as PathACL[] : [],
    }
  }
  return { clientToken: body as ClientToken, role: '', pathAcls: [] }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class NNNSyncPlugin extends Plugin {
  settings!: NNNSyncSettings

  private ydoc: Y.Doc | null = null
  private provider: YSweetProvider | null = null
  private statusBarItem: HTMLElement | null = null

  // Vault sync state
  private filesMap: Y.Map<Y.Text> | null = null
  private vaultSyncReady = false
  // Counter > 0 means we are writing to vault from a remote change; vault
  // event handlers check this to avoid echoing the write back to the Y.Map.
  private remoteWriteCount = 0
  private syncEventCleanups: Array<() => void> = []
  private editorDebounce: ReturnType<typeof setTimeout> | null = null

  // ACL state (populated from /token response, refreshed on every fetch)
  private pathAcls: PathACL[] = []
  private userRole = ''

  // Manifest reporting (debounced /vault/manifest POSTs)
  private manifestDebounce: ReturnType<typeof setTimeout> | null = null
  private lastManifestSig = ''

  // ACL refresh (3-min polling via GET /vault/acls — lets ACL changes
  // propagate to live clients without reconnect)
  private aclRefreshInterval: ReturnType<typeof setInterval> | null = null
  private reconcileInProgress = false

  // In-app updater state (driven from the settings tab)
  latestVersion: string | null = null      // null = not checked, '' = check failed
  updateChecking = false
  updating = false
  // Callback invoked whenever the above three change, so SettingTab can rerender.
  onUpdateStateChange: (() => void) | null = null

  async onload() {
    await this.loadSettings()
    this.addSettingTab(new NNNSyncSettingTab(this.app, this))

    this.statusBarItem = this.addStatusBarItem()
    this.updateStatusBar('idle')

    this.addCommand({
      id: 'nnn-sync-connect',
      name: 'Connect sync',
      callback: () => this.startSync(),
    })

    this.addCommand({
      id: 'nnn-sync-disconnect',
      name: 'Disconnect sync',
      callback: () => this.stopSync(),
    })

    if (this.settings.enabled && this.settings.username && this.settings.docId) {
      setTimeout(() => this.startSync(), 3000)
    }
  }

  onunload() {
    logout(this.settings)
    this.stopSync()
  }

  async startSync() {
    if (this.provider) {
      new Notice('NNN Sync: already connected.')
      return
    }

    const s = this.settings
    if (!s.username || !s.docId) {
      new Notice('NNN Sync: configure username and document ID before connecting.')
      return
    }
    // Phase 6a: no stored-password short-circuit any more. If the session
    // is invalid the ReauthModal opens inside ensureSession() and prompts
    // the user interactively. That's the only place a password is collected.

    this.updateStatusBar('connecting')
    new Notice('NNN Sync: connecting…')

    try {
      this.ydoc = new Y.Doc()

      const onSessionRefresh = async (token: string, expiresAt: string) => {
        this.settings.sessionToken = token
        this.settings.sessionExpiresAt = expiresAt
        await this.saveSettings()
      }

      const app = this.app
      // YSweetProvider expects a () => Promise<ClientToken>. We wrap fetchClientToken
      // so the plugin captures role + pathAcls each time the token is refreshed
      // (initial connect AND every WebSocket reconnect — keeps ACLs current).
      const tokenSource = async (): Promise<ClientToken> => {
        const result = await fetchClientToken(app, s, onSessionRefresh)
        this.userRole = result.role
        this.pathAcls = result.pathAcls
        return result.clientToken
      }
      this.provider = new YSweetProvider(
        tokenSource,
        s.docId,
        this.ydoc,
        { connect: true },
      )

      this.provider.on('connection-status', async (status: string) => {
        this.updateStatusBar(status)
        if (status === 'connected') {
          if (!this.vaultSyncReady) await this.initVaultSync()
        } else if (status === 'error') {
          new Notice('NNN Sync: connection error — retrying…')
        }
      })

      this.settings.enabled = true
      await this.saveSettings()

    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'Password change cancelled by user.') {
        new Notice('NNN Sync: cancelled — password change required to connect.')
      } else {
        new Notice(`NNN Sync: failed to connect — ${msg}`)
      }
      this.updateStatusBar('error')
      this.ydoc = null
      this.provider = null
    }
  }

  // ── ACL helpers (per-path enforcement against pathAcls from /token) ─────

  /** Effective permission for a vault-relative file path. */
  private permissionFor(path: string): Permission {
    return effectivePermission(this.userRole, this.pathAcls, path)
  }

  // ── Manifest reporting (POST /vault/manifest, debounced) ────────────────

  /**
   * Schedule a delayed POST /vault/manifest with the current Y.Map keys.
   * Called from observers + initVaultSync; coalesces bursts of changes into
   * a single network round-trip.
   */
  private scheduleManifestSend(delayMs = 5000) {
    if (this.manifestDebounce) clearTimeout(this.manifestDebounce)
    this.manifestDebounce = setTimeout(() => { void this.sendManifest() }, delayMs)
  }

  /**
   * Send the current file list to the server. Skipped if the list is
   * unchanged since the last successful send (signature-based dedup).
   * Best-effort: failures are logged but don't break sync.
   */
  private async sendManifest() {
    if (!this.filesMap || !this.settings.sessionToken) return
    const paths = Array.from(this.filesMap.keys()).filter(isSyncable).sort()
    const sig = paths.join('\n')
    if (sig === this.lastManifestSig) return
    try {
      const url = this.settings.spaceUrl.replace(/\/$/, '') + '/vault/manifest'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
        body: JSON.stringify({
          sessionToken: this.settings.sessionToken,
          docId:        this.settings.docId,
          paths,
        }),
      })
      if (res.ok) {
        this.lastManifestSig = sig
      } else if (res.status === 401) {
        // Session likely expired between connect and now — let the next
        // YSweetProvider reconnect refresh the token; we just skip this send.
      }
    } catch { /* network blip — try again on next observer tick */ }
  }

  // ── ACL refresh + reconciliation (v1.4.0) ──────────────────────────────────

  /**
   * Re-fetch the caller's current pathAcls + role from the server without
   * going through /token (cheaper — no y-sweet roundtrip). Called every
   * 3 minutes by aclRefreshInterval. If the ACL set actually changed,
   * runs reconcileLocalVault to delete-on-deny any newly-restricted files.
   */
  private async refreshACLs() {
    if (!this.settings.sessionToken) return
    try {
      const url = this.settings.spaceUrl.replace(/\/$/, '') + '/vault/acls'
      const res = await fetch(url, {
        headers: {
          'Authorization':    `Bearer ${this.settings.sessionToken}`,
          'X-Plugin-Version': PLUGIN_VERSION,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      const newAcls: PathACL[] = Array.isArray(data?.pathAcls) ? data.pathAcls : []
      const newRole = typeof data?.role === 'string' ? data.role : ''

      const sig = (a: PathACL[]) =>
        a.map(x => `${x.source ?? ''}:${x.path}:${x.permission}`).sort().join('|')
      const changed = sig(newAcls) !== sig(this.pathAcls) || newRole !== this.userRole

      this.pathAcls = newAcls
      this.userRole = newRole

      if (changed) {
        await this.reconcileLocalVault()
      }
    } catch { /* network blip — next 3-min tick will retry */ }
  }

  /**
   * Walk Y.Map keys: for each tracked file where the current effective
   * permission is 'none', delete the local copy. Does NOT touch the
   * Y.Map — other users who DO have access keep the file.
   *
   * Destructive by design: the user has just lost access, so removing the
   * local mirror is the desired "private folder is invisible" semantic.
   * Writes are already blocked elsewhere so no local edits can be lost
   * to this operation.
   *
   * Re-entrancy guard: this.reconcileInProgress prevents overlapping runs.
   */
  private async reconcileLocalVault() {
    if (!this.filesMap || this.reconcileInProgress) return
    this.reconcileInProgress = true
    let removed = 0
    try {
      for (const [rawPath] of this.filesMap.entries()) {
        const path = normalizePath(rawPath)
        if (!isSyncable(path)) continue
        if (this.permissionFor(path) !== 'none') continue
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) {
          this.remoteWriteCount++
          try {
            await this.app.vault.trash(file, true)
            removed++
          } catch {
            // best-effort — file might have been moved or deleted concurrently
          } finally {
            this.remoteWriteCount--
          }
        }
      }
      if (removed > 0) {
        new Notice(`NNN Sync: ${removed} file(s) hidden — access removed by admin`)
      }
    } finally {
      this.reconcileInProgress = false
    }
  }

  // ── In-app updater ─────────────────────────────────────────────────────────

  /**
   * Query GitHub for the latest release version. Updates `latestVersion`
   * and notifies the settings tab to rerender. Safe to call repeatedly —
   * if already checking, the call is a no-op.
   */
  async checkForUpdate() {
    if (this.updateChecking) return
    this.updateChecking = true
    this.onUpdateStateChange?.()
    try {
      const release = await fetchLatestRelease()
      this.latestVersion = release.tag_name.replace(/^v/, '')
    } catch {
      this.latestVersion = '' // sentinel: check failed
    } finally {
      this.updateChecking = false
      this.onUpdateStateChange?.()
    }
  }

  /** True if a newer version is available. */
  isUpdateAvailable(): boolean {
    return !!this.latestVersion && compareVersions(this.latestVersion, PLUGIN_VERSION) > 0
  }

  /**
   * Download the latest release artifacts, verify SHA256, write to the
   * plugin folder via the vault adapter, then resolve. Caller is responsible
   * for showing the "reload Obsidian" prompt afterwards.
   *
   * Mirrors install-windows.ps1 / install-macos.sh Layer 1 defenses:
   * version-floor (won't downgrade) + SHA256 verify before writing.
   */
  async performUpdate(): Promise<{ version: string }> {
    if (this.updating) throw new Error('Update already in progress')
    this.updating = true
    this.onUpdateStateChange?.()
    try {
      const release = await fetchLatestRelease()
      const newVer = release.tag_name.replace(/^v/, '')
      if (compareVersions(newVer, PLUGIN_VERSION) <= 0) {
        throw new Error(`Refusing to "update" to v${newVer} — current is v${PLUGIN_VERSION}`)
      }

      const grab = async (name: string) => {
        const asset = release.assets.find(a => a.name === name)
        if (!asset) throw new Error(`Release v${newVer} is missing asset '${name}'`)
        const res = await fetch(asset.browser_download_url, {
          headers: { 'User-Agent': 'NNN-Sync-Plugin' },
        })
        if (!res.ok) throw new Error(`Download ${name} failed: ${res.status}`)
        return await res.text()
      }

      const [mainJs, manifestJson, sha256Sums] = await Promise.all([
        grab('main.js'),
        grab('manifest.json'),
        grab('SHA256SUMS'),
      ])

      // Parse SHA256SUMS — "<hex>  <filename>" per line.
      const expected: Record<string, string> = {}
      for (const line of sha256Sums.split(/\r?\n/)) {
        const m = line.trim().match(/^([0-9a-fA-F]{64})\s+(.+)$/)
        if (m) expected[m[2]] = m[1].toLowerCase()
      }

      for (const [name, content] of [['main.js', mainJs], ['manifest.json', manifestJson]]) {
        const want = expected[name]
        if (!want) throw new Error(`SHA256SUMS missing entry for ${name}`)
        const got = await sha256Hex(content)
        if (got !== want) {
          throw new Error(`SHA256 mismatch for ${name} — refusing to install`)
        }
      }

      // Cross-check: manifest.json's version must equal the release tag.
      const newManifest = JSON.parse(manifestJson)
      if (newManifest.version !== newVer) {
        throw new Error(`manifest.json version ${newManifest.version} != tag ${newVer}`)
      }

      // Write into the plugin folder. vault.adapter paths are vault-relative;
      // .obsidian/plugins/<id>/ is reachable.
      const dir = `${this.app.vault.configDir}/plugins/nnn-hf-sync`
      await this.app.vault.adapter.write(`${dir}/main.js`,       mainJs)
      await this.app.vault.adapter.write(`${dir}/manifest.json`, manifestJson)

      this.latestVersion = newVer
      return { version: newVer }
    } finally {
      this.updating = false
      this.onUpdateStateChange?.()
    }
  }

  stopSync() {
    logout(this.settings)

    // Tear down vault sync
    for (const cleanup of this.syncEventCleanups) {
      try { cleanup() } catch { /* ignore */ }
    }
    this.syncEventCleanups = []
    this.filesMap = null
    this.vaultSyncReady = false
    this.remoteWriteCount = 0
    this.pathAcls = []
    this.userRole = ''
    this.lastManifestSig = ''
    if (this.editorDebounce) {
      clearTimeout(this.editorDebounce)
      this.editorDebounce = null
    }
    if (this.manifestDebounce) {
      clearTimeout(this.manifestDebounce)
      this.manifestDebounce = null
    }
    if (this.aclRefreshInterval) {
      clearInterval(this.aclRefreshInterval)
      this.aclRefreshInterval = null
    }
    this.reconcileInProgress = false

    if (this.provider) {
      this.provider.disconnect()
      this.provider.destroy()
      this.provider = null
    }
    if (this.ydoc) {
      this.ydoc.destroy()
      this.ydoc = null
    }

    this.settings.sessionToken = ''
    this.settings.sessionExpiresAt = ''
    this.settings.enabled = false
    this.saveSettings()
    this.updateStatusBar('idle')
  }

  // ── Vault sync initialisation ─────────────────────────────────────────────

  private async initVaultSync() {
    if (this.vaultSyncReady || !this.ydoc) return
    this.vaultSyncReady = true

    this.filesMap = this.ydoc.getMap<Y.Text>('files')

    // Step 1 — Pull: create local files that exist remotely but not locally.
    //          Skip any path the user has 'none' permission on — those files
    //          must never materialize in the local vault for this user.
    for (const [rawPath, ytext] of this.filesMap.entries()) {
      const path = normalizePath(rawPath)
      if (!isSyncable(path)) continue
      if (this.permissionFor(path) === 'none') continue
      if (!this.app.vault.getAbstractFileByPath(path)) {
        await ensureParentDirs(this.app.vault, path)
        this.remoteWriteCount++
        try { await this.app.vault.create(path, ytext.toString()) }
        finally { this.remoteWriteCount-- }
      }
      this.attachYTextObserver(path, ytext)
    }

    // Step 2 — Push: add local files that are not yet in the remote map.
    //          Skip files the user does not have 'write' permission on —
    //          a viewer or read-only-path user can't seed new files.
    for (const file of this.app.vault.getFiles()) {
      if (!isSyncable(file.path)) continue
      const path = normalizePath(file.path)
      if (this.filesMap.has(path)) continue
      if (this.permissionFor(path) !== 'write') continue
      const content = await this.app.vault.read(file)
      this.ydoc!.transact(() => {
        if (this.filesMap!.has(path)) return // remote added it between read and transact
        const ytext = new Y.Text()
        this.filesMap!.set(path, ytext)
        ytext.insert(0, content)
      }, 'vault-local')
      const ytext = this.filesMap.get(path)
      if (ytext) this.attachYTextObserver(path, ytext)
    }

    // Step 3 — Watch Y.Map for remote file-level events (add / delete).
    //          Both local-originated and remote-originated map changes
    //          schedule a manifest re-send so the server's vault_paths
    //          stays current with what the plugin sees.
    const mapObserver = (event: Y.YMapEvent<Y.Text>, txn: Y.Transaction) => {
      this.scheduleManifestSend()
      if (txn.origin === 'vault-local') return
      void this.onRemoteMapChange(event)
    }
    this.filesMap.observe(mapObserver)
    this.syncEventCleanups.push(() => this.filesMap?.unobserve(mapObserver))

    // Step 4 — Watch local vault events
    const refCreate = this.app.vault.on('create', (f) => void this.onLocalCreate(f))
    const refModify = this.app.vault.on('modify', (f) => void this.onLocalModify(f as TFile))
    const refDelete = this.app.vault.on('delete', (f) => this.onLocalDelete(f))
    const refRename = this.app.vault.on('rename', (f, old) => void this.onLocalRename(f, old))
    this.syncEventCleanups.push(
      () => this.app.vault.offref(refCreate),
      () => this.app.vault.offref(refModify),
      () => this.app.vault.offref(refDelete),
      () => this.app.vault.offref(refRename),
    )

    // Step 5 — Phase 4d: live editor → Y.Text (debounced keystrokes)
    const refEditor = this.app.workspace.on('editor-change', (editor, view) => {
      if (view instanceof MarkdownView) this.onEditorChange(editor, view)
    })
    this.syncEventCleanups.push(() => this.app.workspace.offref(refEditor))

    new Notice('NNN Sync: vault sync active ✓')

    // Initial manifest report — send the current vault file list to the
    // server so /admin/docs/tree + /admin/acls/preview can show the real
    // folder/file structure (rather than just the docId). Short delay so
    // any push-on-connect from Step 2 lands in the map first.
    this.scheduleManifestSend(1500)

    // Step 6 — ACL reconciliation. The pull loop (step 1) skipped any
    // remote files where permission is 'none'. But files that the user
    // had access to PREVIOUSLY and were already on disk before an admin
    // restricted them won't have been touched by step 1. Walk Y.Map and
    // delete any local file the user no longer has read access to.
    await this.reconcileLocalVault()

    // Step 7 — Periodic ACL refresh (every 3 min). Server-side ACL
    // changes will reach this client within 3 minutes without requiring
    // a reconnect; on change, reconcileLocalVault runs again.
    if (this.aclRefreshInterval) clearInterval(this.aclRefreshInterval)
    this.aclRefreshInterval = setInterval(
      () => { void this.refreshACLs() },
      3 * 60 * 1000,
    )
  }

  // ── Y.Text observer — remote content → local vault / editor ──────────────

  private attachYTextObserver(path: string, ytext: Y.Text) {
    ytext.observe((_event: Y.YTextEvent, txn: Y.Transaction) => {
      if (txn.origin === 'vault-local') return
      void this.applyRemoteContent(path, ytext.toString())
    })
  }

  private async applyRemoteContent(path: string, content: string) {
    const vault = this.app.vault

    // ACL gate: if the user has no read access to this path, don't surface
    // remote content. The file should not exist locally for this user; if it
    // does (stale from a previous role), leave it alone — deleting is the
    // server's prerogative, not ours.
    if (this.permissionFor(path) === 'none') return

    // If this file is currently open in the editor, update the editor directly.
    // Obsidian auto-saves the editor to disk, so we don't also write the file.
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (mdView?.file?.path === path) {
      const editor = mdView.editor
      if (editor.getValue() !== content) {
        const cursor = editor.getCursor()
        this.remoteWriteCount++
        editor.setValue(content)
        this.remoteWriteCount--
        try { editor.setCursor(cursor) } catch { /* cursor may be beyond new content */ }
      }
      return
    }

    // File is not open — write straight to disk
    this.remoteWriteCount++
    try {
      const existing = vault.getAbstractFileByPath(path)
      if (!existing) {
        await ensureParentDirs(vault, path)
        await vault.create(path, content)
      } else if (existing instanceof TFile) {
        await vault.modify(existing, content)
      }
    } finally {
      this.remoteWriteCount--
    }
  }

  // ── Remote Y.Map changes — file created / deleted by another user ─────────

  private async onRemoteMapChange(event: Y.YMapEvent<Y.Text>) {
    for (const [rawPath, change] of event.changes.keys) {
      const path = normalizePath(rawPath)
      if (!isSyncable(path)) continue

      if (change.action === 'delete') {
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) {
          this.remoteWriteCount++
          try { await this.app.vault.trash(file, true) }
          finally { this.remoteWriteCount-- }
        }
      } else if (change.action === 'add') {
        const ytext = this.filesMap!.get(rawPath)
        if (!ytext) continue
        // ACL gate: hide files the user has no permission to see. Attach the
        // observer either way so we react if permission later changes from a
        // role grant — but suppress the local file creation for 'none'.
        if (this.permissionFor(path) === 'none') continue
        this.attachYTextObserver(path, ytext)
        if (!this.app.vault.getAbstractFileByPath(path)) {
          await ensureParentDirs(this.app.vault, path)
          this.remoteWriteCount++
          try { await this.app.vault.create(path, ytext.toString()) }
          finally { this.remoteWriteCount-- }
        }
      }
    }
  }

  // ── Local vault events → Y.Map ────────────────────────────────────────────

  private async onLocalCreate(file: TAbstractFile) {
    if (!this.filesMap || this.remoteWriteCount > 0) return
    if (!(file instanceof TFile) || !isSyncable(file.path)) return
    const path = normalizePath(file.path)
    if (this.filesMap.has(path)) return
    if (this.permissionFor(path) !== 'write') {
      new Notice(`NNN Sync: not allowed to create files at ${path} — read-only`)
      return
    }
    const content = await this.app.vault.read(file)
    this.ydoc!.transact(() => {
      if (this.filesMap!.has(path)) return
      const ytext = new Y.Text()
      this.filesMap!.set(path, ytext)
      ytext.insert(0, content)
    }, 'vault-local')
    const ytext = this.filesMap.get(path)
    if (ytext) this.attachYTextObserver(path, ytext)
  }

  private async onLocalModify(file: TFile) {
    if (!this.filesMap || this.remoteWriteCount > 0) return
    if (!isSyncable(file.path)) return
    const path = normalizePath(file.path)
    if (this.permissionFor(path) !== 'write') return // silent — modify fires per keystroke
    const content = await this.app.vault.read(file)
    const ytext = this.filesMap.get(path)
    if (ytext) {
      if (ytext.toString() === content) return
      this.ydoc!.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, content)
      }, 'vault-local')
    } else {
      // File on disk but not yet in map — add it
      this.ydoc!.transact(() => {
        const newYText = new Y.Text()
        this.filesMap!.set(path, newYText)
        newYText.insert(0, content)
      }, 'vault-local')
      const newYText = this.filesMap.get(path)
      if (newYText) this.attachYTextObserver(path, newYText)
    }
  }

  private onLocalDelete(file: TAbstractFile) {
    if (!this.filesMap || this.remoteWriteCount > 0) return
    if (!(file instanceof TFile) || !isSyncable(file.path)) return
    const path = normalizePath(file.path)
    if (this.permissionFor(path) !== 'write') {
      new Notice(`NNN Sync: not allowed to delete ${path} — read-only`)
      return
    }
    this.ydoc!.transact(() => { this.filesMap!.delete(path) }, 'vault-local')
  }

  private async onLocalRename(file: TAbstractFile, oldPath: string) {
    if (!this.filesMap || this.remoteWriteCount > 0) return
    if (!(file instanceof TFile)) return
    const newPath = normalizePath(file.path)
    const oldNorm = normalizePath(oldPath)
    // Rename requires write on BOTH old and new paths — moving a file from a
    // read-only area into a writable area (or vice versa) would let a user
    // bypass the ACL at the file content level. Refuse if either side denies.
    if (this.permissionFor(oldNorm) !== 'write' ||
        (isSyncable(newPath) && this.permissionFor(newPath) !== 'write')) {
      new Notice(`NNN Sync: rename ${oldNorm} → ${newPath} not allowed — read-only path`)
      return
    }
    const content = isSyncable(newPath) ? await this.app.vault.read(file) : ''
    this.ydoc!.transact(() => {
      if (this.filesMap!.has(oldNorm)) this.filesMap!.delete(oldNorm)
      if (isSyncable(newPath)) {
        const ytext = new Y.Text()
        this.filesMap!.set(newPath, ytext)
        ytext.insert(0, content)
      }
    }, 'vault-local')
    if (isSyncable(newPath)) {
      const ytext = this.filesMap.get(newPath)
      if (ytext) this.attachYTextObserver(newPath, ytext)
    }
  }

  // ── Phase 4d: active editor → Y.Text (debounced) ─────────────────────────

  private onEditorChange(editor: Editor, view: MarkdownView) {
    if (!this.filesMap || this.remoteWriteCount > 0 || !view.file) return
    if (!isSyncable(view.file.path)) return
    const path = normalizePath(view.file.path)
    if (this.editorDebounce) clearTimeout(this.editorDebounce)
    this.editorDebounce = setTimeout(() => {
      this.flushEditorToYText(editor, path)
    }, 200)
  }

  private flushEditorToYText(editor: Editor, path: string) {
    if (!this.filesMap || !this.ydoc) return
    if (this.permissionFor(path) !== 'write') return // silent — editor-change fires per keystroke
    const content = editor.getValue()
    const ytext = this.filesMap.get(path)
    if (!ytext) return
    if (ytext.toString() === content) return
    this.ydoc.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, content)
    }, 'vault-local')
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  private updateStatusBar(status: string) {
    if (!this.statusBarItem) return
    const icons: Record<string, string> = {
      idle: '⬜ NNN Sync',
      connecting: '🟡 NNN Sync',
      handshaking: '🟡 NNN Sync',
      connected: '🟢 NNN Sync',
      error: '🔴 NNN Sync',
    }
    this.statusBarItem.setText(icons[status] ?? `⬜ NNN Sync (${status})`)
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    // Phase 6a migration: drop any password persisted by older plugin
    // versions on the way in. From v1.5.0+ the password lives only in
    // memory inside a single login() call and is dropped immediately.
    if (this.settings.password) {
      this.settings.password = ''
      await this.saveSettings()
    }
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}

// ── Settings tab ──────────────────────────────────────────────────────────────

class NNNSyncSettingTab extends PluginSettingTab {
  plugin: NNNSyncPlugin

  constructor(app: App, plugin: NNNSyncPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: 'NNN HF Sync' })

    new Setting(containerEl)
      .setName('Space URL')
      .setDesc('Base URL of the HF Space (no trailing slash).')
      .addText(text => text
        .setPlaceholder('https://ipagoaga-obsidian-sync.hf.space')
        .setValue(this.plugin.settings.spaceUrl)
        .onChange(async (v) => {
          this.plugin.settings.spaceUrl = v.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Username')
      .setDesc('Your username on the sync server.')
      .addText(text => text
        .setPlaceholder('alice')
        .setValue(this.plugin.settings.username)
        .onChange(async (v) => {
          this.plugin.settings.username = v.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Authentication')
      .setDesc(
        isSessionValid(this.plugin.settings)
          ? '✅ Session active — no login needed until session expires.'
          : 'Click Connect (below) to log in. Your password is never stored on disk — it is used once to obtain a session token.'
      )
      // No password field: Phase 6a removed plaintext storage. Login happens
      // through the ReauthModal that pops up when you click Connect.
      .addButton(btn => btn
        .setButtonText(isSessionValid(this.plugin.settings) ? 'Re-authenticate' : 'Log in')
        .onClick(async () => {
          // Invalidate the current session and force a fresh login modal.
          this.plugin.settings.sessionToken = ''
          this.plugin.settings.sessionExpiresAt = ''
          this.plugin.settings.password = ''
          await this.plugin.saveSettings()
          await this.plugin.startSync()
          this.display() // re-render to update the button label
        }))

    new Setting(containerEl)
      .setName('Document ID')
      .setDesc('Vault ID for this shared workspace (e.g. "nnn/main"). All users connecting to the same ID share one vault.')
      .addText(text => text
        .setPlaceholder('nnn/main')
        .setValue(this.plugin.settings.docId)
        .onChange(async (v) => {
          this.plugin.settings.docId = v.trim()
          await this.plugin.saveSettings()
        }))

    const sessionDesc = isSessionValid(this.plugin.settings)
      ? `✅ Session active — expires ${new Date(this.plugin.settings.sessionExpiresAt).toLocaleString()}`
      : '⚠️ No active session — will authenticate on connect.'
    containerEl.createEl('p', { text: sessionDesc, cls: 'setting-item-description' })

    // Plugin version + in-app updater (rerenders whenever update state changes)
    this.renderVersionSection(containerEl)

    containerEl.createEl('h3', { text: 'Connection' })

    new Setting(containerEl)
      .setName('Connect / Disconnect')
      .setDesc('Start or stop the sync connection.')
      .addButton(btn => btn
        .setButtonText('Connect')
        .setCta()
        .onClick(() => this.plugin.startSync()))
      .addButton(btn => btn
        .setButtonText('Disconnect')
        .onClick(() => this.plugin.stopSync()))
  }

  /**
   * Render the "Plugin version" row with an Update button if a newer
   * version is available. Re-rendered in place when the check completes
   * or when an update finishes, via plugin.onUpdateStateChange.
   */
  private renderVersionSection(containerEl: HTMLElement) {
    const wrap = containerEl.createDiv({ cls: 'nnn-version-row' })
    wrap.style.margin = '8px 0 14px 0'
    wrap.style.display = 'flex'
    wrap.style.alignItems = 'center'
    wrap.style.gap = '10px'
    wrap.style.fontSize = '0.85rem'

    const render = () => {
      wrap.empty()
      const label = wrap.createSpan()
      const latest = this.plugin.latestVersion

      if (this.plugin.updating) {
        label.setText(`Plugin version v${PLUGIN_VERSION} — updating…`)
        return
      }
      if (latest === null) {
        // Not checked yet
        label.setText(`Plugin version v${PLUGIN_VERSION} — checking for updates…`)
        return
      }
      if (latest === '') {
        // Check failed
        label.setText(`Plugin version v${PLUGIN_VERSION}  `)
        wrap.createSpan({ cls: 'nnn-version-hint', text: '(couldn’t reach GitHub — try again later)' })
          .setAttr('style', 'color: var(--muted, #888); font-size: 0.78rem;')
        const retry = wrap.createEl('button', { text: 'Retry', cls: 'mod-cta' })
        retry.style.padding = '2px 10px'
        retry.style.fontSize = '0.78rem'
        retry.onclick = async () => {
          this.plugin.latestVersion = null
          render()
          await this.plugin.checkForUpdate()
        }
        return
      }
      if (this.plugin.isUpdateAvailable()) {
        label.setText(`Plugin version v${PLUGIN_VERSION}  →  v${latest} available`)
        label.style.color = 'var(--text-warning, #f59e0b)'
        const updateBtn = wrap.createEl('button', { text: 'Update now', cls: 'mod-cta' })
        updateBtn.style.padding = '3px 12px'
        updateBtn.onclick = () => this.handleUpdateClick(updateBtn)
        return
      }
      // Up to date
      label.setText(`Plugin version v${PLUGIN_VERSION}  `)
      wrap.createSpan({ text: '✓ Up to date' })
        .setAttr('style', 'color: var(--text-success, #4ade80); font-weight: 500;')
    }

    this.plugin.onUpdateStateChange = render
    render()

    // Trigger a check if we haven't yet this session
    if (this.plugin.latestVersion === null && !this.plugin.updateChecking) {
      void this.plugin.checkForUpdate()
    }
  }

  private async handleUpdateClick(btn: HTMLButtonElement) {
    btn.disabled = true
    btn.setText('Downloading…')
    try {
      const { version } = await this.plugin.performUpdate()
      btn.setText('Done')
      new ReloadPromptModal(this.app, version).open()
    } catch (e) {
      btn.disabled = false
      btn.setText('Update now')
      new Notice(`NNN Sync: update failed — ${(e as Error).message}`)
    }
  }
}

/**
 * Shown after a successful in-app update. Offers to reload Obsidian so the
 * new plugin code becomes active. "Later" closes the modal; user can reload
 * manually via Cmd/Ctrl+P → "Reload app without saving" whenever they want.
 */
class ReloadPromptModal extends Modal {
  private newVersion: string
  constructor(app: App, newVersion: string) {
    super(app)
    this.newVersion = newVersion
  }
  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: `✓ Updated to v${this.newVersion}` })
    contentEl.createEl('p', {
      text: 'The new plugin files are on disk. Obsidian needs to reload to activate them — your current edits are preserved.',
    })
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('Reload now').setCta().onClick(() => {
        this.close()
        // app:reload is Obsidian's built-in full-restart command.
        ;(this.app as any).commands.executeCommandById('app:reload')
      }))
      .addButton(btn => btn.setButtonText('Later').onClick(() => this.close()))
  }
  onClose() { this.contentEl.empty() }
}
