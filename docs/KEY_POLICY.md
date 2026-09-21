# Key policy and rotation

This node uses **one secret: your TypeSafe API key.**

| | |
|---|---|
| Where it lives | n8n's credential store, encrypted at rest with your instance's `N8N_ENCRYPTION_KEY` |
| Where it travels | from your n8n to `api.typesafe.ai`, as a bearer token over TLS. Nobody else is in the path |
| Where it never goes | workflow JSON, expressions, logs, execution records (HTTP errors are reduced to a status and the service's message, with key-shaped strings redacted, before n8n stores them), or to Taifoon |

**Rotate** it in TypeSafe's console and paste the new value into the credential. Do it on a schedule
(90 days is a reasonable default) and at once if a teammate leaves, a screenshot or log may have shown
it, or a credential test ran on a machine you do not control.

**The Free Trial connection uses no secret of yours.** It sends the item and your questions to
`typesafe.taifoon.dev`, which asks TypeSafe with Taifoon's key: three calls per client, up to 4
questions and 4,000 characters each. Taifoon logs the outcome, the country and the client type, and a
salted hash that lets it count clients. It does not log your address, your item or your questions.
Do not send personal data through the trial; use your own key for real work.

Provisioning a key for a team without anyone seeing it: [Supplying keys securely](SECURE_KEYS.md).
