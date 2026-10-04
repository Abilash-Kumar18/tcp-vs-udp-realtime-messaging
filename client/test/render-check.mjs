/**
 * Renders the whole React app to a string with react-dom/server.
 *
 * This catches broken imports, bad JSX and crashes inside component bodies
 * without needing a browser. Browser-only APIs (fetch, WebSocket,
 * IntersectionObserver) are only touched inside useEffect, which SSR skips.
 *
 *   node client/test/render-check.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');

const vite = await createServer({
  root: clientRoot,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

let failures = 0;

async function check(name, fn) {
  try {
    const result = await fn();
    console.log(`PASS  ${name}${result ? `  ${result}` : ''}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const { default: App } = await vite.ssrLoadModule('/src/App.jsx');

await check('App renders without throwing', () => {
  const html = renderToString(React.createElement(App));
  if (html.length < 5000) throw new Error(`suspiciously small output: ${html.length} chars`);
  return `${html.length} chars`;
});

await check('all six sections are present', () => {
  const html = renderToString(React.createElement(App));
  const ids = ['overview', 'architecture', 'demo', 'experiments', 'code', 'report'];
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  if (missing.length) throw new Error(`missing sections: ${missing.join(', ')}`);
  return ids.join(', ');
});

await check('TCP and UDP demo panels render', () => {
  const html = renderToString(React.createElement(App));
  for (const label of ['TCP Chat Demo', 'UDP Chat Demo', 'TCP experiment', 'UDP experiment']) {
    if (!html.includes(label)) throw new Error(`missing "${label}"`);
  }
  return 'both panels + both runners';
});

await check('comparison table includes header sizes', () => {
  const html = renderToString(React.createElement(App));
  if (!html.includes('40 B') || !html.includes('28 B')) throw new Error('header sizes missing');
  return '40 B vs 28 B present';
});

await check('code highlighter escapes HTML', async () => {
  const { highlight } = await vite.ssrLoadModule('/src/lib/highlight.jsx');
  const out = highlight('const x = "<script>alert(1)</script>"; // hi');
  if (out.includes('<script>')) throw new Error('unescaped script tag in output');
  if (!out.includes('tok-key')) throw new Error('keywords not highlighted');
  return `${out.length} chars, escaped`;
});

await check('highlighter handles all four source files', async () => {
  const { highlight } = await vite.ssrLoadModule('/src/lib/highlight.jsx');
  const fs = await import('node:fs/promises');
  const files = ['tcp-backend.js', 'udp-backend.js', 'tcp-link.js', 'udp-link.js'];
  let total = 0;
  for (const file of files) {
    const source = await fs.readFile(path.resolve(clientRoot, '..', 'server', 'src', file), 'utf8');
    const out = highlight(source);
    if (out.includes('undefined') && !source.includes('undefined')) throw new Error(`${file}: undefined leaked`);
    total += source.split('\n').length;
  }
  return `${total} lines highlighted`;
});

await vite.close();

console.log(failures ? `\n${failures} check(s) failed` : '\nall render checks passed');
process.exit(failures ? 1 : 0);