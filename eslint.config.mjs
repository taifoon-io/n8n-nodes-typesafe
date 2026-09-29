import { config } from '@n8n/node-cli/eslint';

// Owner's decision (2026-09-29): Taifoon's packages depend on one another, this node included, so installing any one of
// them installs the others. n8n's rules for verified community nodes forbid run-time dependencies, so the node gives up
// n8n verification; the two rules that enforce it are off, and CI still refuses any third-party dependency.
export default [
  ...config,
  { files: ['package.json'], rules: { '@n8n/community-nodes/no-runtime-dependencies': 'off', '@n8n/community-nodes/valid-peer-dependencies': 'off' } },
];
