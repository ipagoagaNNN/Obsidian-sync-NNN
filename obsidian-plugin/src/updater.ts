// In-app updater helpers (mirrors install-windows.ps1 / install-macos.sh Layer-1
// defenses: version-floor + SHA256 verify). Pure helpers + the GitHub release
// fetch; the orchestration (checkForUpdate / performUpdate) lives on the plugin
// class so it can write into the vault adapter.

import { requestUrl } from 'obsidian'
import { PLUGIN_REPO_OWNER, PLUGIN_REPO_NAME } from './version'

/** Compare two dot-separated versions. Returns -1, 0, or 1. Treats "1.3.0" < "1.3.1" < "1.4". */
export function compareVersions(a: string, b: string): number {
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
export async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface ReleaseAsset { name: string; browser_download_url: string }
export interface ReleaseMeta  { tag_name: string; assets: ReleaseAsset[] }

/** Fetch the latest release metadata from the pinned GitHub repo.
 *  Uses Obsidian's requestUrl (main-process HTTP) rather than fetch() so it is
 *  not subject to the renderer's CORS/CSP — the same reason performUpdate's
 *  asset downloads use requestUrl (see main.ts). */
export async function fetchLatestRelease(): Promise<ReleaseMeta> {
  const url = `https://api.github.com/repos/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/releases/latest`
  const res = await requestUrl({
    url,
    headers: { 'User-Agent': 'NNN-Sync-Plugin', 'Accept': 'application/vnd.github+json' },
    throw: false,
  })
  if (res.status < 200 || res.status >= 300) throw new Error(`GitHub API ${res.status}`)
  return res.json as ReleaseMeta
}
