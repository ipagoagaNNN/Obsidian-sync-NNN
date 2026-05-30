// Client-side ACL evaluation — mirrors the server's resolveEffectivePermission
// (handlers_token.go) so the plugin's per-file enforcement agrees with the
// server's. Pure functions, no Obsidian / network dependency.

import type { PathACL, Permission } from './types'

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
export function globMatch(pattern: string, name: string): boolean {
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
export function roleDefaultPerm(role: string): Permission {
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
export function effectivePermission(role: string, acls: PathACL[], path: string): Permission {
  for (const acl of acls) {
    if (globMatch(acl.path, path)) {
      if (acl.permission === 'write') return 'write'
      if (acl.permission === 'read')  return 'read-only'
      if (acl.permission === 'none')  return 'none'
    }
  }
  return roleDefaultPerm(role)
}
