# Supplying keys securely

Three ways to give this node a TypeSafe key, from simplest to most locked-down. All three keep the
key encrypted at rest and none of them needs a fork of this package.

## 1 · The credential form (most users)

**Credentials → New → TypeSafe API**, paste the key, save. n8n encrypts every credential at rest with
your instance's `N8N_ENCRYPTION_KEY`. The key goes from your browser to your n8n over TLS, and from
your n8n to `api.typesafe.ai` over TLS. Nobody else is in the path, including us.

## 2 · Operator-provisioned, users never see the key (teams)

n8n can pre-fill a credential type for the whole instance from a **secrets file**. Users pick
"TypeSafe API" and it works; the key is never typed, displayed or exported by them.

`credentials-overwrite.json`, **minified** (n8n requires no spaces or newlines), keyed by the
credential TYPE name this package registers:

```json
{"typeSafeApi":{"apiKey":"<your TypeSafe key>","baseUrl":"https://api.typesafe.ai"}}
```

```yaml
# docker-compose.yaml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:<pin a version>
    environment:
      CREDENTIALS_OVERWRITE_DATA_FILE: /run/secrets/n8n_credentials_overwrite
      N8N_ENCRYPTION_KEY_FILE: /run/secrets/n8n_encryption_key
    secrets: [n8n_credentials_overwrite, n8n_encryption_key]
secrets:
  n8n_credentials_overwrite: { file: ./secrets/credentials-overwrite.json }   # chmod 600, never in git
  n8n_encryption_key:        { file: ./secrets/encryption_key }               # chmod 600, BACK IT UP off the host
```

The `_FILE` suffix works on any n8n setting and exists precisely so secrets stay out of environment
variables, which leak into `docker inspect`, process listings, crash dumps and CI logs. On Kubernetes,
mount a `Secret` at the same paths.


## 3 · A vault (n8n Enterprise)

n8n's External Secrets feature reads credentials from HashiCorp Vault, AWS, GCP, Azure or Infisical at
run time. It is an Enterprise feature; if you have it, reference the secret in the credential field
and this node needs no change.

## Why there is no `.env` support inside the node

A node that reads `process.env` or the file system cannot be verified by n8n, and for good reason: a
community package would then be able to read every other secret on your instance. Option 2 gives you
the same operational result (configure once, in a file, outside the UI) through n8n's own mechanism,
with the published package. If you fork the node to read a `.env`, you lose updates and verification
and gain nothing.

## Never send us a key

You do not need to give Taifoon a TypeSafe key, ever. On the direct connection we are not in the path,
and the free trial uses our key, not yours. There is deliberately no form, email address or chat
where we accept keys. If anyone asks you for one in our name, it is not us.

If two organisations ever must hand a secret to each other, do it with public-key encryption to the
recipient (for example [age](https://age-encryption.org): `age -r <recipient public key>`), never in
chat, email, a ticket or a repository, and rotate it afterwards. Prefer not needing to: each side
holding its own vendor key is the design here.

## Rotation and loss

| Event | Do this |
|---|---|
| Routine | Rotate the TypeSafe key in TypeSafe's console every 90 days; update the credential or the secrets file; restart n8n if you use the file. |
| A workflow export, screenshot or log may have shown it | Rotate now. n8n never exports credential values in workflow JSON, but Code nodes and error messages can. |
| Someone with instance access leaves | Rotate the key, and consider rotating `N8N_ENCRYPTION_KEY` (re-save credentials after). |
| `N8N_ENCRYPTION_KEY` is lost | Every stored credential is unreadable. Re-enter them. This is why the key needs an off-host backup. |

This node never writes a key into an execution record: HTTP errors are reduced to a status and the
service's own message, with key-shaped strings redacted, before n8n stores them.
