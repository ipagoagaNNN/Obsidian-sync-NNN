/**
 * NNN HF Sync — Obsidian plugin
 * v1.2.0 — Vault sync (Phase 4c) + live co-editing (Phase 4d)
 *
 * This file is the plugin orchestration only. Supporting code was extracted
 * into focused modules (behaviour-preserving strangler split):
 *   - version.ts        plugin version + pinned update source
 *   - types.ts          ACL / settings / token shapes
 *   - fsutil.ts         isSyncable / ensureParentDirs
 *   - acl.ts            client-side ACL evaluation
 *   - updater.ts        in-app updater helpers
 *   - auth/modals.ts    PasswordChangeModal / ReauthModal
 *   - auth/session.ts   isSessionValid / login / logout / fetchClientToken
 *   - settings.ts       NNNSyncSettingTab / ReloadPromptModal
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
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  normalizePath,
} from 'obsidian'
import * as Y from 'yjs'
import { YSweetProvider } from '@y-sweet/client'
import type { ClientToken } from '@y-sweet/sdk'

import { PLUGIN_VERSION } from './version'
import { DEFAULT_SETTINGS } from './types'
import type { NNNSyncSettings, PathACL, Permission } from './types'
import { isSyncable, ensureParentDirs, setPrivateRoots } from './fsutil'
import { effectivePermission } from './acl'
import { compareVersions, sha256Hex, fetchLatestRelease } from './updater'
import { logout, fetchClientToken } from './auth/session'
import { NNNSyncSettingTab } from './settings'
import { PMClient } from './pm/api'
import { PM_VIEW_TYPE, PMBoardView } from './pm/view'
import { renderPMCodeBlock } from './pm/block'
import { registerBuiltinViews } from './pm/views'
import { injectPMStyles, removePMStyles } from './pm/styles'
import { NotificationsModal } from './pm/notifications'
import { HOME_VIEW_TYPE, HomeView } from './home/view'
import { ensureHomeConfig, pushMru } from './home/config'
import { SPACES_VIEW_TYPE, SpacesView } from './spaces/view'
import { ensureSpacesConfig } from './spaces/config'

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class NNNSyncPlugin extends Plugin {
  settings!: NNNSyncSettings

  private ydoc: Y.Doc | null = null
  private provider: YSweetProvider | null = null
  private statusBarItem: HTMLElement | null = null
  // PM notifications unread badge (Phase 2) — separate from the sync status item.
  private pmNotifStatusBar: HTMLElement | null = null

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

  // Home tab — debounced settings save for the viewed-files MRU (file-open
  // fires often; coalesce writes so we don't thrash saveData on every nav).
  private homeSaveDebounce: ReturnType<typeof setTimeout> | null = null

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

    // ── NNN-PM (Phase 1) — issue tracker surface ──────────────────────────────
    // The board talks to /pm/* with the same session token the sync engine
    // obtains. It self-gates (clear message) when the session isn't active or
    // the server hasn't enabled PM yet, so registering unconditionally is safe.
    injectPMStyles()
    registerBuiltinViews() // populate the view registry (board; more in later phases)
    this.registerView(PM_VIEW_TYPE, (leaf) => new PMBoardView(leaf, () => this.pmClient()))
    this.registerMarkdownCodeBlockProcessor('nnn-pm', (source, el) => {
      renderPMCodeBlock(this.app, () => this.pmClient(), source, el)
    })
    this.addCommand({
      id: 'nnn-pm-open-board',
      name: 'Open PM board',
      callback: () => { void this.openPMBoard() },
    })
    this.addRibbonIcon('layout-grid', 'NNN-PM board', () => { void this.openPMBoard() })

    // PM notifications: a clickable unread badge in the status bar, polled on a
    // 60 s interval. The COUNT endpoint is server-cached, so polling never pins
    // Neon awake (ADR-013). Hidden when there's nothing unread.
    this.pmNotifStatusBar = this.addStatusBarItem()
    this.pmNotifStatusBar.style.cursor = 'pointer'
    this.pmNotifStatusBar.addEventListener('click', () => this.openPMNotifications())
    this.updatePMNotifBadge(0)
    this.addCommand({
      id: 'nnn-pm-notifications',
      name: 'Open PM notifications',
      callback: () => this.openPMNotifications(),
    })
    this.registerInterval(window.setInterval(() => { void this.refreshPMNotifBadge() }, 60_000))
    setTimeout(() => { void this.refreshPMNotifBadge() }, 5000)

    // ── Home tab (Phase 1) — customizable landing + new-tab experience ────────
    // A custom ItemView that doubles as the new-tab view. Per-user config lives
    // in settings.home (local only, never synced). Registered unconditionally;
    // it works offline (vault search + recents) and lights up the notification
    // bell when a PM session is active.
    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this))
    this.addCommand({
      id: 'nnn-open-home',
      name: 'Open Home',
      callback: () => { void this.openHome() },
    })
    this.addRibbonIcon('home', 'NNN Home', () => { void this.openHome() })

    // Track viewed files for the "recently modified (viewed)" section.
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!file) return
      pushMru(ensureHomeConfig(this.settings), file.path)
      this.scheduleHomeSave()
    }))

    // Turn empty/new tabs into Home (gated by the setting; safe — only acts on
    // 'empty' leaves and the converted leaf is no longer 'empty', so no loop).
    this.registerEvent(this.app.workspace.on('layout-change', () => this.maybeReplaceEmptyLeaves()))
    this.app.workspace.onLayoutReady(() => {
      const home = ensureHomeConfig(this.settings)
      if (home.openOnStartup) void this.openHome(false)
      else this.maybeReplaceEmptyLeaves()
    })

    // ── Spaces (Phase 2) — Private vs. Organization navigator ─────────────────
    // A left-dock view over the same vault: Organization (synced, ACL-filtered)
    // + Private (local-only roots, excluded from sync via setPrivateRoots).
    this.registerView(SPACES_VIEW_TYPE, (leaf) => new SpacesView(leaf, this))
    this.addCommand({
      id: 'nnn-open-spaces',
      name: 'Open Spaces',
      callback: () => { void this.openSpaces() },
    })
    this.addRibbonIcon('layers', 'NNN Spaces', () => { void this.openSpaces() })
    this.app.workspace.onLayoutReady(() => {
      if (ensureSpacesConfig(this.settings).openOnStartup) void this.openSpaces()
    })

    if (this.settings.enabled && this.settings.username && this.settings.docId) {
      setTimeout(() => this.startSync(), 3000)
    }
  }

  /** Open (or reveal) the Home view. Reuses an empty leaf when one exists so
   *  startup doesn't spawn an extra tab. */
  async openHome(preferNewTab = true) {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(HOME_VIEW_TYPE)[0]
    if (!leaf) {
      leaf =
        workspace.getLeavesOfType('empty')[0] ??
        (preferNewTab ? workspace.getLeaf('tab') : workspace.getLeaf(false))
      await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true })
    }
    workspace.revealLeaf(leaf)
  }

  /** Convert any empty leaves into Home when the setting is enabled. */
  private maybeReplaceEmptyLeaves() {
    if (!ensureHomeConfig(this.settings).replaceNewTabs) return
    for (const leaf of this.app.workspace.getLeavesOfType('empty')) {
      void leaf.setViewState({ type: HOME_VIEW_TYPE })
    }
  }

  /** Debounced persist of the home config (MRU updates on every file-open). */
  private scheduleHomeSave() {
    if (this.homeSaveDebounce) clearTimeout(this.homeSaveDebounce)
    this.homeSaveDebounce = setTimeout(() => { void this.saveSettings() }, 1500)
  }

  /** Open (or reveal) the Spaces navigator in the left dock. */
  async openSpaces() {
    const { workspace } = this.app
    const existing = workspace.getLeavesOfType(SPACES_VIEW_TYPE)[0]
    const leaf = existing ?? workspace.getLeftLeaf(false) ?? workspace.getLeftLeaf(true)
    if (!leaf) {
      new Notice('NNN Spaces: no left panel available.')
      return
    }
    if (!existing) await leaf.setViewState({ type: SPACES_VIEW_TYPE, active: true })
    workspace.revealLeaf(leaf)
  }

  /** Re-apply private roots to the sync filter + re-render open Spaces views.
   *  Called from the settings tab when the private-folder list changes. */
  applyPrivateRoots() {
    setPrivateRoots(ensureSpacesConfig(this.settings).privateRoots)
    this.refreshSpaces()
  }

  /** Re-render any open Spaces sidebars (after a settings change). */
  refreshSpaces() {
    for (const leaf of this.app.workspace.getLeavesOfType(SPACES_VIEW_TYPE)) {
      const v = leaf.view
      if (v instanceof SpacesView) v.refresh()
    }
  }

  /** Open the notifications inbox; refreshes the badge on any read-state change. */
  openPMNotifications() {
    new NotificationsModal(this.app, this.pmClient(), () => { void this.refreshPMNotifBadge() }).open()
  }

  /** Poll the server's (cached) unread count and repaint the badge. */
  async refreshPMNotifBadge() {
    if (!this.settings.sessionToken) {
      this.updatePMNotifBadge(0)
      return
    }
    try {
      const r = await this.pmClient().unreadCount()
      this.updatePMNotifBadge(r.unread)
    } catch {
      // PM disabled (503), offline, or session expired — hide rather than nag.
      this.updatePMNotifBadge(0)
    }
  }

  private updatePMNotifBadge(n: number) {
    const el = this.pmNotifStatusBar
    if (!el) return
    if (n > 0) {
      el.setText(`🔔 ${n}`)
      el.title = `${n} unread PM notification${n === 1 ? '' : 's'}`
      el.style.display = ''
    } else {
      el.setText('')
      el.style.display = 'none'
    }
  }

  /** Build a PMClient bound to the current settings (session token + space URL). */
  pmClient(): PMClient {
    return new PMClient(this.settings.spaceUrl, () => this.settings.sessionToken)
  }

  /** Open (or reveal) the PM board in a workspace tab. */
  async openPMBoard() {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(PM_VIEW_TYPE)[0]
    if (!leaf) {
      leaf = workspace.getLeaf('tab')
      await leaf.setViewState({ type: PM_VIEW_TYPE, active: true })
    }
    workspace.revealLeaf(leaf)
  }

  onunload() {
    removePMStyles()
    if (this.homeSaveDebounce) {
      clearTimeout(this.homeSaveDebounce)
      this.homeSaveDebounce = null
    }
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

  /** Public ACL lookup for UI surfaces (the Spaces sidebar filters by this). */
  permissionForPath(path: string): Permission {
    return this.permissionFor(path)
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
    // Normalize the home-tab config so live code always sees a full object.
    ensureHomeConfig(this.settings)
    // Normalize Spaces config + apply private roots to the sync filter so
    // local-only folders are excluded from sync from the very first connect.
    setPrivateRoots(ensureSpacesConfig(this.settings).privateRoots)
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}
