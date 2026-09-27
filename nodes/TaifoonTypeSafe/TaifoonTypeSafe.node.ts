import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, INode, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { decide, reply, translateTask, type AnswerLike, type Lang, type Route } from './translate';
import { answersOf, buildReceipt, inputFor, packOf } from './jev/receipt';
import { defineRubric, RUBRIC_v1, type Facts, type Verdict } from './jev/rubric';
import { record as recordCalls, type Network } from './jev/record';
import { evaluatorCall, type Protocol } from './jev/evaluator/index';

/**
 * TypeSafe for n8n.
 *
 * One service, TypeSafe, reached one way: your own TypeSafe key, straight to api.typesafe.ai.
 * No other account, nothing in the path.
 *
 * The translation layer is code that ships inside this node, so it costs nothing: Translate compiles a plain-language task into typed questions,
 * and Routing turns answers into the Pass / Fail / Review outputs. No dependency, no model call.
 */

interface UiQuestion { id: string; kind: 'noul' | 'choice' | 'score'; text: string; options?: string | string[] | Record<string, string | null>; levels?: string | string[]; yesMeans?: string; noMeans?: string; /** set by Translate: the clause as the person wrote it, echoed by the reply */ source?: string }

/** Options and levels arrive as the UI's delimited text, or as a list when someone pastes natural JSON. */
const split = (s: string | string[] | undefined, sep: RegExp) => (Array.isArray(s) ? s.map(String) : String(s ?? '').split(sep)).map((x) => x.trim()).filter(Boolean);

const REDACT = /(apikey_|tfn_live_|npm_|Bearer\s+)[A-Za-z0-9_.-]+/g;
function safeError(error: unknown): JsonObject {
	const e = error as { httpCode?: string | number; message?: string; description?: string; response?: { status?: number; data?: unknown } };
	const status = e.httpCode ?? e.response?.status ?? 'unknown';
	const said = typeof e.response?.data === 'object' && e.response?.data !== null ? JSON.stringify(e.response.data).slice(0, 300) : String(e.description ?? e.message ?? '').slice(0, 300);
	return { message: `Request failed (${status})`, description: said.replace(REDACT, '$1[redacted]'), httpCode: String(status) };
}

/** n8n words a 402 as "check your payment details", which is unhelpful for a rejected key or an empty account.
 *  For the statuses a person can act on, say what to do next. */
function nextStep(status: number): string | undefined {
	if (status === 401 || status === 403) return 'TypeSafe rejected the key. Check the TypeSafe API credential: the key may have been rotated or revoked at console.typesafe.ai.';
	if (status === 402) return 'TypeSafe reports the account has no credit. Top it up at console.typesafe.ai.';
	return undefined;
}

/** A server that says when to come back is believed, up to 30 s: `Retry-After` in seconds or as an HTTP date. */
function retryAfterMs(error: unknown): number | undefined {
	const headers = (error as { response?: { headers?: Record<string, unknown> } }).response?.headers
		?? (error as { cause?: { response?: { headers?: Record<string, unknown> } } }).cause?.response?.headers;
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	if (raw === undefined || raw === null || raw === '') return undefined;
	const secs = Number(raw);
	const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(String(raw)) - Date.now();
	return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 30000) : undefined;
}

/**
 * A pick-one's options, each with an optional description (TypeSafe sends both to the model, and a description is what
 * separates two options that sound alike). Accepts the form's text, a pasted list, or a pasted {name: description} map.
 * Text: "billing, technical" or "billing = payments and refunds; technical = bugs and outages". Entries are separated by
 * new lines or semicolons when there are any (so a description may contain a comma), otherwise by commas.
 */
function parseOptions(raw: UiQuestion['options']): Array<[string, string | null]> {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.entries(raw).map(([k, v]) => [k.trim(), v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()] as [string, string | null]).filter(([k]) => k);
	const entries = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\n;]/.test(String(raw ?? '')) ? /\s*[\n;]\s*/ : /\s*,\s*/);
	return entries.map((e) => { const at = e.indexOf('='); return (at < 0 ? [e.trim(), null] : [e.slice(0, at).trim(), e.slice(at + 1).trim() || null]) as [string, string | null]; }).filter(([k]) => k);
}

/** TypeSafe asks for exponential backoff on 429 (rate limited) and 529 (overloaded). */
async function withBackoff<T>(node: INode, call: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			const status = Number((error as { httpCode?: string | number; response?: { status?: number } }).httpCode ?? (error as { response?: { status?: number } }).response?.status);
			if ((status === 429 || status === 529) && attempt < 3) {
				await sleep(retryAfterMs(error) ?? 500 * 2 ** attempt);
				continue;
			}
			throw new NodeApiError(node, safeError(error));
		}
	}
}

/** Jev options (1.5.0): all off by default, so an Ask without them behaves exactly as before. */
interface JevOptions { rubric?: boolean; subject?: string; chainId?: number; factsJson?: string | IDataObject; record?: Network; evaluator?: Protocol | 'none'; jobId?: string; evaluatorAddress?: string }
const BRANCH_OF: Record<Verdict, 'pass' | 'fail' | 'review'> = { complete: 'pass', reject: 'fail', needs_review: 'review' };
const VERDICT_OF: Record<string, Verdict> = { pass: 'complete', fail: 'reject', review: 'needs_review' };
function jevFacts(raw: JevOptions['factsJson']): Facts {
	const f = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw ?? {}) as { delivered?: boolean; checks?: Record<string, boolean | null>; priceUsdc?: number | null };
	const checks = Object.fromEntries(Object.entries(f.checks ?? {}).map(([k, v]) => [k, v === true ? true : v === false ? false : null])) as Record<string, boolean | null>;
	const vals = Object.values(checks);
	return { delivered: f.delivered !== false, checksOk: vals.includes(false) ? false : vals.includes(true) ? true : null, checks, priceUsdc: typeof f.priceUsdc === 'number' ? f.priceUsdc : null };
}
/** the receipt, the unsigned record calls and the unsigned evaluator call — nothing is signed or sent here */
async function jevOutput(o: JevOptions, receipt: ReturnType<typeof buildReceipt>): Promise<IDataObject> {
	const rec = o.record && o.record !== 'none' && receipt.decision ? await recordCalls(receipt, { network: o.record }) : null;
	const proto = o.evaluator && o.evaluator !== 'none' ? o.evaluator : null;
	const call = proto && o.jobId ? evaluatorCall(proto, o.jobId, receipt.verdict, receipt.decision?.digest ?? receipt.receiptHash, { to: o.evaluatorAddress || undefined }) : null;
	return { verdict: receipt.verdict, reasons: receipt.reasons, receiptHash: receipt.receiptHash, decisionDigest: receipt.decision?.digest ?? null, answersDigest: receipt.answersDigest,
		...(rec ? { record: { network: rec.network, status: rec.status, calls: rec.calls, notes: rec.notes } } : {}),
		...(proto ? { evaluator: call ?? null } : {}), receipt } as unknown as IDataObject;
}

export class TaifoonTypeSafe implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Taifoon TypeSafe',
		name: 'taifoonTypeSafe',
		icon: { light: 'file:taifoonTypeSafe.svg', dark: 'file:taifoonTypeSafe.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Ask yes/no, pick-one and rate-it questions about any item and route on calibrated answers',
		defaults: { name: 'TypeSafe' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['Pass', 'Fail', 'Review'],
		usableAsTool: true,
		credentials: [
			{ name: 'taifoonTypeSafeApi', required: true, displayOptions: { show: { operation: ['ask'], connection: ['direct'] } } },
		],
		properties: [
			{ displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'ask',
				options: [
					{ name: 'Ask', value: 'ask', action: 'Ask typed questions about an item', description: 'Send an item and a battery of typed questions; route on the answers' },
					{ name: 'Translate', value: 'translate', action: 'Translate a task into typed questions', description: 'Compile a plain-language task into questions. Runs inside the node: free, offline, deterministic.' },
				] },
			{ displayName: 'Connection', name: 'connection', type: 'options', default: 'direct', displayOptions: { show: { operation: ['ask'] } },
				options: [
					{ name: 'Direct to TypeSafe', value: 'direct', description: 'Your own TypeSafe key from console.typesafe.ai. No other account needed.' },
				] },
			{ displayName: 'Model', name: 'model', type: 'string', default: 'jev-1.13.0', displayOptions: { show: { operation: ['ask'] } },
				description: 'The TypeSafe model to ask. Pinned by default so the same item gets the same answers over time; enter jev-latest to follow TypeSafe\'s newest model.' },
			{ displayName: 'Item to Judge', name: 'state', type: 'json', default: '={{ JSON.stringify($json) }}', required: true, displayOptions: { show: { operation: ['ask'] } },
				description: 'Any JSON or text. The default sends the whole incoming item. Do the arithmetic upstream: the model judges, it does not calculate.' },
			{ displayName: 'Questions', name: 'questions', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, placeholder: 'Add Question', displayOptions: { show: { operation: ['ask'] } },
				description: 'Ask every question that might matter in one call: they are answered in parallel and in isolation, so ten cost about what one does',
				options: [{ name: 'question', displayName: 'Question', values: [
					{ displayName: 'ID', name: 'id', type: 'string', default: '', placeholder: 'is_refund', description: 'Lower-case name the answer is returned under' },
					{ displayName: 'Levels', name: 'levels', type: 'string', default: '', placeholder: 'None | Low | Medium | High', displayOptions: { show: { kind: ['score'] } }, description: 'Pipe-separated rubric, lowest first, 2 to 10 levels. Each level is a description: write what that level looks like. The answer is a zero-based position on this list and can land between levels.' },
					{ displayName: 'No Means', name: 'noMeans', type: 'string', default: '', placeholder: 'No urgency expressed', displayOptions: { show: { kind: ['noul'] } }, description: 'Optional. What a "no" means, in your words. Helps when the question alone could be read two ways.' },
					{ displayName: 'Options', name: 'options', type: 'string', default: '', placeholder: 'billing = payments and refunds; technical = bugs and outages; sales', displayOptions: { show: { kind: ['choice'] } }, description: 'The options, 2 to 255, separated by commas. To describe an option write "name = description"; separate the entries with semicolons or new lines if a description contains a comma. Descriptions are sent to the model and are what separates options that sound alike.' },
					{ displayName: 'Question Text', name: 'text', type: 'string', default: '', description: 'One atomic question. Anything that weighs several factors should be several questions.' },
					{ displayName: 'Type', name: 'kind', type: 'options', default: 'noul', options: [
						{ name: 'Choice (Pick One of a Set)', value: 'choice' }, { name: 'Noul (Yes/No as a Probability)', value: 'noul' }, { name: 'Score (Level on a Rubric)', value: 'score' }] },
					{ displayName: 'Yes Means', name: 'yesMeans', type: 'string', default: '', placeholder: 'Explicitly time-sensitive', displayOptions: { show: { kind: ['noul'] } }, description: 'Optional. What a "yes" means, in your words.' },
				] }] },
			{ displayName: 'Questions From Translate (JSON)', name: 'questionsJson', type: 'json', default: '[]', displayOptions: { show: { operation: ['ask'] } },
				description: 'Optional. The "questions" array produced by the Translate operation, for example {{ $JSON.ask.questions }}. Added to the questions above.' },
			{ displayName: 'Routing (JSON)', name: 'routing', type: 'json', default: '{}', displayOptions: { show: { operation: ['ask'] } },
				description: 'Thresholds per question ID, for example {"is_refund": {"gte": 0.7}, "team": {"minConfidence": 0.6}}. Items leave by Pass, Fail or Review. Empty: everything leaves by Pass.' },
			{ displayName: 'Task', name: 'task', type: 'string', typeOptions: { rows: 4 }, default: '', placeholder: 'Check if the customer wants a refund. Classify the ticket into billing, technical, sales or abuse. Rate the urgency from 1 to 5.', displayOptions: { show: { operation: ['translate'] } },
				description: 'What to decide, in plain language. One sentence or list item per decision.' },
			{ displayName: 'Language', name: 'language', type: 'options', default: 'auto', displayOptions: { show: { operation: ['translate'] } },
				description: 'The language the task is written in. Auto detects it per sentence, so a mixed task works.',
				options: [
					{ name: 'Arabic', value: 'ar' }, { name: 'Auto-Detect', value: 'auto' }, { name: 'Dutch', value: 'nl' }, { name: 'English', value: 'en' }, { name: 'French', value: 'fr' }, { name: 'German', value: 'de' },
					{ name: 'Italian', value: 'it' }, { name: 'Japanese', value: 'ja' }, { name: 'Polish', value: 'pl' }, { name: 'Portuguese', value: 'pt' }, { name: 'Russian', value: 'ru' }, { name: 'Spanish', value: 'es' }] },
			{ displayName: 'Reply Language', name: 'replyLanguage', type: 'options', default: 'off', displayOptions: { show: { operation: ['ask'] } },
				description: 'Adds a "reply" to the output: the answers and the verdict as sentences a person can read, for chat surfaces. Match Questions answers in the language the questions were written in. Templates, not a model: free, offline, and the same answers always read the same.',
				options: [
					{ name: 'Arabic', value: 'ar' }, { name: 'Dutch', value: 'nl' }, { name: 'English', value: 'en' }, { name: 'French', value: 'fr' }, { name: 'German', value: 'de' }, { name: 'Italian', value: 'it' },
					{ name: 'Japanese', value: 'ja' }, { name: 'Match Questions', value: 'auto' }, { name: 'Off', value: 'off' }, { name: 'Polish', value: 'pl' }, { name: 'Portuguese', value: 'pt' }, { name: 'Russian', value: 'ru' }, { name: 'Spanish', value: 'es' }] },
			{ displayName: 'Fail Closed', name: 'failClosed', type: 'boolean', default: true, displayOptions: { show: { operation: ['ask'] } },
				description: 'Whether an answer that did not validate stops the item with an error instead of flowing on as a null' },
			{ displayName: 'Jev Options', name: 'jev', type: 'collection', placeholder: 'Add Jev Option', default: {}, displayOptions: { show: { operation: ['ask'] } },
				description: 'Grade with Jev and put the result on chain: a receipt, the unsigned record calls, the unsigned evaluator call. Nothing is signed or sent by this node. Off by default.',
				options: [
					{ displayName: 'Ask RUBRIC_v1', name: 'rubric', type: 'boolean', default: false, description: 'Whether to ask the four RUBRIC_v1 questions (spec_met, unsupported_claim, ending, cheat_shaped) about the item and compose complete / reject / needs_review under THRESHOLDS_v1. A failed fact rejects without asking Jev. Pass = complete, Fail = reject, Review = needs_review.' },
					{ displayName: 'Evaluator Address', name: 'evaluatorAddress', type: 'string', default: '', description: 'The contract the evaluator call goes to, when it is not the protocol default (required for an assurance hook)' },
					{ displayName: 'Evaluator Call', name: 'evaluator', type: 'options', default: 'none', description: 'Adds the unsigned call that ends the job on this protocol, as its evaluator (null for needs_review)',
						options: [
							{ name: 'Assurance Hook', value: 'assurance-hook' }, { name: 'BitAgent ERC-8183', value: 'bitagent-erc8183' }, { name: 'Judge Adapter (Devnet)', value: 'judge-adapter' },
							{ name: 'None', value: 'none' }, { name: 'Virtuals ERC-8183', value: 'virtuals-erc8183' }, { name: 'Virtuals Memo-ACP', value: 'virtuals-memo-acp' }] },
					{ displayName: 'Facts (JSON)', name: 'factsJson', type: 'json', default: '{"delivered": true, "checks": {}}', description: 'The deterministic checks your workflow already made, e.g. {"delivered": true, "checks": {"proof_verifies": true}, "priceUsdc": 5}. A false check is final.' },
					{ displayName: 'Job ID', name: 'jobId', type: 'string', default: '', description: 'The job (or evaluation memo) the evaluator call ends' },
					{ displayName: 'Record On', name: 'record', type: 'options', default: 'none', description: 'Adds the unsigned JevAnswerLog and JevDecisionLog record calls for this receipt, on this network',
						options: [{ name: 'Base', value: 'base' }, { name: 'Both', value: 'both' }, { name: 'Devnet 36927', value: 'devnet' }, { name: 'None', value: 'none' }] },
					{ displayName: 'Subject', name: 'subject', type: 'string', default: '', description: 'What is being graded: the job reference the receipt and the on-chain subject are keyed by' },
					{ displayName: 'Subject Chain ID', name: 'chainId', type: 'number', default: 0, description: 'The chain the subject lives on (0 = off chain)' },
				] },
			{ displayName: 'Raw Output', name: 'rawOutput', type: 'boolean', default: false, displayOptions: { show: { operation: ['ask'] } },
				description: 'Whether to return Jev\'s answer exactly as TypeSafe sends it, with none of this node\'s interpretation. Skips Translate/Routing/Reply and the per-question shaping: the output is the raw {answers, model, usage} the API returned. Use this to get the model\'s own numbers and probabilities untouched and do your own downstream logic. Routing outputs (fail/review) are not produced in raw mode — everything flows on the first output.' },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const pass: INodeExecutionData[] = [];
		const fail: INodeExecutionData[] = [];
		const review: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'translate') {
					const pinned = this.getNodeParameter('language', i, 'auto') as string;
					const { questions, dropped, notes, langs } = translateTask(String(this.getNodeParameter('task', i) ?? ''), 8, pinned === 'auto' ? undefined : (pinned as Lang));
					const runnable = questions.filter((q) => !q.needs_input);
					pass.push({ pairedItem: { item: i }, json: {
						ready: questions.length > 0 && runnable.length === questions.length, deterministic: true, languages: langs, questions, dropped, notes,
						warnings: questions.filter((q) => q.warning).map((q) => ({ id: q.id, warning: q.warning })),
						ask: { questions: runnable.map((q) => ({ id: q.id, kind: q.kind, text: q.text, source: q.source, ...(q.options ? { options: q.options.join(', ') } : {}), ...(q.levels ? { levels: q.levels.join(' | ') } : {}) })),
							// routing is EMPTY on purpose. The branch is the AND of every routed question, so auto-filling
							// thresholds made a calm refund ticket "fail" for not being urgent. Route only what you mean to gate on.
							routing: {} },
						suggestedRouting: Object.fromEntries(runnable.map((q) => [q.id, q.routing])),
						routingNote: 'Copy only the entries you want to gate on into Routing. A score is a ZERO-BASED level index (0 = your first level); see each answer\'s legend.' } as unknown as IDataObject });
					continue;
				}

				const connection = this.getNodeParameter('connection', i) as string;

				// ── ask ──
				const stateRaw = this.getNodeParameter('state', i) as string | IDataObject;
				let state: unknown = stateRaw;
				if (typeof stateRaw === 'string') { try { state = JSON.parse(stateRaw); } catch { state = stateRaw; } }
				const ui = ((this.getNodeParameter('questions', i) as IDataObject).question as unknown as UiQuestion[] | undefined) ?? [];
				const extraRaw = this.getNodeParameter('questionsJson', i, '[]') as string | UiQuestion[];
				const extra = (typeof extraRaw === 'string' ? JSON.parse(extraRaw || '[]') : extraRaw) as UiQuestion[];
				const jev = (this.getNodeParameter('jev', i, {}) as JevOptions) ?? {};
				const jevOn = Object.keys(jev).length > 0;
				const rubricOn = jev.rubric === true;
				const rubricQs: UiQuestion[] = rubricOn ? RUBRIC_v1.asked.map((q) => ({ id: q.id, kind: 'choice', text: q.text, options: q.options.join(', ') })) : [];
				const qs = [...ui, ...(Array.isArray(extra) ? extra : []), ...rubricQs].filter((q) => q?.id && q?.text);
				if (!qs.length) throw new NodeOperationError(this.getNode(), 'Add at least one question', { itemIndex: i });
				const facts = jevOn ? jevFacts(jev.factsJson) : null;
				const subject = { chainId: Number(jev.chainId ?? 0), ref: String(jev.subject || `n8n-item-${i}`) };
				// RUBRIC_v1: the facts decide first (a false check rejects and Jev is not asked); Jev reads the evidence + the facts section
				const input = rubricOn ? inputFor(packOf(state as string | object), facts!) : null;
				if (rubricOn && RUBRIC_v1.compose(facts!, null).forced === 'hard_fail') {
					const receipt = buildReceipt({ rubric: RUBRIC_v1, subject, state: input!.state, jevState: input!.jevState, facts: facts!, answers: null, model: null, connection: 'none', caller: 'n8n' });
					fail.push({ pairedItem: { item: i }, json: { branch: 'fail', jev: await jevOutput(jev, receipt) } });
					continue;
				}
				if (input) state = input.jevState;
				const routingRaw = this.getNodeParameter('routing', i, '{}') as string | IDataObject;
				const routing = (typeof routingRaw === 'string' ? JSON.parse(routingRaw || '{}') : routingRaw) as Record<string, Route>;

				let answers: AnswerLike[] = [];
				let meta: IDataObject = {};
				// The API's response verbatim, kept for Raw Output — the model's own
				// {answers, model, usage}, before any of this node's interpretation.
				let rawRes: IDataObject = {};
				if (connection === 'direct') {
					const cred = await this.getCredentials('taifoonTypeSafeApi');
					const questions: Record<string, IDataObject> = {};
					for (const q of qs) {
						const means = { ...(q.yesMeans?.trim() ? { true: q.yesMeans.trim() } : {}), ...(q.noMeans?.trim() ? { false: q.noMeans.trim() } : {}) };
						questions[q.id] = q.kind === 'choice' ? { type: 'choice', instructions: q.text, criteria: Object.fromEntries(parseOptions(q.options).map(([o, d]) => [o, d ?? o])) }
							: q.kind === 'score' ? { type: 'score', instructions: q.text, criteria: split(q.levels, /\s*\|\s*/) }
							: { type: 'noul', instructions: q.text, ...(Object.keys(means).length ? { criteria: means } : {}) };
					}
					const base = String(cred.baseUrl || 'https://api.typesafe.ai').replace(/\/$/, '');
					// a key is only ever sent over TLS: a typo or a pasted http:// address must not leak it
					if (!/^https:\/\/[^\s/]+/i.test(base)) throw new NodeOperationError(this.getNode(), 'The Base URL in the TypeSafe API credential must start with https://', { itemIndex: i });
					const req: IHttpRequestOptions = { method: 'POST', url: `${base}/v1/systemone`, body: { model: String(this.getNodeParameter('model', i, 'jev-1.13.0') || 'jev-1.13.0'), state, questions }, json: true, timeout: 60000 };
					const started = Date.now();
					const res = (await withBackoff(this.getNode(), () => this.helpers.httpRequestWithAuthentication.call(this, 'taifoonTypeSafeApi', req))) as { model?: string; answers?: Record<string, IDataObject>; usage?: IDataObject };
					rawRes = res as unknown as IDataObject;
					answers = qs.map((q) => {
						const a = (res.answers ?? {})[q.id];
						if (!a) return { id: q.id, kind: q.kind, schema_ok: false, value: null };
						if (q.kind === 'noul') return { id: q.id, kind: q.kind, schema_ok: typeof a.noul === 'number', p: (a.noul as number) ?? null, value: typeof a.noul === 'number' ? (a.noul as number) >= 0.5 : null };
						if (q.kind === 'choice') return { id: q.id, kind: q.kind, schema_ok: typeof a.choice === 'string', value: a.choice ?? null, confidence: (a.confidence as number) ?? null, probabilities: a.probabilities } as AnswerLike;
						return { id: q.id, kind: q.kind, schema_ok: typeof a.score === 'number', value: a.score ?? null, confidence: (a.confidence as number) ?? null, probabilities: a.probabilities, legend: a.legend } as AnswerLike;
					});
					meta = { model: res.model ?? String(this.getNodeParameter('model', i, 'jev-1.13.0')), provider: 'typesafe', connection, latency_ms: Date.now() - started, usage: res.usage ?? {} };
				} else if (connection === 'trial') {
					throw new NodeOperationError(this.getNode(), 'The Free Trial connection was removed in 2.0.0. Create a TypeSafe API credential with your own key from console.typesafe.ai and set Connection to "Direct to TypeSafe".', { itemIndex: i });
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown connection: ${connection}`, { itemIndex: i });
				}

				const schemaOk = answers.every((a) => a.schema_ok !== false);
				if (this.getNodeParameter('failClosed', i) && !schemaOk) {
					throw new NodeOperationError(this.getNode(), 'An answer did not validate; failing closed', { itemIndex: i, description: JSON.stringify(answers.filter((a) => a.schema_ok === false).map((a) => a.id)) });
				}
				// _RAW_OUTPUT_v1_ (1.4.0): return the API's answer verbatim, with NONE of
				// this node's interpretation — no Routing (decide), no Reply (reply), no
				// per-question shaping. The output is exactly {answers, model, usage} as
				// TypeSafe sent it, plus this node's meta. Everything flows on the first
				// output; the fail/review outputs are a Routing feature, and Routing is
				// skipped in raw mode. This is the "--raw" form: the model's own numbers
				// and probabilities, untouched, for callers doing their own downstream logic.
				if (this.getNodeParameter('rawOutput', i, false)) {
					pass.push({ pairedItem: { item: i }, json: { ...meta, schema_ok: schemaOk, raw: rawRes } });
					continue;
				}
				// the backward translation runs HERE, identically on both connections
				const routed = Object.keys(routing).length ? decide(answers, routing) : null;
				let jevOut: IDataObject | null = null;
				if (jevOn) {
					const model = String((rawRes as { upstreamModel?: string }).upstreamModel ?? meta.model ?? '') || null;
					const asked = answers.filter((a) => a.schema_ok !== false).map((a) => ({ id: a.id, value: a.value, confidence: (a as { confidence?: number }).confidence ?? (typeof (a as { p?: number }).p === 'number' ? Math.max((a as { p: number }).p, 1 - (a as { p: number }).p) : 0),
						probabilities: (a as { probabilities?: Record<string, number> }).probabilities ?? (typeof (a as { p?: number }).p === 'number' ? { yes: (a as { p: number }).p, no: 1 - (a as { p: number }).p } : {}) }));
					const rubric = rubricOn ? RUBRIC_v1 : defineRubric({ version: 'n8n-routing.v1', questions: qs.map((q) => ({ id: q.id, text: q.text, options: q.kind === 'choice' ? parseOptions(q.options).map(([o]) => o) : q.kind === 'noul' ? ['yes', 'no'] : split(q.levels, /\s*\|\s*/) })),
						compose: () => { const b = routed?.branch ?? 'pass'; return { verdict: VERDICT_OF[b] ?? 'needs_review', auto: b !== 'review', forced: null, reasons: [`routing branch ${b}`], scores: { spec_met: null, unsupported_claim: null, scope_ok: null, cheat_shaped: null, ending: null, severity: null } }; } });
					const sent = input ?? { state: packOf(state as string | object), jevState: packOf(state as string | object) };
					const receipt = buildReceipt({ rubric, subject, state: sent.state, jevState: sent.jevState, facts: facts!, answers: answersOf(asked), model, connection: 'key', latency_ms: typeof meta.latency_ms === 'number' ? meta.latency_ms : null, caller: 'n8n' });
					jevOut = await jevOutput(jev, receipt);
				}
				const byId: IDataObject = {};
				for (const a of answers) byId[a.id] = a as unknown as IDataObject;
				const replyIn = this.getNodeParameter('replyLanguage', i, 'off') as string;
				const said = replyIn === 'off' ? null : reply(answers, { lang: replyIn === 'auto' ? undefined : (replyIn as Lang), questions: qs.map((q) => ({ id: q.id, text: q.text, source: q.source, levels: q.levels })),
					decisions: routed?.decisions, branch: routed?.branch });
				// with RUBRIC_v1 on and no Routing of your own, the composed verdict picks the output
				const branch = rubricOn && !routed && jevOut ? BRANCH_OF[jevOut.verdict as Verdict] : routed?.branch ?? 'pass';
				const out: INodeExecutionData = { pairedItem: { item: i }, json: { ...meta, schema_ok: schemaOk, answers: byId,
					...(routed ? { decisions: routed.decisions as unknown as IDataObject[], allPass: routed.allPass, branch } : { branch }),
					...(said ? { reply: said as unknown as IDataObject } : {}), ...(jevOut ? { jev: jevOut } : {}) } };
				(branch === 'fail' ? fail : branch === 'review' ? review : pass).push(out);
			} catch (error) {
				if (this.continueOnFail()) { review.push({ json: { error: String((error as Error).message ?? 'request failed').replace(/(apikey_|tfn_live_|Bearer\s+)[A-Za-z0-9_.-]+/g, '$1[redacted]'), branch: 'review' }, pairedItem: { item: i } }); continue; }
				if (error instanceof NodeOperationError) throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i, description: error.description ?? undefined });
				const safe = safeError(error);
				const step = nextStep(Number(safe.httpCode));
				if (step) throw new NodeOperationError(this.getNode(), step, { itemIndex: i, description: String(safe.description ?? '') });
				// never the raw HTTP error: it carries request headers, and n8n stores failed executions
				throw new NodeApiError(this.getNode(), safe, { itemIndex: i });
			}
		}
		return [pass, fail, review];
	}
}
