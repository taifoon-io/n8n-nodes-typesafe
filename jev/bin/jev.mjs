#!/usr/bin/env node
// jev — the @taifoon/jev command line.
//   jev workflows list [--version X]          the bundled n8n workflows (and which nodes and credentials each needs)
//   jev workflows export <dir> [--version X]  write them, their schemas, manifest and README into <dir>
//   jev verify <answers-digest>               find the digest's JevAnswered / Decided rows on devnet 36927
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const version = flag('--version') ?? PKG.version;
const bundle = join(ROOT, 'workflows', version);
const die = (m) => { console.error(m); process.exit(1); };
const [cmd, sub, target] = args;

if (cmd === 'workflows') {
  if (!existsSync(bundle)) die(`no workflow bundle ${version}; bundled: ${readdirSync(join(ROOT, 'workflows')).join(', ')}`);
  const m = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
  if (sub === 'list') {
    for (const w of m.workflows) console.log(`${w.file}  ${w.name}\n  nodes: ${w.packages.join(', ')}  ·  credentials: ${w.credentials.join(', ') || 'none'}`);
  } else if (sub === 'export') {
    if (!target) die('usage: jev workflows export <dir> [--version X]');
    const out = resolve(target);
    cpSync(bundle, out, { recursive: true });
    console.log(`${m.bundle} → ${out}: ${m.workflows.length} workflows, ${m.schemas.length} schemas, manifest.json, README.md`);
  } else die('usage: jev workflows list|export <dir> [--version X]');
} else if (cmd === 'verify' && sub) {
  const { verify } = await import('../dist/index.js');
  const v = await verify(sub);
  console.log(JSON.stringify(v, null, 1));
  process.exit(v.ok ? 0 : 2);
} else {
  console.log(`jev ${PKG.version}\n  jev workflows list [--version X]\n  jev workflows export <dir> [--version X]\n  jev verify <answers-digest>`);
}
