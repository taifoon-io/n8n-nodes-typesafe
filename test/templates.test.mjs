// Every example workflow, run end to end without n8n: the trigger, the Code / Set / HTTP steps (network from fixtures),
// and the TypeSafe node itself (the built dist, the real routing and Jev Options), with TypeSafe's answers stubbed.
// Checks each template: valid shape, your own key only, no Taifoon secrets, and the item leaves by the right exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TaifoonTypeSafe } = require('../dist/nodes/TaifoonTypeSafe/TaifoonTypeSafe.node.js');
const DIR = new URL('../examples/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
const EVIDENCE_7287 = { ok: true, chainId: 8453, jobId: 'bitagent:8453:7287', state: 'job: ERC-8183 job 7287 …\nwhat the buyer asked: equity_research where ticker is \'AAPL\'\nwhat was delivered: a 32-byte digest',
  facts: [['what was delivered', 'a 32-byte digest 0xea97…; the content behind it is not published on chain'], ['funded', '2026-08-28 05:51:43 UTC'], ['submitted', '2026-08-28 05:51:55 UTC']] };

/** n8n expression "={{ … }}" → value, against the current item and earlier nodes */
function resolve(v, json, nodeOut) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const $ = (name) => ({ first: () => nodeOut[name][0] });
  const ev = (expr) => Function('$json', '$', 'encodeURIComponent', `return (${expr});`)(json, $, encodeURIComponent);
  const whole = /^=\{\{([\s\S]*)\}\}$/.exec(v.trim());
  if (whole && !whole[1].includes('}}')) return ev(whole[1]);                    // one expression: keep its type
  return v.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(ev(e)));  // text with {{ }} inside
}
const resolveDeep = (o, json, nodeOut) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, resolveDeep(x, json, nodeOut)])) : resolve(o, json, nodeOut));

/** Run one workflow. `answer(questionIds)` stubs TypeSafe: returns { [id]: answer object as TypeSafe sends it }. */
async function runWorkflow(w, { answer, trigger = {} }) {
  const byName = Object.fromEntries(w.nodes.map((n) => [n.name, n]));
  const nodeOut = {}; const reached = {}; const calls = [];
  const targets = (name, out = 0) => (w.connections[name]?.main?.[out] ?? []).map((c) => c.node);
  const start = w.nodes.find((n) => /manualTrigger|webhook|formTrigger/.test(n.type));
  const queue = [[start.name, [{ json: start.type.includes('webhook') ? { body: {} } : start.type.includes('formTrigger') ? trigger : {} }]]];
  while (queue.length) {
    const [name, items] = queue.shift(); const n = byName[name];
    const emit = (out, its) => { for (const t of targets(name, out)) queue.push([t, its]); };
    if (/manualTrigger|webhook|formTrigger/.test(n.type)) { nodeOut[name] = items; emit(0, items); continue; }
    if (n.type === 'n8n-nodes-base.set') {
      const o = items.map((it) => ({ json: { ...it.json, ...Object.fromEntries(n.parameters.assignments.assignments.map((a) => [a.name, resolve(a.value, it.json, nodeOut)])) } }));
      nodeOut[name] = o; emit(0, o); continue;
    }
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const url = resolve(n.parameters.url, items[0].json, nodeOut);
      assert.match(url, /^https:\/\/coord\.taifoon\.dev\/v1\/judge\/evidence\/8453\//, 'templates read only the public evidence route');
      const o = [{ json: EVIDENCE_7287 }]; nodeOut[name] = o; emit(0, o); continue;
    }
    if (n.type === 'n8n-nodes-base.code') {
      const perItem = n.parameters.mode === 'runOnceForEachItem';
      const $ = (nm) => ({ first: () => nodeOut[nm][0] });
      let o;
      if (perItem) o = items.map((it) => Function('$json', '$', n.parameters.jsCode)(it.json, $));
      else o = Function('$input', '$', n.parameters.jsCode)({ first: () => items[0], all: () => items }, $);
      nodeOut[name] = o; emit(0, o); continue;
    }
    if (n.type === '@taifoon/n8n-nodes-typesafe.taifoonTypeSafe') {
      const node = new TaifoonTypeSafe();
      const ctx = {
        getInputData: () => items,
        getNodeParameter: (p, i, fb) => (p in n.parameters ? resolveDeep(n.parameters[p], items[i].json, nodeOut) : fb),
        getNode: () => ({ name, type: n.type, typeVersion: 1, position: [0, 0], parameters: {} }),
        continueOnFail: () => false,
        getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://api.typesafe.ai' }),
        helpers: { httpRequestWithAuthentication: async (cred, req) => { calls.push({ cred, req }); return { model: 'jev-1.13.0', answers: answer(Object.keys(req.body.questions), req.body) }; } },
      };
      const outs = await node.execute.call(ctx);
      nodeOut[name] = outs.flat();
      outs.forEach((its, out) => its.length && emit(out, its));
      continue;
    }
    if (/noOp|respondToWebhook/.test(n.type)) { reached[name] = (reached[name] ?? 0) + items.length; continue; }
    throw new Error(`no runner for ${n.type}`);
  }
  return { reached, calls, nodeOut };
}

// TypeSafe answer shapes, as api.typesafe.ai sends them
const noul = (p) => ({ type: 'noul', noul: p });
const choice = (value, probabilities) => ({ type: 'choice', choice: value, confidence: Math.max(...Object.values(probabilities)), probabilities });
const RUBRIC = {
  complete: { spec_met: choice('yes', { yes: 0.93, no: 0.07 }), unsupported_claim: choice('no', { yes: 0.05, no: 0.95 }), ending: choice('complete', { complete: 0.9, reject: 0.03, expire: 0, needs_review: 0.07 }), cheat_shaped: choice('no', { yes: 0.02, no: 0.98 }) },
  reject: { spec_met: choice('no', { yes: 0.03, no: 0.97 }), unsupported_claim: choice('no', { yes: 0.06, no: 0.94 }), ending: choice('needs_review', { complete: 0.07, reject: 0, expire: 0, needs_review: 0.93 }), cheat_shaped: choice('no', { yes: 0.44, no: 0.56 }) },
  review: { spec_met: choice('yes', { yes: 0.6, no: 0.4 }), unsupported_claim: choice('no', { yes: 0.3, no: 0.7 }), ending: choice('complete', { complete: 0.6, reject: 0.1, expire: 0, needs_review: 0.3 }), cheat_shaped: choice('no', { yes: 0.1, no: 0.9 }) },
};
const rubric = (kind) => (ids) => Object.fromEntries(ids.map((id) => [id, RUBRIC[kind][id]]));
const nouls = (m) => (ids) => Object.fromEntries(ids.map((id) => [id, noul(m[id])]));

const CASES = {
  'judge-agent-delivery.workflow.json': [[rubric('complete'), 'Complete: accept and pay'], [rubric('reject'), 'Reject: send it back'], [rubric('review'), 'Needs review: a person decides']],
  'judge-base-job.workflow.json': [[rubric('reject'), 'Reject: sign the evaluator call'], [rubric('complete'), 'Complete: sign the evaluator call']],
  'judge-answer-factcheck.workflow.json': [[nouls({ unsupported: 0.92, answers_it: 0.95 }), 'Hold it back'], [nouls({ unsupported: 0.05, answers_it: 0.97 }), 'Send the answer']],
  'judge-refund-dispute.workflow.json': [[nouls({ defect_plausible: 0.2, evidence_contradicts: 0.85 }), 'Deny, with the reason'], [nouls({ defect_plausible: 0.9, evidence_contradicts: 0.1 }), 'Refund']],
  'judge-extraction-qa.workflow.json': [[nouls({ all_match: 0.97, anything_invented: 0.02 }), 'Post to accounting'], [nouls({ all_match: 0.4, anything_invented: 0.7 }), 'Re-extract']],
  'judge-freelancer-deliverable.workflow.json': [[rubric('complete'), 'Accept: approve the invoice'], [rubric('review'), 'Escalate to the project lead']],
  'judge-translation.workflow.json': [[nouls({ meaning_kept: 0.95, added_or_dropped: 0.03 }), 'Publish'], [nouls({ meaning_kept: 0.3, added_or_dropped: 0.8 }), 'Send back to the translator']],
  'judge-moderation.workflow.json': [[nouls({ spam: 0.7, harassment: 0.05, personal_data: 0.95 }), 'Remove, with the rule it broke'], [nouls({ spam: 0.02, harassment: 0.01, personal_data: 0.02 }), 'Publish']],
};
const FORM = { 'Brief': 'Write a 100-word product blurb for a solar lamp', 'Acceptance criteria (one per line)': 'About 100 words\nMentions the 12-hour battery', 'Deliverable (text or link contents)': 'Meet Lumo, the solar lamp that runs 12 hours on one day of sun…' };

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.workflow.json'))) {
  test(`${f}: shape, your own key only, nothing of Taifoon's inside`, () => {
    const w = load(f); const text = JSON.stringify(w);
    assert.ok(w.name && Array.isArray(w.nodes) && w.connections, 'a workflow');
    for (const n of w.nodes) if (n.type.includes('taifoonTypeSafe')) {
      assert.notEqual(n.parameters.connection, 'trial', 'no Free Trial');
      for (const [k, c] of Object.entries(n.credentials ?? {})) { assert.equal(k, 'taifoonTypeSafeApi'); assert.ok(!c.id, 'no credential id baked in'); }
    }
    assert.doesNotMatch(text, /tfr_[A-Za-z0-9]{8}|apikey_[A-Za-z0-9]{8}|sk-ant-|typesafe\.taifoon\.dev\/v1\/trial/, 'no keys, no trial relay');
    for (const [from, c] of Object.entries(w.connections)) for (const outs of c.main) for (const t of outs) assert.ok(w.nodes.some((n) => n.name === t.node), `${from} → ${t.node} exists`);
  });
}
for (const [f, cases] of Object.entries(CASES)) {
  for (const [answer, exit] of cases) {
    test(`${f}: TypeSafe's answers route to "${exit}"`, async () => {
      const { reached, calls } = await runWorkflow(load(f), { answer, trigger: FORM });
      assert.ok(calls.length >= 1, 'TypeSafe was asked');
      for (const c of calls) { assert.equal(c.cred, 'taifoonTypeSafeApi'); assert.equal(c.req.url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(c.req.body.model, 'jev-1.13.0'); }
      assert.ok(reached[exit] >= 1, `reached ${JSON.stringify(reached)}`);
    });
  }
}
test('judge-base-job: the unsigned evaluator call names job 7287 on BitAgent', async () => {
  const { nodeOut } = await runWorkflow(load('judge-base-job.workflow.json'), { answer: rubric('reject') });
  const j = nodeOut.TypeSafe[0].json.jev;
  assert.equal(j.verdict, 'reject');
  assert.equal(j.evaluator.fn, 'reject(uint256,bytes32,bytes)');
  assert.ok(j.evaluator.data.includes((7287).toString(16).padStart(64, '0')));
});
test('judge-bulk-submissions: an empty submission is rejected by code without asking TypeSafe', async () => {
  const { reached, calls } = await runWorkflow(load('judge-bulk-submissions.workflow.json'), { answer: rubric('complete') });
  assert.equal(calls.length, 1, 'only the non-empty submission was asked');
  assert.deepEqual([reached['Complete'], reached['Reject']], [1, 1]);
});
