// Builds the judge workflow templates in this folder: one definition per template, one shape for all of them.
//   trigger → the item (sample data, so it runs as imported) → TypeSafe (your own key) → Pass / Fail / Review
// Run: node examples/build-judges.mjs   (writes examples/judge-*.workflow.json; test/templates.test.mjs checks them)
import { writeFileSync } from 'node:fs';

const TS = '@taifoon/n8n-nodes-typesafe.taifoonTypeSafe';
const CRED = { taifoonTypeSafeApi: { id: '', name: 'TypeSafe API (your key from console.typesafe.ai)' } };
const at = (x, y) => [x, y];
const note = (name, text, pos, w = 420, h = 220) => ({ parameters: { content: text, width: w, height: h }, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos });
const code = (name, js, pos) => ({ parameters: { jsCode: js }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos });
const noop = (name, pos) => ({ parameters: {}, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: pos });
const manual = (pos) => ({ parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: pos });
const typesafe = (params, pos) => ({
  parameters: { operation: 'ask', connection: 'direct', model: 'jev-1.13.0', questions: {}, questionsJson: '[]', routing: '{}', replyLanguage: 'off', failClosed: true, ...params },
  name: 'TypeSafe', type: TS, typeVersion: 1, position: pos, credentials: CRED,
});
const link = (from, to, out = 0) => ({ from, to, out });
function workflow(name, nodes, links, tags) {
  const connections = {};
  for (const l of links) {
    connections[l.from] ??= { main: [] };
    while (connections[l.from].main.length <= l.out) connections[l.from].main.push([]);
    connections[l.from].main[l.out].push({ node: l.to, type: 'main', index: 0 });
  }
  return { name, nodes, connections, settings: { executionOrder: 'v1' }, pinData: {}, meta: { templateCredsSetupCompleted: false }, tags };
}
const exits = (a, b, c, y = 420) => [noop(a, at(1120, y - 180)), noop(b, at(1120, y)), noop(c, at(1120, y + 180))];
const exitLinks = (a, b, c) => [link('TypeSafe', a, 0), link('TypeSafe', b, 1), link('TypeSafe', c, 2)];

// what the grader reads for any job: the task, numbered criteria, the source it must be faithful to, the delivery
const PACK = `const j = $input.first().json;
const criteria = j.criteria.map((c, i) => \`\${i + 1}. \${c}\`).join('\\n');
const state = ['task: ' + j.task, 'acceptance criteria:\\n' + criteria, j.source ? 'source:\\n' + j.source : '', 'delivered:\\n' + (j.delivered || '(nothing was delivered)')].filter(Boolean).join('\\n\\n');
const checks = {};
for (const [name, ok] of Object.entries(j.checks || {})) checks[name] = !!ok;
return [{ pairedItem: { item: 0 }, json: { ...j, state, facts: { delivered: !!(j.delivered && String(j.delivered).trim()), checks } } }];`;

const T = {};

T['judge-agent-delivery'] = workflow('Grade an AI agent\'s delivered work (Jev judge)', [
  manual(at(0, 420)),
  code('The job', `// Replace with your job: what was asked, what "done" means, what came back.
return [{ pairedItem: { item: 0 }, json: {
  ref: 'job-4711',
  task: 'Extract the invoice into JSON with invoice_no, total, currency and due_date',
  criteria: ['Returns one JSON object with exactly the four fields', 'Every value matches the source invoice', 'due_date is ISO 8601'],
  source: 'INVOICE INV-20931 · Total due: EUR 1,240.50 · Payment due by 2026-10-01',
  delivered: '{"invoice_no":"INV-20931","total":1240.50,"currency":"EUR","due_date":"2026-10-01"}',
  checks: { parses_as_json: true },
} }];`, at(220, 420)),
  code('What the judge reads', PACK, at(440, 420)),
  typesafe({ state: '={{ $json.state }}', jev: { rubric: true, subject: '={{ $json.ref }}', factsJson: '={{ JSON.stringify($json.facts) }}' } }, at(700, 420)),
  ...exits('Complete: accept and pay', 'Reject: send it back', 'Needs review: a person decides'),
  note('How it works', '## Did the agent do the work it was paid for?\n\n1. **The job**: the task, what "done" means, the source and what came back.\n2. **Code checks first**: a failed check rejects without asking the model.\n3. **TypeSafe (Jev)** answers four closed questions (spec met, unsupported claims, ending, concealment) with full probabilities.\n4. Code composes **complete / reject / needs review**. The output carries a receipt anyone can recompute.\n\nYour own TypeSafe key only (console.typesafe.ai).', at(200, 40), 520, 300),
], [link('Start', 'The job'), link('The job', 'What the judge reads'), link('What the judge reads', 'TypeSafe'), ...exitLinks('Complete: accept and pay', 'Reject: send it back', 'Needs review: a person decides')], [{ name: 'AI agents' }, { name: 'Judge' }]);

T['judge-base-job'] = workflow('Grade a Base agent job from its on-chain record (Jev judge)', [
  manual(at(0, 420)),
  { parameters: { assignments: { assignments: [{ id: 'c', name: 'chain', value: '8453', type: 'string' }, { id: 'j', name: 'job', value: 'bitagent:8453:7287', type: 'string' }] }, options: {} }, name: 'Which job', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: at(220, 420) },
  { parameters: { url: '=https://coord.taifoon.dev/v1/judge/evidence/{{ $json.chain }}/{{ encodeURIComponent($json.job) }}', options: {} }, name: 'Read its record (public)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(440, 420) },
  code('Facts from the chain', `const e = $input.first().json;
const fact = (re) => (e.facts.find(([k]) => re.test(k)) || [])[1] || '';
const delivered = !!fact(/what was delivered/i) && !/nothing|not delivered/i.test(fact(/what was delivered/i));
const job = $('Which job').first().json;
return [{ pairedItem: { item: 0 }, json: { state: e.state, ref: job.job, chainId: Number(job.chain), jobId: (job.job.match(/(\\d+)$/) || [])[1] || job.job,
  facts: { delivered, checks: { funded: /funded/i.test(fact(/^funded$/i)) || !!fact(/^funded$/i), submitted: !!fact(/^submitted$/i) } } } }];`, at(660, 420)),
  typesafe({ state: '={{ $json.state }}', jev: { rubric: true, subject: '={{ $json.ref }}', chainId: '={{ $json.chainId }}', factsJson: '={{ JSON.stringify($json.facts) }}', evaluator: 'bitagent-erc8183', jobId: '={{ $json.jobId }}' } }, at(900, 420)),
  noop('Complete: sign the evaluator call', at(1140, 240)), noop('Reject: sign the evaluator call', at(1140, 420)), noop('Needs review: nothing ends, appeal', at(1140, 600)),
  note('How it works', '## Grade a real agent job on Base\n\n**Read its record** fetches the public evidence for an ERC-8183 job (no key): the task, price, parties and every event.\n\nTypeSafe (Jev) grades it on **your own key**. The output carries the unsigned `complete` / `reject` call for the job\'s evaluator seat: sign it with that wallet. Nothing is signed or sent here.\n\nChange **Which job** to any Base job, e.g. `8453:81100` for Virtuals ACP (set Evaluator Call to match).', at(200, 20), 560, 320),
], [link('Start', 'Which job'), link('Which job', 'Read its record (public)'), link('Read its record (public)', 'Facts from the chain'), link('Facts from the chain', 'TypeSafe'),
  link('TypeSafe', 'Complete: sign the evaluator call', 0), link('TypeSafe', 'Reject: sign the evaluator call', 1), link('TypeSafe', 'Needs review: nothing ends, appeal', 2)], [{ name: 'Web3' }, { name: 'AI agents' }, { name: 'Judge' }]);

// E: the same Base job, graded in two steps through the coordination layer so the grade can be recorded on Base.
// Prepare (public) → your TypeSafe key answers → Answers (your Taifoon relayer key, record: 'base') → the Base transactions.
const LAYER = 'https://coord.taifoon.dev/v1';
T['judge-base-job-record'] = workflow('Grade a Base agent job and record the grade on Base (Jev judge)', [
  manual(at(0, 420)),
  { parameters: { assignments: { assignments: [
    { id: 'c', name: 'chain', value: 8453, type: 'number' },
    { id: 'j', name: 'job', value: 'bitagent:8453:7287', type: 'string' },
    { id: 'p', name: 'price_usdc', value: 1.5, type: 'number' },
    { id: 'r', name: 'record', value: 'base', type: 'string' },
  ] }, options: {} }, name: 'Which job', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: at(220, 420) },
  { parameters: { method: 'POST', url: `${LAYER}/judge/compose`, sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ jobId: $json.job, chainId: $json.chain, price_usdc: $json.price_usdc, mode: "prepare" }) }}', options: {} },
    name: 'Prepare (public)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(440, 420) },
  { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [
    { id: 'h', leftValue: '={{ $json.hard_fail === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    name: 'Hard fail?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(660, 420) },
  typesafe({ state: '={{ JSON.stringify($json.jev.state) }}', questionsJson: '={{ JSON.stringify($json.jev.questions) }}' }, at(880, 520)),
  { parameters: { method: 'POST', url: `${LAYER}/judge/compose`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ jobId: $('Which job').first().json.job, chainId: $('Which job').first().json.chain, price_usdc: $('Which job').first().json.price_usdc, mode: "answers", record: $('Which job').first().json.record, answers: $json.answers, model: $json.model, answered_by: "n8n-typesafe", prepare_digest: $('Prepare (public)').first().json.prepare_digest, execution_id: $execution.id, latency_ms: $json.latency_ms }) }}`,
    options: { response: { response: { neverError: true } } } },
    name: 'Answers + record', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(1100, 520),
    credentials: { httpHeaderAuth: { id: '', name: 'Taifoon relayer key (header X-API-Key)' } } },
  code('Base transactions', `// The layer queues the Base records; its recorder signs them within a minute or two. Wait for both hashes (at most 200 s).
const r = $input.first().json;
if (r.ok === false || !r.decision) throw new Error('the layer refused: ' + (r.code ? r.code + ': ' : '') + (r.error || JSON.stringify(r).slice(0, 300)));
const LAYER = '${LAYER}';
const d = r.decision; const rc = r.receipt || {};
const want = $('Which job').first().json.record;
const onBase = want === 'base' || want === 'both';
const held = d.recording && d.recording.held ? d.recording.held : null;
const get = (path) => this.helpers.httpRequest({ method: 'GET', url: LAYER + path, json: true, timeout: 30000, ignoreHttpStatusErrors: true }).catch(() => null);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let decisionBase = d.anchor_base || null; let answersBase = null;
const until = Date.now() + 200000;
for (let wait = 5000; onBase && !held; wait = Math.min(wait * 2, 40000)) {
  const [dd, aa] = await Promise.all([get('/judge/decisions/' + d.id), d.answers_digest ? get('/judge/answers/' + d.answers_digest) : null]);
  decisionBase = (dd && dd.decision && dd.decision.anchor_base) || decisionBase;
  answersBase = (aa && aa.anchor_base) || answersBase;
  const done = (a) => a && a.tx && a.status === 'ok';
  if (done(decisionBase) && (!d.answers_digest || done(answersBase))) break;
  if (Date.now() + wait > until) break;
  await sleep(wait);
}
const link = (a) => (a && a.tx ? { tx: a.tx, block: a.block ?? null, status: a.status ?? null, contract: a.contract ?? null, explorer: 'https://basescan.org/tx/' + a.tx } : a ? { tx: null, status: a.status ?? 'queued', error: a.error ?? null } : null);
const recorded = !!(decisionBase && decisionBase.tx && decisionBase.status === 'ok' && (!d.answers_digest || (answersBase && answersBase.tx && answersBase.status === 'ok')));
return [{ pairedItem: { item: 0 }, json: {
  job: $('Which job').first().json.job, verdict: rc.verdict || null, reasons: rc.reasons || [], receipt_hash: rc.receiptHash || null, next: r.next || null,
  decision_id: d.id, decision_digest: d.digest, answers_digest: d.answers_digest || null,
  record: want, recorded_on_base: recorded,
  base: { decision: link(decisionBase), answers: link(answersBase) },
  held: held ? held.message : null,
  retry: recorded || !onBase ? null : 'POST ' + LAYER + '/judge/decisions/' + d.id + '/base (same X-API-Key) puts this decision and its answers on Base later',
  verify: LAYER + '/judge/decisions/' + d.id,
} }];`, at(1320, 520)),
  { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [
    { id: 'b', leftValue: '={{ $json.recorded_on_base }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    name: 'On Base?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(1540, 520) },
  noop('Recorded on Base: both tx links in the output', at(1760, 420)),
  noop('Not on Base yet: the output says why', at(1760, 620)),
  noop('Hard fail: rejected by code, nothing to record', at(880, 300)),
  note('How it works', '## Grade a Base job, and put the grade on Base\n\n1. **Prepare** (public, no key): the layer reads the job from chain, code decides the facts, and it returns the exact text and the four RUBRIC_v1 questions.\n2. **TypeSafe (Jev)** answers them on **your own TypeSafe key**.\n3. **Answers + record** sends the answers with **your Taifoon relayer key** and `record: base`. The layer composes the verdict, and its recorder writes the decision (JevDecisionLog) and the answers (JevAnswerLog) on Base. Base recording is metered by a daily budget; over it, the output says so and how to retry.\n4. **Base transactions** waits for both hashes and links them on basescan.\n\nSet **record** in *Which job* to `none` to grade without writing anything on chain.', at(160, -40), 620, 360),
], [link('Start', 'Which job'), link('Which job', 'Prepare (public)'), link('Prepare (public)', 'Hard fail?'), link('Hard fail?', 'Hard fail: rejected by code, nothing to record', 0), link('Hard fail?', 'TypeSafe', 1),
  link('TypeSafe', 'Answers + record'), link('Answers + record', 'Base transactions'), link('Base transactions', 'On Base?'),
  link('On Base?', 'Recorded on Base: both tx links in the output', 0), link('On Base?', 'Not on Base yet: the output says why', 1)], [{ name: 'Web3' }, { name: 'AI agents' }, { name: 'Judge' }]);

T['judge-answer-factcheck'] = workflow('Fact-check a chatbot answer before it ships (Jev judge)', [
  { parameters: { httpMethod: 'POST', path: 'factcheck', responseMode: 'responseNode', options: {} }, name: 'Answer to check', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: at(0, 420), webhookId: 'factcheck' },
  code('Question, source, answer', `// POST { question, source, answer }. Sample used when you run it by hand.
const b = $input.first().json.body || {};
return [{ pairedItem: { item: 0 }, json: {
  question: b.question || 'Can I return a sale item?',
  source: b.source || 'Returns: full-price items within 30 days. Sale items are final and cannot be returned.',
  answer: b.answer || 'Yes, sale items can be returned within 30 days for a full refund.',
} }];`, at(220, 420)),
  typesafe({ state: '={{ JSON.stringify($json) }}', questionsJson: JSON.stringify([
    { id: 'unsupported', kind: 'noul', text: 'Does the answer state anything the source does not say, or that contradicts it?' },
    { id: 'answers_it', kind: 'noul', text: 'Does the answer respond to the question that was asked?' },
  ]), routing: JSON.stringify({ unsupported: { lte: 0.2 }, answers_it: { gte: 0.7 } }) }, at(480, 420)),
  { parameters: { respondWith: 'json', responseBody: '={{ { "send": true, "answer": $("Question, source, answer").first().json.answer } }}', options: {} }, name: 'Send the answer', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: at(760, 240) },
  { parameters: { respondWith: 'json', responseBody: '={{ { "send": false, "answer": "I am not sure. A colleague will follow up." } }}', options: {} }, name: 'Hold it back', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: at(760, 420) },
  { parameters: { respondWith: 'json', responseBody: '={{ { "send": false, "review": true } }}', options: {} }, name: 'Ask a person', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: at(760, 600) },
  note('How it works', '## Stop a chatbot from making things up\n\nPOST `{ question, source, answer }` before an answer reaches a customer.\n\nTypeSafe (Jev) answers two yes/no questions with probabilities: does the answer claim anything the source does not say, and does it answer the question.\n\n**Pass** sends it, **Fail** holds it back, **Review** asks a person. Your own TypeSafe key only.', at(160, 40), 500, 280),
], [link('Answer to check', 'Question, source, answer'), link('Question, source, answer', 'TypeSafe'), link('TypeSafe', 'Send the answer', 0), link('TypeSafe', 'Hold it back', 1), link('TypeSafe', 'Ask a person', 2)], [{ name: 'Customer support' }, { name: 'Judge' }]);

T['judge-refund-dispute'] = workflow('Refund-dispute judge (Jev judge)', [
  manual(at(0, 420)),
  code('The dispute', `// Replace with your dispute: the order, what the buyer says, what the seller can show.
return [{ pairedItem: { item: 0 }, json: {
  order: 'Order 1142: wireless headphones, 89 EUR, delivered 2026-09-20',
  complaint: 'The left earbud does not charge. I want a refund.',
  evidence: 'Carrier: delivered and signed 2026-09-20. Seller photo before shipping shows both earbuds at 100 %. No return has been opened.',
} }];`, at(220, 420)),
  typesafe({ state: '={{ JSON.stringify($json) }}', questionsJson: JSON.stringify([
    { id: 'defect_plausible', kind: 'noul', text: 'Given the order, the complaint and the evidence, is a defect on arrival plausible?' },
    { id: 'evidence_contradicts', kind: 'noul', text: 'Does the seller\'s evidence directly contradict the buyer\'s claim?' },
  ]), routing: JSON.stringify({ defect_plausible: { gte: 0.7 }, evidence_contradicts: { lte: 0.3 } }) }, at(480, 420)),
  ...exits('Refund', 'Deny, with the reason', 'A person decides', 420).map((n, i) => ({ ...n, position: at(760, 240 + i * 180) })),
  note('How it works', '## Decide the easy disputes, route the rest\n\nTwo closed questions, each with a probability. Only a clear case leaves by **Refund** or **Deny**. Anything in between goes to **a person**, so no one is refused on a guess.\n\nTune the thresholds in **Routing**. Your own TypeSafe key only.', at(160, 40), 480, 240),
], [link('Start', 'The dispute'), link('The dispute', 'TypeSafe'), link('TypeSafe', 'Refund', 0), link('TypeSafe', 'Deny, with the reason', 1), link('TypeSafe', 'A person decides', 2)], [{ name: 'E-commerce' }, { name: 'Judge' }]);

T['judge-extraction-qa'] = workflow('QA an extraction against its source document (Jev judge)', [
  manual(at(0, 420)),
  code('Document and extraction', `// Replace with your document text and the fields your extractor (OCR, LLM, parser) produced.
return [{ pairedItem: { item: 0 }, json: {
  document: 'INVOICE INV-20931\\nIssued 2026-09-01 by Northwind Parts GmbH\\nTotal due: EUR 1,240.50\\nPayment due by 2026-10-01',
  extracted: { invoice_no: 'INV-20931', total: 1240.5, currency: 'EUR', due_date: '2026-10-01' },
} }];`, at(220, 420)),
  typesafe({ state: '={{ JSON.stringify($json) }}', questionsJson: JSON.stringify([
    { id: 'all_match', kind: 'noul', text: 'Does every extracted value match the document exactly?' },
    { id: 'anything_invented', kind: 'noul', text: 'Is any extracted value absent from the document?' },
  ]), routing: JSON.stringify({ all_match: { gte: 0.85 }, anything_invented: { lte: 0.15 } }) }, at(480, 420)),
  ...exits('Post to accounting', 'Re-extract', 'A person checks it').map((n, i) => ({ ...n, position: at(760, 240 + i * 180) })),
  note('How it works', '## Catch a wrong extraction before it is booked\n\nTypeSafe (Jev) compares the extracted fields with the document and answers with probabilities. Clean rows post automatically; an invented or mismatched value never does.\n\nYour own TypeSafe key only.', at(160, 40), 460, 220),
], [link('Start', 'Document and extraction'), link('Document and extraction', 'TypeSafe'), link('TypeSafe', 'Post to accounting', 0), link('TypeSafe', 'Re-extract', 1), link('TypeSafe', 'A person checks it', 2)], [{ name: 'Finance' }, { name: 'Judge' }]);

T['judge-freelancer-deliverable'] = workflow('Accept or return a freelancer\'s deliverable (Jev judge)', [
  { parameters: { formTitle: 'Submit a deliverable for review', formFields: { values: [
    { fieldLabel: 'Brief', fieldType: 'textarea', requiredField: true },
    { fieldLabel: 'Acceptance criteria (one per line)', fieldType: 'textarea', requiredField: true },
    { fieldLabel: 'Deliverable (text or link contents)', fieldType: 'textarea', requiredField: true },
  ] }, options: {} }, name: 'Deliverable form', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: at(0, 420), webhookId: 'deliverable-form' },
  code('The job', `const f = $input.first().json;
return [{ pairedItem: { item: 0 }, json: {
  ref: 'delivery-' + Date.now(),
  task: f['Brief'],
  criteria: String(f['Acceptance criteria (one per line)'] || '').split('\\n').map((s) => s.trim()).filter(Boolean),
  delivered: f['Deliverable (text or link contents)'],
  checks: { not_empty: !!String(f['Deliverable (text or link contents)'] || '').trim() },
} }];`, at(220, 420)),
  code('What the judge reads', PACK, at(440, 420)),
  typesafe({ state: '={{ $json.state }}', jev: { rubric: true, subject: '={{ $json.ref }}', factsJson: '={{ JSON.stringify($json.facts) }}' } }, at(700, 420)),
  ...exits('Accept: approve the invoice', 'Request changes', 'Escalate to the project lead'),
  note('How it works', '## Review deliverables against the brief\n\nA freelancer submits through the form. Code checks it is not empty; TypeSafe (Jev) checks it against each acceptance criterion, with probabilities.\n\n**Accept**, **Request changes**, or **Escalate** when the answers are unsure. Add an Email node to each exit. Your own TypeSafe key only.', at(200, 40), 500, 260),
], [link('Deliverable form', 'The job'), link('The job', 'What the judge reads'), link('What the judge reads', 'TypeSafe'), ...exitLinks('Accept: approve the invoice', 'Request changes', 'Escalate to the project lead')], [{ name: 'Freelancing' }, { name: 'Judge' }]);

T['judge-bulk-submissions'] = workflow('Grade a batch of submissions (Jev judge)', [
  manual(at(0, 420)),
  code('Submissions', `// One item per submission. To use a Google Sheet, replace this node with Google Sheets: Get Rows
// (columns: ref, task, criteria (one per line), delivered).
const rows = [
  { ref: 'S-1', task: 'Summarise the attached article in three bullet points', criteria: 'Exactly three bullets\\nEach bullet states a claim from the article', delivered: '- Rates rose 0.25 %\\n- Inflation eased to 2.1 %\\n- The bank expects one more cut' },
  { ref: 'S-2', task: 'Summarise the attached article in three bullet points', criteria: 'Exactly three bullets\\nEach bullet states a claim from the article', delivered: '' },
];
return rows.map((r) => ({ json: { ...r, criteria: r.criteria.split('\\n'), checks: { not_empty: !!r.delivered.trim() } } }));`, at(220, 420)),
  { ...code('What the judge reads', PACK.replace('$input.first().json', '$json').replace('return [{ pairedItem: { item: 0 }, json: { ...j, state', 'return { json: { ...j, state').replace('} }];', '} };'), at(440, 420)), parameters: { mode: 'runOnceForEachItem', jsCode: PACK.replace('$input.first().json', '$json').replace('return [{ pairedItem: { item: 0 }, json: { ...j, state', 'return { json: { ...j, state').replace('} }];', '} };') } },
  typesafe({ state: '={{ $json.state }}', jev: { rubric: true, subject: '={{ $json.ref }}', factsJson: '={{ JSON.stringify($json.facts) }}' } }, at(700, 420)),
  ...exits('Complete', 'Reject', 'Needs review'),
  note('How it works', '## Grade many submissions at once\n\nEach row is graded on its own: code checks first, then TypeSafe (Jev) answers the rubric with full probabilities. Every item leaves with its verdict and a receipt.\n\nFor a sheet: read rows with Google Sheets, and write `jev.verdict` and `jev.receipt.receiptHash` back after each exit. Your own TypeSafe key only.', at(200, 40), 520, 260),
], [link('Start', 'Submissions'), link('Submissions', 'What the judge reads'), link('What the judge reads', 'TypeSafe'), ...exitLinks('Complete', 'Reject', 'Needs review')], [{ name: 'Education' }, { name: 'Judge' }]);

T['judge-translation'] = workflow('Check a translation keeps its meaning (Jev judge)', [
  manual(at(0, 420)),
  code('Source and translation', `// Replace with your strings.
return [{ pairedItem: { item: 0 }, json: {
  source_text: 'Refunds are processed within 14 days of receiving the returned item.',
  translation: 'Rückerstattungen werden innerhalb von 14 Tagen nach Eingang des zurückgesandten Artikels bearbeitet.',
  target_language: 'German',
} }];`, at(220, 420)),
  typesafe({ state: '={{ JSON.stringify($json) }}', questionsJson: JSON.stringify([
    { id: 'meaning_kept', kind: 'noul', text: 'Does the translation say the same thing as the source text, with nothing changed?' },
    { id: 'added_or_dropped', kind: 'noul', text: 'Does the translation add or drop any fact, number or condition?' },
  ]), routing: JSON.stringify({ meaning_kept: { gte: 0.8 }, added_or_dropped: { lte: 0.2 } }) }, at(480, 420)),
  ...exits('Publish', 'Send back to the translator', 'A reviewer checks it').map((n, i) => ({ ...n, position: at(760, 240 + i * 180) })),
  note('How it works', '## Catch translations that change the meaning\n\nTypeSafe (Jev) compares source and translation: is the meaning kept, is any fact or number added or dropped. Only a clean translation publishes by itself.\n\nYour own TypeSafe key only.', at(160, 40), 460, 220),
], [link('Start', 'Source and translation'), link('Source and translation', 'TypeSafe'), link('TypeSafe', 'Publish', 0), link('TypeSafe', 'Send back to the translator', 1), link('TypeSafe', 'A reviewer checks it', 2)], [{ name: 'Localisation' }, { name: 'Judge' }]);

T['judge-moderation'] = workflow('Moderate posts against your own rules (Jev judge)', [
  { parameters: { httpMethod: 'POST', path: 'moderate', options: {} }, name: 'New post', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: at(0, 420), webhookId: 'moderate' },
  code('Post and rules', `// POST { post }. Your rules, in your words: each one becomes a yes/no question.
const post = ($input.first().json.body || {}).post || 'Selling my old bike, DM me. Also here is my neighbour\\'s phone: 0171 555 0199';
return [{ pairedItem: { item: 0 }, json: { post, rules: '1. No spam or ads outside the market channel. 2. No harassment. 3. No one else\\'s personal data.' } }];`, at(220, 420)),
  typesafe({ state: '={{ JSON.stringify($json) }}', questionsJson: JSON.stringify([
    { id: 'spam', kind: 'noul', text: 'Is the post spam or an advert?' },
    { id: 'harassment', kind: 'noul', text: 'Does the post harass or insult someone?' },
    { id: 'personal_data', kind: 'noul', text: 'Does the post share another person\'s personal data?' },
  ]), routing: JSON.stringify({ spam: { lte: 0.2 }, harassment: { lte: 0.2 }, personal_data: { lte: 0.2 } }) }, at(480, 420)),
  ...exits('Publish', 'Remove, with the rule it broke', 'A moderator decides').map((n, i) => ({ ...n, position: at(760, 240 + i * 180) })),
  note('How it works', '## Moderate with your rules, not a black box\n\nEach rule is one yes/no question with a probability. A post that clearly breaks a rule is removed with the rule named; a clean one publishes; anything unsure goes to a moderator.\n\nYour own TypeSafe key only.', at(160, 40), 460, 240),
], [link('New post', 'Post and rules'), link('Post and rules', 'TypeSafe'), link('TypeSafe', 'Publish', 0), link('TypeSafe', 'Remove, with the rule it broke', 1), link('TypeSafe', 'A moderator decides', 2)], [{ name: 'Community' }, { name: 'Judge' }]);

for (const [file, w] of Object.entries(T)) writeFileSync(new URL(`./${file}.workflow.json`, import.meta.url), JSON.stringify(w, null, 2) + '\n');
console.log(`wrote ${Object.keys(T).length} judge templates`);
