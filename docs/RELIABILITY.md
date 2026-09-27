# Routing, reliability, cost

## Routing: the one rule

An item leaves by **Pass** only if *every* question you put in Routing passed. So only route the
questions you actually want to gate on. If you route `urgency` as well, a perfectly good refund ticket
"fails" just because it is not urgent. We made exactly that mistake while building this.

| Question | Routing keys | What happens |
|---|---|---|
| Yes / no | `gte`, `lte` on `p` | pass or fail |
| Pick one | `minConfidence`, and `in` for the options you accept | below the confidence → **Review** |
| Rate it | `min`, `max` on the level, and optionally `minConfidence` | pass or fail; below the confidence → **Review** |

A mistake in Routing never reads as a pass. A rule that names a question you did not ask (a typo, a renamed ID), a
yes/no rule with no threshold, or a confidence bar on an answer that carries no confidence all send the item to
**Review**, with the reason in `decisions`.

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
