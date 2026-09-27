# TypeSafe for n8n

An n8n community node for structured decisions with [TypeSafe's Jev](https://docs.typesafe.ai/introduction), a
System One model. Ask Noul (yes/no), Choice (pick one) and Score (rate it) questions about any item. Every answer
carries a probability. The node routes each item to **Pass**, **Fail** or **Review**, so uncertain cases go to a
person instead of going wrong quietly.

Use it to route tickets, classify rows, guard an LLM's input or output, or gate an agent's tool call for approval.
It is not for writing text, summarising, or reasoning about code.

```
item ──► TypeSafe ──► Pass      confident, and it cleared your thresholds
                 ├──► Fail      confident, and it did not
                 └──► Review    unsure, or the answer did not validate: send this to a person
```

## Install

In self-hosted n8n: **Settings → Community Nodes → Install**, then enter `@taifoon/n8n-nodes-typesafe`.

Get a TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai) and create a
**TypeSafe API** credential. The test button makes one tiny real call, so you know at once whether the key works.
The node talks to TypeSafe directly with your key, and nobody else, including us, is in the path.

Running n8n for a team? [Supply the key from a secrets file](docs/SECURE_KEYS.md). Upgrading from 1.1 or
earlier? The credential type was renamed: [Upgrading](docs/UPGRADING.md).

## Try it in two minutes

1. Add a **Manual Trigger** and an **Edit Fields** node with a `subject` and a `body`: paste in any
   support email.
2. Add **TypeSafe**, operation **Ask**. Leave *Item to Judge* alone; it already sends the whole item.
   Add three questions:
   - `is_refund` · Yes/no · *Is the customer asking for money back?*
   - `team` · Pick one · *Which team should handle this?* · `billing, technical, sales, abuse`
   - `urgency` · Rate it · *How urgent is this?* · `None | Low | Medium | High`
3. Run it. You get `answers.is_refund.p`, `answers.team.value`, `answers.urgency.value`.
4. Now make it branch. In **Routing** put `{"team": {"minConfidence": 0.6}}`. Tickets the model is sure
   about leave by **Pass**; the ones it is unsure about leave by **Review**. Wire Review to a person.

Ready-made versions are in [`examples/`](examples).

## Three kinds of question

| You ask | You get back | Think of it as |
|---|---|---|
| **Yes / no** ("Noul") | `p`, the probability the statement is true | an IF with a dial |
| **Pick one** ("Choice") | the option, a probability for every option, and a `confidence` | a Switch that knows when it is guessing |
| **Rate it** ("Score") | a level on a rubric you write, and a `confidence` | a ranking you can threshold |

Describe the options, and add an `other`, to sharpen a Choice. Ask every question that might matter in one node:
they are answered at once and independently, so ten cost about the same as one.

## What you must know

- **Route only what you gate on.** An item leaves by **Pass** only if *every* routed question passed. Route
  `urgency` too, and a good refund ticket "fails" for not being urgent.
- **Nothing fails open.** A Routing mistake, or an answer that does not validate, sends the item to **Review**.
- **A rating is a zero-based level number.** 0 is your first level; every answer includes a `legend`.
- **Fit thresholds on your own items.** Label a few dozen before you trust them. The raw probabilities are
  not calibrated on your data.
- **Calculate first, then ask.** Do arithmetic in a Code node. Ask the model for judgment, never a sum.
- **Leave Fail Closed on.** A malformed answer then stops the item instead of flowing on as an empty value.

Cost: about 0.6 to 0.8 s and 450 input tokens for three questions. TypeSafe charges 0.042 USD per million input
tokens and nothing for output: roughly 0.00002 USD per item. Input is text or JSON; no images or audio.

## More operations and options

- **Translate** turns a sentence into questions, in eleven languages, offline and free.
  [How Translate works](docs/TRANSLATION.md)
- **Reply Language** says the answers back as sentences in the asker's language. **Raw Output** returns
  TypeSafe's answer untouched. [Reply and Raw Output](docs/OUTPUTS.md)
- **Jev Options** grade an agent job under RUBRIC_v1 and return unsigned on-chain calls.
  [Jev Options](docs/JEV_OPTIONS.md), and the standalone package [`@taifoon/jev`](https://github.com/taifoon-io/jev).

## Documentation

- [How it works, and who it is for](docs/HOW_IT_WORKS.md)
- [Routing, reliability, cost and benchmark](docs/RELIABILITY.md)
- [Workflow patterns](docs/WORKFLOWS.md)
- [TypeSafe over MCP, and an approval gate for agent tool calls](docs/MCP.md)
- [Basic trading tasks, with gates](docs/TRADING_EXAMPLES.md) and [in eleven languages](docs/TRADING_GATES.md)
- [Supplying keys securely](docs/SECURE_KEYS.md) · [Key policy and rotation](docs/KEY_POLICY.md)

This package integrates one service: TypeSafe. It is published from GitHub Actions with an npm provenance
statement, and every release must pass n8n's community-package scanner.

## Licence

Independent project. Jev and TypeSafe are products of TypeSafe AI, Inc., which does not endorse this package.

MIT. An independent community node by [Taifoon](https://github.com/taifoon-io). TypeSafe and Jev are
trademarks of TypeSafe AI; this project is not affiliated with or endorsed by TypeSafe AI.
