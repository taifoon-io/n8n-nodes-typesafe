import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, INode, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { decide, reply, translateTask, type AnswerLike, type Lang, type Route } from './translate';

/**
 * TypeSafe for n8n.
 *
 * One service, TypeSafe, reached two ways:
 *   direct    your own TypeSafe key, straight to api.typesafe.ai. No other account, nothing in the path.
 *   trial     three free calls with no key, funded by Taifoon, so a newcomer can see a real answer first.
 *
 * The translation layer is code that ships inside this node, so it behaves identically on both
 * connections and costs nothing: Translate compiles a plain-language task into typed questions,
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

/** n8n words a 402 as "check your payment details", which is wrong for a free trial and unhelpful for a
 *  rejected key. For the statuses a person can act on, say what to do next. */
function nextStep(status: number, connection: string): string | undefined {
	if (connection === 'trial') {
		if (status === 402) return 'The free calls for this server are used up. Create a TypeSafe API credential with your own key from console.typesafe.ai and switch Connection to "Direct to TypeSafe".';
		if (status === 413 || status === 400) return 'The free trial takes up to 4 questions and 4,000 characters per call. Send less, or use your own key.';
		if (status === 429) return 'The free trial is busy. Wait a minute, or use your own key.';
		return undefined;
	}
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

/** The free trial needs no credential, so it lives outside execute(): n8n's lint (rightly) forbids an
 *  unauthenticated httpRequest inside a function that also reads credentials. */
const TRIAL_URL = 'https://typesafe.taifoon.dev/v1/trial';
async function askTrial(ctx: IExecuteFunctions, body: IDataObject): Promise<IDataObject> {
	return (await ctx.helpers.httpRequest({ method: 'POST', url: TRIAL_URL, body, json: true, timeout: 60000 })) as IDataObject;
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
					{ name: 'Direct to TypeSafe', value: 'direct', description: 'Your own TypeSafe key. No other account needed.' },
					{ name: 'Free Trial (3 Calls, No Key)', value: 'trial', description: 'Three real answers with no account and no key, paid for by Taifoon. Up to 4 questions and 4,000 characters per call.' },
				] },
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
				const qs = [...ui, ...(Array.isArray(extra) ? extra : [])].filter((q) => q?.id && q?.text);
				if (!qs.length) throw new NodeOperationError(this.getNode(), 'Add at least one question', { itemIndex: i });
				const routingRaw = this.getNodeParameter('routing', i, '{}') as string | IDataObject;
				const routing = (typeof routingRaw === 'string' ? JSON.parse(routingRaw || '{}') : routingRaw) as Record<string, Route>;

				let answers: AnswerLike[] = [];
				let meta: IDataObject = {};
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
					const req: IHttpRequestOptions = { method: 'POST', url: `${base}/v1/systemone`, body: { model: 'jev-latest', state, questions }, json: true, timeout: 60000 };
					const started = Date.now();
					const res = (await withBackoff(this.getNode(), () => this.helpers.httpRequestWithAuthentication.call(this, 'taifoonTypeSafeApi', req))) as { model?: string; answers?: Record<string, IDataObject>; usage?: IDataObject };
					answers = qs.map((q) => {
						const a = (res.answers ?? {})[q.id];
						if (!a) return { id: q.id, kind: q.kind, schema_ok: false, value: null };
						if (q.kind === 'noul') return { id: q.id, kind: q.kind, schema_ok: typeof a.noul === 'number', p: (a.noul as number) ?? null, value: typeof a.noul === 'number' ? (a.noul as number) >= 0.5 : null };
						if (q.kind === 'choice') return { id: q.id, kind: q.kind, schema_ok: typeof a.choice === 'string', value: a.choice ?? null, confidence: (a.confidence as number) ?? null, probabilities: a.probabilities } as AnswerLike;
						return { id: q.id, kind: q.kind, schema_ok: typeof a.score === 'number', value: a.score ?? null, confidence: (a.confidence as number) ?? null, probabilities: a.probabilities, legend: a.legend } as AnswerLike;
					});
					meta = { model: res.model ?? 'jev-latest', provider: 'typesafe', connection, latency_ms: Date.now() - started, usage: res.usage ?? {} };
				} else if (connection === 'trial') {
					const res = await askTrial(this, { state: state as IDataObject, questions: qs.map((q) => ({ id: q.id, kind: q.kind, text: q.text,
						...(q.kind === 'choice' ? { options: Object.fromEntries(parseOptions(q.options)) } : {}), ...(q.kind === 'score' ? { levels: split(q.levels, /\s*\|\s*/) } : {}),
						...(q.kind === 'noul' && q.yesMeans?.trim() ? { yes_means: q.yesMeans.trim() } : {}), ...(q.kind === 'noul' && q.noMeans?.trim() ? { no_means: q.noMeans.trim() } : {}) })) });
					answers = (res.answers as unknown as AnswerLike[]) ?? [];
					meta = { model: res.model, provider: 'typesafe', connection, latency_ms: res.latency_ms, usage: res.usage, trial: res.trial, next: res.next };
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown connection: ${connection}`, { itemIndex: i });
				}

				const schemaOk = answers.every((a) => a.schema_ok !== false);
				if (this.getNodeParameter('failClosed', i) && !schemaOk) {
					throw new NodeOperationError(this.getNode(), 'An answer did not validate; failing closed', { itemIndex: i, description: JSON.stringify(answers.filter((a) => a.schema_ok === false).map((a) => a.id)) });
				}
				// the backward translation runs HERE, identically on both connections
				const routed = Object.keys(routing).length ? decide(answers, routing) : null;
				const byId: IDataObject = {};
				for (const a of answers) byId[a.id] = a as unknown as IDataObject;
				const replyIn = this.getNodeParameter('replyLanguage', i, 'off') as string;
				const said = replyIn === 'off' ? null : reply(answers, { lang: replyIn === 'auto' ? undefined : (replyIn as Lang), questions: qs.map((q) => ({ id: q.id, text: q.text, source: q.source, levels: q.levels })),
					decisions: routed?.decisions, branch: routed?.branch });
				const out: INodeExecutionData = { pairedItem: { item: i }, json: { ...meta, schema_ok: schemaOk, answers: byId,
					...(routed ? { decisions: routed.decisions as unknown as IDataObject[], allPass: routed.allPass, branch: routed.branch } : { branch: 'pass' }),
					...(said ? { reply: said as unknown as IDataObject } : {}) } };
				(routed?.branch === 'fail' ? fail : routed?.branch === 'review' ? review : pass).push(out);
			} catch (error) {
				if (this.continueOnFail()) { review.push({ json: { error: String((error as Error).message ?? 'request failed').replace(/(apikey_|tfn_live_|Bearer\s+)[A-Za-z0-9_.-]+/g, '$1[redacted]'), branch: 'review' }, pairedItem: { item: i } }); continue; }
				if (error instanceof NodeOperationError) throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i, description: error.description ?? undefined });
				const safe = safeError(error);
				const step = nextStep(Number(safe.httpCode), String(this.getNodeParameter('connection', i, 'direct')));
				if (step) throw new NodeOperationError(this.getNode(), step, { itemIndex: i, description: String(safe.description ?? '') });
				// never the raw HTTP error: it carries request headers, and n8n stores failed executions
				throw new NodeApiError(this.getNode(), safe, { itemIndex: i });
			}
		}
		return [pass, fail, review];
	}
}
