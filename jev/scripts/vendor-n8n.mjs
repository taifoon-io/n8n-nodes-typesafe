// Copy the network-free core of this SDK into the n8n TypeSafe node (judge/n8n-typesafe/nodes/TaifoonTypeSafe/jev/).
// n8n's verified community nodes may not have runtime dependencies, so the node carries these files instead of
// importing the package; test/vendor.test.ts fails when the copy drifts. Run: node scripts/vendor-n8n.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const VENDORED = ['hash.ts', 'abi.ts', 'rubric.ts', 'records.ts', 'contracts.ts', 'receipt.ts', 'record.ts', 'evaluator/types.ts', 'evaluator/assurance-hook.ts', 'evaluator/judge-adapter.ts', 'evaluator/virtuals-erc8183.ts', 'evaluator/virtuals-memo-acp.ts', 'evaluator/bitagent-erc8183.ts', 'evaluator/index.ts'];
export const HEADER = '// GENERATED from @taifoon/jev (judge/sdk/src) by judge/sdk/scripts/vendor-n8n.mjs. Do not edit here: edit the SDK and re-run.\n';
const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, '..', 'src');
export const DEST = join(here, '..', '..', 'n8n-typesafe', 'nodes', 'TaifoonTypeSafe', 'jev');
export const vendored = (f) => HEADER + readFileSync(join(SRC, f), 'utf8');
/** where the node's copy is: judge/n8n-typesafe (umbrella) or the repo root (public mirror, this package in jev/) */
const PUBLIC_DEST = join(here, '..', '..', 'nodes', 'TaifoonTypeSafe', 'jev');
export const found = () => (existsSync(DEST) ? DEST : existsSync(PUBLIC_DEST) ? PUBLIC_DEST : null);
/** the vendored files that differ from src/ (empty = in step) */
export const drift = () => { const d = found(); return VENDORED.filter((f) => !existsSync(join(d, f)) || readFileSync(join(d, f), 'utf8') !== vendored(f)); };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(join(DEST, '..'))) throw new Error(`no n8n node at ${DEST}`);
  rmSync(DEST, { recursive: true, force: true });
  for (const f of VENDORED) { mkdirSync(dirname(join(DEST, f)), { recursive: true }); writeFileSync(join(DEST, f), vendored(f)); }
  console.log(`vendored ${VENDORED.length} files → ${DEST}`);
}
