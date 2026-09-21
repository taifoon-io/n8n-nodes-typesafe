# TypeSafe for n8n

Most automations have a moment where someone has to *decide*: is this a refund request, which team
gets this ticket, how urgent is it, is this invoice a duplicate. Today you either write brittle rules
for that, or you ask a chat model and then fight with its prose: parse the answer, handle the day it
says "It depends", pay for a paragraph you throw away.

This node does the deciding and nothing else. You hand it an item and a few questions. It hands back
answers your workflow can branch on directly, with a probability attached, usually in well under a
second and for about two thousandths of a cent.

It works by calling [TypeSafe's Jev](https://docs.typesafe.ai/introduction), a model built to make
decisions rather than write text. You need a TypeSafe API key, which you get from
[console.typesafe.ai](https://console.typesafe.ai). That is the only account involved: the node talks
to TypeSafe directly, and nobody else, including us, is in the path.

```
item ──► TypeSafe ──► Pass      confident, and it cleared your thresholds
                 ├──► Fail      confident, and it did not
                 └──► Review    unsure, or the answer did not validate: send this to a person
```

## Who this is for

- **Support and ops teams** routing tickets, emails and alerts without maintaining a wall of IF nodes.
- **Anyone putting an LLM in a workflow** who wants a cheap, fast guard in front of it or behind it:
  is this input safe, is this output on topic, does it contain personal data.
- **Builders of data pipelines** who need to classify, de-duplicate or score thousands of rows and
  cannot afford, or wait for, a chat model on each one.
- **People who do not trust a yes/no without a number.** Every answer comes with how sure the model
  is, so the uncertain cases go to a human instead of going wrong quietly.

It is not for writing text, summarising, or reasoning about code. We measured that honestly; see
[What it is good and bad at](#what-it-is-good-and-bad-at).

## Three kinds of question

| You ask | You get back | Think of it as |
|---|---|---|
| **Yes / no** ("Noul") | `p`, the probability the statement is true | an IF with a dial |
| **Pick one** ("Choice") | the option, a probability for every option, and a `confidence` | a Switch that knows when it is guessing |
| **Rate it** ("Score") | a level on a rubric you write, and a `confidence` | a ranking you can threshold |

Ask all the questions that might matter in the same node. They are answered at once and independently,
so ten questions cost about the same as one.

## Install

In self-hosted n8n: **Settings → Community Nodes → Install**, then enter `@taifoon/n8n-nodes-typesafe`.

Create a **TypeSafe API** credential and paste your key. The test button makes one tiny real call, so
you find out immediately whether the key works. Running n8n for a team? You can provision the key from a
secrets file so nobody ever sees it: [Supplying keys securely](docs/SECURE_KEYS.md).

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

## Do not want to write the questions? Describe the job

The **Translate** operation turns a sentence into questions:

> *Check if the customer is asking for a refund. Classify the ticket into billing, technical, sales or
> abuse. Rate the urgency from 1 to 5.*

becomes a yes/no, a pick-one with exactly those four options, and a five-level rating. It runs inside
the node: no network call, no key, no cost, and the same sentence always gives the same result.

It understands **English, Spanish, German, French, Portuguese, Italian, Polish and Dutch**, detects the
language per sentence, and you can mix them in one task. Anything else still works as a yes/no.

It is deliberately literal. It will not invent categories you did not name: *"classify this ticket"*
with no list comes back flagged `needs_input`. It suggests thresholds but never applies them for you,
for the reason in the next section.

## The one rule about routing

An item leaves by **Pass** only if *every* question you put in Routing passed. So only route the
questions you actually want to gate on. If you route `urgency` as well, a perfectly good refund ticket
"fails" just because it is not urgent. We made exactly that mistake while building this.

| Question | Routing keys | What happens |
|---|---|---|
| Yes / no | `gte`, `lte` on `p` | pass or fail |
| Pick one | `minConfidence`, and `in` for the options you accept | below the confidence → **Review** |
| Rate it | `min`, `max` on the level | pass or fail |

Two details: a rating is a **zero-based level number** (0 is your first level; every answer includes a
`legend`), and an answer that does not validate always goes to Review. Nothing fails open.

## What it is good and bad at

We benchmarked it against Claude Sonnet, and the results are mixed in a useful way:

- **Answering a real system's yes/no checks:** it matched or beat Sonnet on every decision.
- **Forecasting next-day rain from two days of weather:** a tie (81% against 78%), and neither clearly
  beat the naive "same as today".
- **Judging claims about small Python functions:** Sonnet got 100%, this got 83%. It is not a code
  reasoner.

In all three it was about **ten times faster and a thousand times cheaper**. Its raw probabilities were
the less well calibrated of the two, which is the practical reason to **fit your thresholds on a few
dozen of your own labelled items** before trusting them.

## Habits that keep it reliable

- **Calculate first, then ask.** Do arithmetic in a Code node. Ask the model for judgment, never a sum.
- **One thing per question.** If a question weighs several factors, split it and combine the answers
  yourself, with weights you can see.
- **Keep thresholds on the canvas,** where they can be reviewed and changed, not inside a prompt.
- **Leave Fail Closed on.** A malformed answer stops the item instead of flowing on as an empty value.
- **Remember what n8n stores.** By default n8n keeps every execution's data. If your items contain
  personal data, set `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` on your instance. This node never writes
  your key into an execution record, including when a request fails.

## Cost and limits

About 0.6 to 0.8 s and 450 input tokens for three questions. TypeSafe charges 0.042 USD per million
input tokens and nothing for output: roughly 0.00002 USD per item. Rate limits and overload responses
are retried with backoff. Input is text or JSON; no images or audio.

## More

[Supplying keys securely](docs/SECURE_KEYS.md) · [Workflow patterns](docs/WORKFLOWS.md) ·
[How Translate works, rule by rule](docs/TRANSLATION.md) · [Key policy and rotation](docs/KEY_POLICY.md)

The node also has an optional second connection to the Taifoon gateway, for teams who want metering and
open-weights models alongside Jev. You do not need it, and it is documented in
[Key policy](docs/KEY_POLICY.md) rather than here.

## Licence

MIT. An independent community node by [Taifoon](https://github.com/taifoon-io). TypeSafe and Jev are
trademarks of TypeSafe AI; this project is not affiliated with or endorsed by TypeSafe AI.
