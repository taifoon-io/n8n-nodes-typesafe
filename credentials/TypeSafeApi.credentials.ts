import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Your own TypeSafe key, used to call TypeSafe DIRECTLY. Nothing but n8n and TypeSafe sees it:
 * it is stored in n8n's encrypted credential store and sent as a bearer token over TLS.
 */
export class TypeSafeApi implements ICredentialType {
	name = 'typeSafeApi';

	displayName = 'TypeSafe API';

	icon = { light: 'file:taifoon.svg', dark: 'file:taifoon.dark.svg' } as const;

	documentationUrl = 'https://docs.typesafe.ai/introduction/quickstart';

	properties: INodeProperties[] = [
		{ displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'From console.typesafe.ai' },
		{ displayName: 'Base URL', name: 'baseUrl', type: 'string', default: 'https://api.typesafe.ai', description: 'Change only for a proxy or a private deployment' },
	];

	authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };

	// the cheapest real call: one yes/no question about a three-word state (about 30 input tokens, output is free)
	test: ICredentialTestRequest = {
		request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/systemone', method: 'POST',
			body: { model: 'jev-latest', state: 'the sky is blue', questions: { ok: { type: 'noul', instructions: 'Does the state mention a colour?' } } } },
	};
}
