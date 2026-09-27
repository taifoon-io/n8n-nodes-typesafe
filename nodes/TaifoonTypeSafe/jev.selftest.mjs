// Offline self-test of the Jev options (1.5.0), run against the BUILT node: `npm run build && node nodes/TaifoonTypeSafe/jev.selftest.mjs`.
// A fake n8n context answers the trial call; nothing leaves the machine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TaifoonTypeSafe } = require('../../dist/nodes/TaifoonTypeSafe/TaifoonTypeSafe.node.js');

const ANSWERS = [
	{ id: 'spec_met', kind: 'choice', schema_ok: true, value: 'yes', confidence: 0.86, probabilities: { yes: 0.93, no: 0.07 } },
	{ id: 'unsupported_claim', kind: 'choice', schema_ok: true, value: 'no', confidence: 0.8, probabilities: { yes: 0.1, no: 0.9 } },
	{ id: 'ending', kind: 'choice', schema_ok: true, value: 'complete', confidence: 0.83, probabilities: { complete: 0.9, reject: 0.03, expire: 0, needs_review: 0.07 } },
	{ id: 'cheat_shaped', kind: 'choice', schema_ok: true, value: 'no', confidence: 0.96, probabilities: { yes: 0.02, no: 0.98 } },
];
function ctx(params, calls) {
	return {
		getInputData: () => [{ json: { task: 'return 4', delivered: '4' } }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'TypeSafe', type: 'taifoonTypeSafe', typeVersion: 1, position: [0, 0], parameters: {} }),
		continueOnFail: () => false,
		helpers: { httpRequest: async (req) => { calls.push(req); return { ok: true, model: 'jev', upstreamModel: 'jev-1.13.0', answers: ANSWERS, latency_ms: 700, trial: { calls: 3, used: 1, left: 2 } }; } },
	};
}
const base = { operation: 'ask', connection: 'trial', state: '{"task":"return 4","delivered":"4"}', questions: {}, questionsJson: '[]', routing: '{}', replyLanguage: 'off', failClosed: true, rawOutput: false };
const node = new TaifoonTypeSafe();

// 1. no Jev options: exactly as before (no jev key, pass)
{ const calls = []; const [pass] = await node.execute.call(ctx({ ...base, questionsJson: JSON.stringify([ANSWERS[0]].map((a) => ({ id: a.id, kind: 'choice', text: 'Done?', options: 'yes, no' }))), jev: {} }, calls));
	assert.equal(pass.length, 1); assert.equal(pass[0].json.jev, undefined); assert.equal(calls[0].body.state.task, 'return 4'); }

// 2. RUBRIC_v1 + record (devnet) + evaluator: asks the four, composes complete → Pass, unsigned calls out
{ const calls = []; const [pass, fail, review] = await node.execute.call(ctx({ ...base, jev: { rubric: true, subject: 'job-7', chainId: 8453, record: 'devnet', evaluator: 'virtuals-erc8183', jobId: '7' } }, calls));
	assert.deepEqual([pass.length, fail.length, review.length], [1, 0, 0]);
	assert.deepEqual(calls[0].body.questions.map((q) => q.id), ['spec_met', 'unsupported_claim', 'ending', 'cheat_shaped']);
	assert.match(calls[0].body.state, /facts code established before the judge was asked/);
	const j = pass[0].json.jev;
	assert.equal(j.verdict, 'complete'); assert.equal(j.receipt.model, 'jev-1.13.0'); assert.equal(j.receipt.inputDigest.length, 66);
	assert.deepEqual(j.record.calls.map((c) => c.fn), ['JevAnswerLog.record', 'JevDecisionLog.record']);
	assert.equal(j.evaluator.fn, 'complete(uint256,bytes32,bytes)'); assert.ok(j.evaluator.data.includes(j.decisionDigest.slice(2))); }

// 3. a false fact: reject on Fail, Jev never asked, no record, a reject call
{ const calls = []; const [, fail] = await node.execute.call(ctx({ ...base, jev: { rubric: true, subject: 'job-8', factsJson: '{"delivered": true, "checks": {"proof_verifies": false}}', evaluator: 'bitagent-erc8183', jobId: '8' } }, calls));
	assert.equal(calls.length, 0); assert.equal(fail.length, 1);
	assert.equal(fail[0].json.jev.verdict, 'reject'); assert.equal(fail[0].json.jev.decisionDigest, null); assert.equal(fail[0].json.jev.evaluator.fn, 'reject(uint256,bytes32,bytes)'); }

// 4. record on both networks: four calls, the Base pair carries to = null while this version has no Base address
{ const calls = []; const [pass] = await node.execute.call(ctx({ ...base, jev: { rubric: true, subject: 'job-9', record: 'both' } }, calls));
	assert.deepEqual(pass[0].json.jev.record.calls.map((c) => c.chainId), [36927, 36927, 8453, 8453]); }

// 5. the options exist in the node's description (a UI the canvas can show), each off by default
{ const jevProp = node.description.properties.find((p) => p.name === 'jev');
	assert.ok(jevProp, 'Jev Options property missing');
	assert.deepEqual(jevProp.options.map((o) => o.name).sort(), ['chainId', 'evaluator', 'evaluatorAddress', 'factsJson', 'jobId', 'record', 'rubric', 'subject']);
	assert.equal(jevProp.options.find((o) => o.name === 'record').default, 'none'); assert.equal(jevProp.options.find((o) => o.name === 'rubric').default, false); }

console.log('jev self-test: 5 cases passed');
