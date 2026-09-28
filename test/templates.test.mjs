// Every example workflow, run end to end without n8n: the trigger, the Code / Set / HTTP steps (network from fixtures),
// and the TypeSafe node itself (the built dist, the real routing and Jev Options), with TypeSafe's answers stubbed.
// Checks each template: valid shape, your own key only, no Taifoon secrets, and the item leaves by the right exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TaifoonTypeSafe } = require('../dist/nodes/TaifoonTypeSafe/TaifoonTypeSafe.node.js');
const DIR = new URL('../examples/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
const EVIDENCE_7287 = { ok: true, chainId: 8453, jobId: 'bitagent:8453:7287', state: 'job: ERC-8183 job 7287 …\nwhat the buyer asked: equity_research where ticker is \'AAPL\'\nwhat was delivered: a 32-byte digest',
  facts: [['what was delivered', 'a 32-byte digest 0xea97…; the content behind it is not published on chain'], ['funded', '2026-08-28 05:51:43 UTC'], ['submitted', '2026-08-28 05:51:55 UTC']] };

// the coordination layer's two-step compose (judge-base-job-record), as coord.taifoon.dev/v1 answers it
const RUBRIC_QS = [
  { id: 'spec_met', kind: 'choice', text: 'Does the deliverable satisfy every acceptance criterion in the task?', options: 'yes, no' },
  { id: 'unsupported_claim', kind: 'choice', text: 'Does the delivered content assert a fact the facts section does not contain?', options: 'yes, no' },
  { id: 'ending', kind: 'choice', text: 'Which ending fits the facts and the content?', options: 'complete, reject, expire, needs_review' },
  { id: 'cheat_shaped', kind: 'choice', text: 'Does the delivery look like concealment rather than a failed honest attempt?', options: 'yes, no' },
];
const PREPARE_7287 = { ok: true, mode: 'prepare', hard_fail: false, subject: 'bitagent:8453:7287', jev: { state: EVIDENCE_7287.state + '\nFACTS SECTION …', questions: RUBRIC_QS }, prepare_digest: '0x' + '54'.repeat(32) };
const DECISION = { id: 'decision-1-abc', digest: '0x' + 'd1'.repeat(32), answers_digest: '0x' + 'a1'.repeat(32), anchor_base: { status: 'queued', tx: null }, recording: { requested: 'base', allowed: 'base', used: 'base', held: null } };
const BASE_OK = (contract, tx) => ({ chain: 8453, contract, tx, block: 51870000, status: 'ok' });

/** n8n expression "={{ … }}" → value, against the current item and earlier nodes */
function resolve(v, json, nodeOut) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const $ = (name) => ({ first: () => nodeOut[name][0] });
  const ev = (expr) => Function('$json', '$', 'encodeURIComponent', '$execution', `return (${expr});`)(json, $, encodeURIComponent, { id: '4242' });
  const whole = /^=\{\{([\s\S]*)\}\}$/.exec(v.trim());
  if (whole && !whole[1].includes('}}')) return ev(whole[1]);                    // one expression: keep its type
  return v.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(ev(e)));  // text with {{ }} inside
}
const resolveDeep = (o, json, nodeOut) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, resolveDeep(x, json, nodeOut)])) : resolve(o, json, nodeOut));

/** Run one workflow. `answer(questionIds)` stubs TypeSafe: returns { [id]: answer object as TypeSafe sends it }. */
async function runWorkflow(w, { answer, trigger = {}, layer = {} }) {
  const byName = Object.fromEntries(w.nodes.map((n) => [n.name, n]));
  const nodeOut = {}; const reached = {}; const calls = []; const posts = []; const gets = [];
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
      if ((n.parameters.method ?? 'GET') === 'POST') {
        assert.equal(url, 'https://coord.taifoon.dev/v1/judge/compose', 'templates POST only to the compose route');
        const body = JSON.parse(resolve(n.parameters.jsonBody, items[0].json, nodeOut));
        posts.push({ body, auth: n.parameters.authentication === 'genericCredentialType' ? n.parameters.genericAuthType : null, creds: n.credentials ?? null });
        const res = body.mode === 'prepare' ? (layer.prepare ?? PREPARE_7287) : (layer.answers ?? { ok: true, receipt: { verdict: 'reject', reasons: ['spec_met 0.03'], receiptHash: '0x' + 'ee'.repeat(32) }, decision: DECISION, next: 'reject: …' });
        const o = [{ json: res }]; nodeOut[name] = o; emit(0, o); continue;
      }
      assert.match(url, /^https:\/\/coord\.taifoon\.dev\/v1\/judge\/evidence\/8453\//, 'templates read only the public evidence route');
      const o = [{ json: EVIDENCE_7287 }]; nodeOut[name] = o; emit(0, o); continue;
    }
    if (n.type === 'n8n-nodes-base.if') {
      const c = n.parameters.conditions.conditions[0];
      const yes = [], no = [];
      for (const it of items) (resolve(c.leftValue, it.json, nodeOut) === true ? yes : no).push(it);
      nodeOut[name] = [...yes, ...no]; if (yes.length) emit(0, yes); if (no.length) emit(1, no); continue;
    }
    if (n.type === 'n8n-nodes-base.code') {
      const perItem = n.parameters.mode === 'runOnceForEachItem';
      const $ = (nm) => ({ first: () => nodeOut[nm][0] });
      const self = { helpers: { httpRequest: async (req) => { gets.push(req.url); return layer.get ? layer.get(req.url) : null; } } };
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      let o;
      if (perItem) o = items.map((it) => Function('$json', '$', n.parameters.jsCode)(it.json, $));
      else o = await AsyncFunction('$input', '$', n.parameters.jsCode).call(self, { first: () => items[0], all: () => items }, $);
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
  return { reached, calls, nodeOut, posts, gets };
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
    for (const n of w.nodes) if (n.type === 'n8n-nodes-base.httpRequest' && n.credentials) {
      assert.deepEqual(Object.keys(n.credentials), ['httpHeaderAuth'], 'the only other credential is your relayer key as a header');
      assert.ok(!n.credentials.httpHeaderAuth.id, 'no credential id baked in');
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

const BASE_GET = (url) => url.includes('/judge/decisions/') ? { ok: true, decision: { ...DECISION, anchor_base: BASE_OK('0x209490d6A0FFC5368A42b0c2208BDCda853f6a92', '0x' + 'b1'.repeat(32)) } }
  : { ok: true, digest: DECISION.answers_digest, anchor_base: BASE_OK('0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d', '0x' + 'b2'.repeat(32)) };
// template E needs a Taifoon key, so it ships with @taifoon/jev (examples/n8n/), not in this key-free repo; tested here in the dev tree only
const E_FILE = new URL('../../sdk/examples/n8n/judge-base-job-record.workflow.json', import.meta.url);
const HAS_E = existsSync(E_FILE);
test('judge-base-job-record: prepare is keyless, answers go with the relayer key and record base, both Base txs are linked', { skip: !HAS_E && 'lives in @taifoon/jev' }, async () => {
  const { reached, calls, posts, nodeOut } = await runWorkflow(JSON.parse(readFileSync(E_FILE, 'utf8')), { answer: rubric('reject'), layer: { get: BASE_GET } });
  assert.equal(calls.length, 1, 'TypeSafe asked once, on your key');
  assert.deepEqual(Object.keys(calls[0].req.body.questions).sort(), RUBRIC_QS.map((q) => q.id).sort(), 'the four questions the layer prepared');
  assert.equal(typeof calls[0].req.body.state, 'string', 'Jev reads the prepared text as sent');
  const [prep, ans] = posts;
  assert.deepEqual([prep.body.mode, prep.auth, prep.creds], ['prepare', null, null], 'prepare needs no key');
  assert.equal(ans.body.mode, 'answers'); assert.equal(ans.auth, 'httpHeaderAuth'); assert.equal(ans.body.record, 'base');
  assert.equal(ans.body.prepare_digest, PREPARE_7287.prepare_digest); assert.equal(ans.body.answered_by, 'n8n-typesafe'); assert.equal(ans.body.execution_id, '4242');
  assert.deepEqual(Object.keys(ans.body.answers).sort(), RUBRIC_QS.map((q) => q.id).sort());
  const out = nodeOut['Base transactions'][0].json;
  assert.equal(out.recorded_on_base, true);
  assert.equal(out.base.decision.explorer, 'https://basescan.org/tx/0x' + 'b1'.repeat(32));
  assert.equal(out.base.answers.explorer, 'https://basescan.org/tx/0x' + 'b2'.repeat(32));
  assert.equal(reached['Recorded on Base: both tx links in the output'], 1);
});
test('judge-base-job-record: over the daily Base budget the grade stands and the output says why and how to retry', { skip: !HAS_E && 'lives in @taifoon/jev' }, async () => {
  const heldDecision = { ...DECISION, anchor_base: null, recording: { requested: 'base', allowed: 'base', used: 'none', held: { network: 'base', reason: 'budget', message: 'Base recording held: today\'s budget is spent', retry_after_seconds: 3600 } } };
  const { reached, nodeOut, gets } = await runWorkflow(JSON.parse(readFileSync(E_FILE, 'utf8')), { answer: rubric('reject'), layer: { answers: { ok: true, receipt: { verdict: 'reject', reasons: [] }, decision: heldDecision } } });
  const out = nodeOut['Base transactions'][0].json;
  assert.equal(gets.length, 0, 'nothing to wait for');
  assert.equal(out.recorded_on_base, false); assert.match(out.held, /budget/); assert.match(out.retry, /\/judge\/decisions\/decision-1-abc\/base/);
  assert.equal(reached['Not on Base yet: the output says why'], 1);
});
test('judge-base-job-record: a hard fail at prepare never asks TypeSafe and records nothing', { skip: !HAS_E && 'lives in @taifoon/jev' }, async () => {
  const { reached, calls, posts } = await runWorkflow(JSON.parse(readFileSync(E_FILE, 'utf8')), { answer: rubric('reject'), layer: { prepare: { ok: true, mode: 'prepare', hard_fail: true, receipt: { verdict: 'reject' } } } });
  assert.equal(calls.length, 0); assert.equal(posts.length, 1);
  assert.equal(reached['Hard fail: rejected by code, nothing to record'], 1);
});
test('judge-base-job-record: a refusal from the layer (no key, stale digest) stops the run with its code', { skip: !HAS_E && 'lives in @taifoon/jev' }, async () => {
  await assert.rejects(runWorkflow(JSON.parse(readFileSync(E_FILE, 'utf8')), { answer: rubric('reject'), layer: { answers: { ok: false, code: 'unauthorized', error: 'mode:answers needs a valid X-API-Key' } } }), /unauthorized/);
});
