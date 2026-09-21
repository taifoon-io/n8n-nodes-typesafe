# TypeSafe over MCP

A remote MCP server for typed decisions, for clients that speak MCP instead of installing a node:
n8n's **MCP Client** node (it works on n8n Cloud, where community nodes may not be installable), hosted
agents, Claude. It is a separate service run by Taifoon, not part of this npm package.

```
URL        https://typesafe.taifoon.dev/mcp
Transport  HTTP Streamable (stateless: one POST, one JSON answer)
Auth       Bearer = your own TypeSafe key (console.typesafe.ai), or none for 3 free calls
```

| tool | what it does | model call |
|---|---|---|
| `typesafe_translate` | a plain-language task becomes typed questions; eleven languages; never invents options | none, free, no key |
| `typesafe_ask` | typed questions about a `state`; optional `routing` gives pass, fail or review; optional `reply_language` says the answers back as sentences | one |
| `typesafe_gate` | an approval gate before a tool call: `allow`, `deny` or `review` | one |

## In n8n

Add an **MCP Client** node: *Server Transport* HTTP Streamable, *Endpoint* `https://typesafe.taifoon.dev/mcp`,
*Authentication* Bearer Auth with a credential holding your TypeSafe key, pick a tool. The answer arrives under
`structuredContent`, for example `{{ $json.structuredContent.verdict }}`.

Ready to import: [`examples/approval-gate-mcp.workflow.json`](../examples/approval-gate-mcp.workflow.json).
The same gate built with this package's node, which calls TypeSafe directly:
[`examples/approval-gate-node.workflow.json`](../examples/approval-gate-node.workflow.json).

## The approval gate, from a real run

Four proposed tool calls, with the context "the user asked the agent to tidy up the project folder":

| proposed call | p(safe) | p(hard to undo) | verdict |
|---|---|---|---|
| `read_file ./README.md` | 0.96 | 0.01 | **allow** |
| `move_file notes.txt -> archive/` | 0.84 | 0.19 | **review**: under `allow_at` 0.9 |
| `run_sql DROP DATABASE customers` | 0.01 | 0.98 | **deny** |
| `send_email` to every customer | 0.01 | 0.98 | **deny** |

Each answer took 0.25 to 0.6 s and about 430 input tokens, roughly 0.00002 USD.

The rule: `allow` needs p(safe) at or over `allow_at` (default 0.9) and an action that is not hard to undo;
p(safe) at or under `deny_at` (default 0.3) is `deny`; everything else is `review`, including an answer that
did not validate and an outage. A gate that did not hear a clear answer does not allow. The node version of
the same workflow asks a pick-one question instead and let the file move through at 99% confidence: the two
are different instruments, so choose one and check its thresholds against your own examples. These are raw
model probabilities, not guarantees.

## What the server sees, and keeps

Your key crosses the server on its way to TypeSafe, over TLS. It is used for that one call and dropped:
never written, never logged, never returned. Logs hold the tool name, the outcome, a salted hash of the
caller, the country and the client product; never the key, the address, the state or a question's text.
If you would rather have nobody in the path, use this package's node with the direct connection.

Limits: 60 requests a minute per address. With a key: 20 questions and a 32,000-character state per call.
Without: 4 questions, 4,000 characters, 3 calls in total, shared with the node's Free Trial connection.
