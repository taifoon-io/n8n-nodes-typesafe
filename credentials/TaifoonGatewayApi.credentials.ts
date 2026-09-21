import type { IAuthenticateGeneric, ICredentialDataDecryptedObject, ICredentialTestRequest, ICredentialType, IHttpRequestHelper, INodeProperties } from 'n8n-workflow';

/**
 * Named taifoonGatewayApi, not taifoonApi: Taifoon ships more than one n8n node, and two packages that
 * register the same credential type collide inside one n8n instance.
 *
 * Two secrets, both kept in n8n's own encrypted credential store and nowhere else.
 *
 * The deck authenticates with a principal key exchanged for a short-lived httpOnly session, so this
 * credential uses n8n's expirable-token pattern: `preAuthentication` logs in and n8n caches the
 * session, re-running it when a request is refused.
 *
 * The TypeSafe key is OPTIONAL. Without it the node uses the three trial pings Taifoon funds. With
 * it, the key travels on each request over TLS in `x-typesafe-key`; Taifoon uses it for that one
 * call and does not store or log it.
 */
export class TaifoonGatewayApi implements ICredentialType {
	name = 'taifoonGatewayApi';

	displayName = 'Taifoon Gateway API';

	icon = 'file:taifoon.svg' as const;

	documentationUrl = 'https://deck.taifoon.dev';

	properties: INodeProperties[] = [
		{ displayName: 'Session', name: 'sessionToken', type: 'hidden', typeOptions: { expirable: true, password: true }, default: '' },
		{ displayName: 'Deck URL', name: 'deckUrl', type: 'string', default: 'https://deck.taifoon.dev', description: 'The Taifoon deck that fronts the typed-decision lanes' },
		{ displayName: 'Taifoon Principal Key', name: 'principalKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'Your tfn_live_ key. It identifies you, carries your licence and is what usage is billed to.' },
		{ displayName: 'TypeSafe API Key (Optional)', name: 'typesafeKey', type: 'string', typeOptions: { password: true }, default: '', description: 'Your own key from console.typesafe.ai. Leave empty to use the free trial pings. Needs the jev licence on your Taifoon key.' },
	];

	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		const base = String(credentials.deckUrl || 'https://deck.taifoon.dev').replace(/\/$/, '');
		const res = (await this.helpers.httpRequest({ method: 'POST', url: `${base}/api/login`, body: { key: credentials.principalKey }, json: true, returnFullResponse: true })) as { headers: Record<string, string | string[] | undefined> };
		const raw = res.headers['set-cookie'];
		const cookie = (Array.isArray(raw) ? raw : [String(raw ?? '')]).map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
		return { sessionToken: cookie };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Cookie: '={{$credentials.sessionToken}}', 'x-typesafe-key': '={{$credentials.typesafeKey || undefined}}' } },
	};

	test: ICredentialTestRequest = { request: { baseURL: '={{$credentials.deckUrl}}', url: '/api/typed', method: 'GET' } };
}
