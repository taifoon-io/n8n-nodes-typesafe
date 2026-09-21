# Key policy and rotation

**Direct connection (the default): one secret.** Your TypeSafe key lives in n8n's encrypted credential store and is sent as a bearer token to `api.typesafe.ai` over TLS. Nobody else is in the path. Rotate it in TypeSafe's console and paste the new value into the credential; that is the whole procedure. Everything below concerns the OPTIONAL Taifoon gateway connection.

Three secrets exist in the gateway system. This page says where each one lives, who can see it, how it is
rotated, and what happens when one leaks. The node itself holds none of them outside n8n's
encrypted credential store.

| Secret | Owner | Lives | Never |
|---|---|---|---|
| **Taifoon principal key** (`tfn_live_…`) | you | n8n credential store (encrypted at rest with your instance's `N8N_ENCRYPTION_KEY`) | in a workflow JSON, an expression, a log, or git |
| **Your TypeSafe key** | you | n8n credential store; sent per request over TLS in `x-typesafe-key` | stored, logged or echoed by Taifoon. It exists on the deck for the duration of one call |
| **The house TypeSafe key** | Taifoon | the deck's 0600 env file on the production host | sent to any browser, node or client. It funds each principal's three trial calls and nothing else |

## What crosses the wire

`POST /api/login {key}` exchanges the principal key for an httpOnly, Secure, SameSite=Lax session
cookie valid for 12 hours. n8n caches that session as an expirable token and logs in again when it is
refused. Every later request carries the cookie and, only for `model: "jev"` after the trial, your
TypeSafe key in one header. Responses never contain a key; the deck's log lines (call and billing)
carry latency, tokens, USD and outcome, and never a key or your state.

## Rotation

**Your TypeSafe key.** Rotate it in TypeSafe's console, paste the new value into the n8n credential,
save. Nothing on Taifoon's side needs updating, because Taifoon never stored the old one. Rotate on a
schedule you would use for any vendor key (90 days is a reasonable default) and immediately on any of:
a teammate leaving, a workflow export shared outside your team, a credential test run on a machine
you do not control.

**Your Taifoon principal key.** Ask the operator to rotate it (`POST /agents/<id>/rotate-key` at the
identity door). The old key stops working at once; existing 12-hour sessions made with it expire on
their own and can be cut short by the operator. Update the n8n credential. Your licence, trial count
and spend ledger are attached to your principal, not to the key string, so they survive rotation.

**The house key.** Taifoon's to rotate: replace it in the deck's env file and restart the deck. Trial
calls pause for the length of the restart. No user action is needed.

## If a key leaks

| Leaked | Blast radius | Do this |
|---|---|---|
| your TypeSafe key | spend on YOUR TypeSafe quota, by anyone, until rotated | rotate in TypeSafe's console now; review their usage page |
| your Taifoon key | calls billed to your Taifoon key up to its DAILY token ceiling; your three trial calls; read access to the deck as you | ask the operator to rotate; the ceiling bounds the damage per day |
| the house key | Taifoon's TypeSafe quota | Taifoon rotates; trial calls resume after |

A Taifoon key cannot be used to read anyone's TypeSafe key: the deck has none to read.

## Policy the deck enforces, so you do not have to trust the node

- The first **three** `jev` calls a principal ever makes are funded by Taifoon. The count is per
  principal, persisted, and a call that fails upstream is handed back.
- After that, a `jev` call needs **both** the `jev` licence on your principal's grant and your own
  TypeSafe key. A missing piece is a `402` that names it. There is no silent fallback to the house key.
- Every call is metered per key **and** per model, persisted across restarts, against a daily ceiling.
- Login throttles: ten refused keys in five minutes from one address rests the door for that window.
- An answer that does not validate is never repaired or defaulted; with **Fail Closed** on (the
  default) the node stops the item instead of passing a null downstream.
