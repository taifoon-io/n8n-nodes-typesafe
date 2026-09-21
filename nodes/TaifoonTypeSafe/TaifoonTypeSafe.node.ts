import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, INode, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { decide, translateTask, type AnswerLike, type Lang, type Route } from './translate';

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

interface UiQuestion { id: string; kind: 'noul' | 'choice' | 'score'; text: string; options?: string; levels?: string }

const split = (s: string | undefined, sep: RegExp) => String(s ?? '').split(sep).map((x) => x.trim()).filter(Boolean);

const REDACT = /(apikey_|tfn_live_|npm_|Bearer\s+)[A-Za-z0-9_.-]+/g;
function safeError(error: unknown): JsonObject {
	const e = error as { httpCode?: string | number; message?: string; description?: string; response?: { status?: number; data?: unknown } };
	const status = e.httpCode ?? e.response?.status ?? 'unknown';
	const said = typeof e.response?.data === 'object' && e.response?.data !== null ? JSON.stringify(e.response.data).slice(0, 300) : String(e.description ?? e.message ?? '').slice(0, 300);
	return { message: `Request failed (${status})`, description: said.replace(REDACT, '$1[redacted]'), httpCode: String(status) };
}

/** TypeSafe asks for exponential backoff on 429 (rate limited) and 529 (overloaded). */
async function withBackoff<T>(node: INode, call: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			const status = Number((error as { httpCode?: string | number; response?: { status?: number } }).httpCode ?? (error as { response?: { status?: number } }).response?.status);
			if ((status === 429 || status === 529) && attempt < 3) {
				await sleep(500 * 2 ** attempt);
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
			{ name: 'typeSafeApi', required: true, displayOptions: { show: { operation: ['ask'], connection: ['direct'] } } },
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
					{ displayName: 'Levels', name: 'levels', type: 'string', default: '', placeholder: 'None | Low | Medium | High', displayOptions: { show: { kind: ['score'] } }, description: 'Pipe-separated rubric, lowest first, 2 to 10 levels' },
					{ displayName: 'Options', name: 'options', type: 'string', default: '', placeholder: 'billing, technical, sales, abuse', displayOptions: { show: { kind: ['choice'] } }, description: 'Comma-separated, 2 to 50' },
					{ displayName: 'Question Text', name: 'text', type: 'string', default: '', description: 'One atomic question. Anything that weighs several factors should be several questions.' },
					{ displayName: 'Type', name: 'kind', type: 'options', default: 'noul', options: [
						{ name: 'Choice (Pick One of a Set)', value: 'choice' }, { name: 'Noul (Yes/No as a Probability)', value: 'noul' }, { name: 'Score (Level on a Rubric)', value: 'score' }] },
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
						ask: { questions: runnable.map((q) => ({ id: q.id, kind: q.kind, text: q.text, ...(q.options ? { options: q.options.join(', ') } : {}), ...(q.levels ? { levels: q.levels.join(' | ') } : {}) })),
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
					const cred = await this.getCredentials('typeSafeApi');
					const questions: Record<string, IDataObject> = {};
					for (const q of qs) {
						questions[q.id] = q.kind === 'choice' ? { type: 'choice', instructions: q.text, criteria: Object.fromEntries(split(q.options, /\s*,\s*/).map((o) => [o, o])) }
							: q.kind === 'score' ? { type: 'score', instructions: q.text, criteria: split(q.levels, /\s*\|\s*/) }
							: { type: 'noul', instructions: q.text };
					}
					const req: IHttpRequestOptions = { method: 'POST', url: `${String(cred.baseUrl || 'https://api.typesafe.ai').replace(/\/$/, '')}/v1/systemone`, body: { model: 'jev-latest', state, questions }, json: true, timeout: 60000 };
					const started = Date.now();
					const res = (await withBackoff(this.getNode(), () => this.helpers.httpRequestWithAuthentication.call(this, 'typeSafeApi', req))) as { model?: string; answers?: Record<string, IDataObject>; usage?: IDataObject };
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
						...(q.kind === 'choice' ? { options: split(q.options, /\s*,\s*/) } : {}), ...(q.kind === 'score' ? { levels: split(q.levels, /\s*\|\s*/) } : {}) })) });
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
				const out: INodeExecutionData = { pairedItem: { item: i }, json: { ...meta, schema_ok: schemaOk, answers: byId,
					...(routed ? { decisions: routed.decisions as unknown as IDataObject[], allPass: routed.allPass, branch: routed.branch } : { branch: 'pass' }) } };
				(routed?.branch === 'fail' ? fail : routed?.branch === 'review' ? review : pass).push(out);
			} catch (error) {
				if (this.continueOnFail()) { review.push({ json: { error: String((error as Error).message ?? 'request failed').replace(/(apikey_|tfn_live_|Bearer\s+)[A-Za-z0-9_.-]+/g, '$1[redacted]'), branch: 'review' }, pairedItem: { item: i } }); continue; }
				if (error instanceof NodeOperationError) throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i, description: error.description ?? undefined });
				// never the raw HTTP error: it carries request headers, and n8n stores failed executions
				throw new NodeApiError(this.getNode(), safeError(error), { itemIndex: i });
			}
		}
		return [pass, fail, review];
	}
}
