import esbuild from 'esbuild'
import process from 'process'

const watch = process.argv.includes('--watch')

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    // Node built-ins present in Obsidian's Electron runtime — do NOT bundle
    'node:net', 'node:tls', 'node:http', 'node:https',
    'node:stream', 'node:buffer', 'node:crypto', 'node:events', 'node:url', 'node:util',
    'net', 'tls', 'http', 'https', 'stream', 'buffer', 'crypto', 'events', 'url', 'util',
  ],
  format: 'cjs',
  target: 'node16',
  logLevel: 'info',
  sourcemap: 'inline',
  treeShaking: true,
  outfile: 'main.js',
})

if (watch) {
  await context.watch()
  console.log('watching...')
} else {
  await context.rebuild()
  await context.dispose()
}
