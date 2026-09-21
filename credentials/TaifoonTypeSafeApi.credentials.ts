import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Your own TypeSafe key, used to call TypeSafe DIRECTLY. Nothing but n8n and TypeSafe sees it:
 * it is stored in n8n's encrypted credential store and sent as a bearer token over TLS.
 */
export class TaifoonTypeSafeApi implements ICredentialType {
	// not `typeSafeApi`: n8n core's draft Decision node and other community packages use that name, and
	// credential type names are global to an n8n instance
	name = 'taifoonTypeSafeApi';

	displayName = 'TypeSafe API';

	icon = { light: 'file:taifoon.svg', dark: 'file:taifoon.dark.svg' } as const;

	documentationUrl = 'https://docs.typesafe.ai/introduction/quickstart';

	properties: INodeProperties[] = [
		{ displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'From console.typesafe.ai' },
		{ displayName: 'Base URL', name: 'baseUrl', type: 'string', default: 'https://api.typesafe.ai', description: 'Change only for a private deployment. Must be https: the node refuses to send your key anywhere else.' },
	];

	authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };

	// the cheapest real call: one yes/no question about a three-word state (about 30 input tokens, output is free)
	test: ICredentialTestRequest = {
		request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/systemone', method: 'POST',
			body: { model: 'jev-latest', state: 'the sky is blue', questions: { ok: { type: 'noul', instructions: 'Does the state mention a colour?' } } } },
	};
}
