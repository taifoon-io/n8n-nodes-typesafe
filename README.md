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

## The idea: three systems, each doing the one thing it is good at

```
   n8n                      Taifoon                         TypeSafe
   the workflow             the coordination layer          the judge
   ─────────────            ──────────────────────          ─────────
   gathers the item    ──►  turns your words into      ──►  answers each question
   runs the branches        typed questions                 with a probability
        ▲                   turns the answers back    ◄──
        └────────────────   into Pass / Fail / Review,
                            and into sentences in the
                            asker's own language
```

- **n8n** is where your process already lives: the triggers, the data, the people who get notified.
  It is good at moving things and bad at judgment.
- **TypeSafe** is a model that only judges. It cannot write an essay, which is the point: it returns
  a number you can threshold, quickly and cheaply, instead of prose you have to interpret.
- **Taifoon's part is the layer between them**, and it is plain code that ships inside this node. Going
  in, it compiles what you mean ("is this a refund?") into the three question types the model
  understands. Coming out, it compiles the model's probabilities into the only three things a workflow
  can act on: go ahead, do not, or ask a human. Every threshold in that step is yours and sits on the
  canvas where you can see it. And when a person is waiting on the other end, it says the answers back
  as sentences in the language they wrote in.

Why three outputs and not two: a yes/no forces a confident answer even when the model is guessing, and
that is how automations go wrong silently. **Review** is the honest third option. It is where the
low-confidence cases and the malformed answers go, so a person sees exactly the items that need one.

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

Two things make the answers sharper, and both are optional:

- **Describe the options.** Write `billing = payments and refunds; technical = bugs and outages; other = fits none`.
  The descriptions go to the model and are what separates options that sound alike. Add an `other`: a message
  that fits nowhere is then answered *other* with confidence, instead of being forced into a team.
- **Say what yes and no mean.** A yes/no question has *Yes Means* and *No Means* fields for where the line is.

Ask all the questions that might matter in the same node. They are answered at once and independently,
so ten questions cost about the same as one.

## Install

In self-hosted n8n: **Settings → Community Nodes → Install**, then enter `@taifoon/n8n-nodes-typesafe`.

**No key yet?** Pick the **Free Trial** connection: three real answers with no account and no key, on us
(up to 4 questions and 4,000 characters per call). It exists so you can see a real result before signing
up anywhere.

When you are ready, create a **TypeSafe API** credential and paste your key. The test button makes one tiny real call, so
you find out immediately whether the key works. Running n8n for a team? You can provision the key from a
secrets file so nobody ever sees it: [Supplying keys securely](docs/SECURE_KEYS.md).

**Upgrading from 1.1 or earlier?** The credential type was renamed (from `typeSafeApi` to
`taifoonTypeSafeApi`) so it cannot collide with other TypeSafe packages or a future built-in node. After
updating, create the **TypeSafe API** credential again and select it in your TypeSafe nodes. Nothing else
changed. If you pre-fill credentials from a file, use the new name as the key
([Supplying keys securely](docs/SECURE_KEYS.md)).

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

It understands **English, Spanish, German, French, Portuguese, Italian, Polish, Dutch, Russian, Japanese
and Arabic**, detects the language per sentence, and you can mix them in one task. Anything else still
works as a yes/no.

**Your language is not here? Please add it.** A language is one small word pack in
[`nodes/TaifoonTypeSafe/translate.ts`](nodes/TaifoonTypeSafe/translate.ts): the verbs that mean "pick
one", the words that mean "rate it", how options are introduced and separated, how a scale is written,
and a four-level default rubric. No logic changes. Add the pack, add one test sentence to the self-test,
open a pull request. Native speakers catch what we cannot: we would especially welcome Chinese, Korean,
Hindi, Turkish, Ukrainian, Swedish, Hebrew and Indonesian, and corrections to the eleven we ship.

It splits a sentence that holds several jobs (*check if it is a refund and rate the urgency*), keeps the levels you
name (*rate the tone as polite, neutral or rude*) and reads *from 5 to 1* as the 1 to 5 scale. When it cannot do what
you wrote it says so in `warnings` rather than substituting quietly: a *0 to 10* scale has eleven steps and a rating
takes at most ten, and *is the customer new or returning?* asked as a yes/no answers whether EITHER holds, not which.

It is deliberately literal. It will not invent categories you did not name: *"classify this ticket"*
with no list comes back flagged `needs_input`. It suggests thresholds but never applies them for you,
for the reason in the next section.

## Answering people in their own language

Branches are for workflows. When a person is waiting for the answer (a support chat, a Telegram bot, a
trading assistant), `{"noul": 0.97}` is no use to them. Set **Reply Language** on the Ask operation and
the output gains a `reply`:

```json
{ "lang": "de", "flagHuman": true,
  "text": "Prüfe, ob die Volatilität ungewöhnlich hoch ist. Ja (94 % sicher)\n? Bewerte die Dringlichkeit ... Vermutlich 4 (4 von 5), aber unsicher (36 %)\nNicht sicher genug: Ich gebe das an einen Menschen weiter.",
  "lines": [{ "id": "...", "question": "...", "answer": "...", "outcome": "review" }], "verdict": "..." }
```

- **Match Questions** answers in the language the questions were written in, so one workflow serves
  every customer. Or pin a language: English questions, Polish answers.
- It is templates, not a model: free, offline, and the same answers always read the same. The person's
  own sentence, options and rubric levels are echoed exactly as they wrote them; only the glue around
  them is translated, so nothing is paraphrased and nothing is invented.
- It never rounds doubt away. A coin-flip reads as *hard to say*, not yes. A rating the model is spread
  across reads as *probably 4, but not sure*. And when anything went to Review, `flagHuman` is true and the
  last line says a person is taking over. Wire that to a person, do not soften it.

The same eleven languages as Translate, and the same request: a voice is one row of thirteen short
strings in [`translate.ts`](nodes/TaifoonTypeSafe/translate.ts). Native speakers, please correct ours.

## Raw output: the model's own numbers, untouched

Everything above — Routing, Reply, the per-question shaping — is this node interpreting the answer for
you. When you would rather do that yourself, turn on **Raw Output** on the Ask operation. The node then
returns the API's answer *exactly as TypeSafe sent it*, with none of its interpretation:

```json
{ "model": "jev-latest", "provider": "typesafe", "connection": "direct", "latency_ms": 812,
  "usage": { "input_tokens": 545 },
  "raw": { "model": "jev-latest",
    "answers": {
      "is_refund":   { "noul": 0.98 },
      "urgency":     { "score": 3.6, "confidence": 0.41, "probabilities": [ ... ], "legend": [ ... ] },
      "which_lane":  { "choice": "billing", "confidence": 0.77, "probabilities": { "billing": 0.77, "shipping": 0.19, "other": 0.04 } }
    } } }
```

- **No Routing, no Reply, no reshaping.** `raw` is the whole `{answers, model, usage}` object the model
  returned. The probabilities, confidences and `noul`/`score`/`choice` values are the model's own — this
  is the `--raw` form for when you want the raw calibration to feed your own logic, a training set, or a
  model that learns from Jev's best cases.
- **Everything flows on the first output.** The fail/review outputs are a Routing feature, and Routing
  is skipped in raw mode, so nothing is split off.
- Works on both connections (your key and the free trial). `Fail Closed` still applies before the raw
  object is emitted, so a malformed answer still stops the item unless you turn it off.

## Basic trading tasks, with gates

A worked example of the whole loop on something less forgiving than support tickets. These are real:
live 5-minute candles, the real model, run on 2026-09-21. A program computed the facts first
(averages, ranges, volatility ratios, whether the New York morning session is open); each task is
written the way a person would type it, one per language; the gates are plain thresholds in code.

**A pre-trade entry gate, in English** (NQ, 798 ms, left by **Fail**)

> Check if price is above its 20-bar average. Check if the last hour's move is larger than usual for this market. Classify the market into trending up, trending down or ranging. Rate how stretched price is from its average from 1 to 5.

| compiled to | gate |
|---|---|
| noul | `gte` 0.7 |
| noul | `lte` 0.5 |
| choice | `minConfidence` 0.6, `in` trending up |
| score | `max` 2 |

```
✓ Check if price is above its 20-bar average. Yes (99% sure)
✗ Check if the last hour's move is larger than usual for this market. Yes (94% sure)
✓ Classify the market into trending up, trending down or ranging. trending up (86% confident)
✓ Rate how stretched price is from its average from 1 to 5. 2 (2 of 5), 55% confident
At least one check did not pass.
```

The second check failed on purpose: the gate wants a calm last hour (`lte 0.5`) and the hour was not calm.
That is a gate doing its job, not the model being wrong.

**A pre-trade order sanity check, in Japanese** (BTC, 301 ms, left by **Review**)

> この注文の数量は通常より異常に大きいですか。指値は現在の価格から大きく離れていますか。この注文を次のいずれかに分類してください：通常、要確認、誤発注の疑い。

| compiled to | gate |
|---|---|
| noul | `lte` 0.3 |
| noul | `lte` 0.3 |
| choice | `minConfidence` 0.6, `in` 通常 |

```
✓ この注文の数量は通常より異常に大きいですか。 いいえ（確信度86%）
✓ 指値は現在の価格から大きく離れていますか。 いいえ（確信度94%）
? この注文を次のいずれかに分類してください：通常、要確認、誤発注の疑い。 おそらく通常ですが、確信はありません（46%）
確信が足りないため、担当者に確認を依頼します。
```

Both yes/no checks passed, but the model would not commit to a category, so the order goes to a person.
That is what Review is for. (The order is a sample ticket measured against the real last price.)

**An exit guard, in German** (BTC, 663 ms, left by **Review**)

> Prüfe, ob der Kurs unter dem 20-Perioden-Durchschnitt liegt. Prüfe, ob die Volatilität ungewöhnlich hoch ist. Bewerte die Dringlichkeit, eine Long-Position zu verkleinern, von 1 bis 5.

| compiled to | gate |
|---|---|
| noul | reported, not gated |
| noul | reported, not gated |
| score | `min` 3, `minConfidence` 0.5 |

```
Prüfe, ob der Kurs unter dem 20-Perioden-Durchschnitt liegt. Nein (99 % sicher)
Prüfe, ob die Volatilität ungewöhnlich hoch ist. Ja (94 % sicher)
? Bewerte die Dringlichkeit, eine Long-Position zu verkleinern, von 1 bis 5. Vermutlich 4 (4 von 5), aber unsicher (36 %)
Nicht sicher genug: Ich gebe das an einen Menschen weiter.
```

A rating is a centre of mass. Without `minConfidence` this one would have cleared `min 3` while the model
was only about a third sure. We found that in this very run, which is why a rating gate can now ask for
confidence too.

All eleven languages, with the facts the model was shown: [docs/TRADING_GATES.md](docs/TRADING_GATES.md).
Across the run, 11 of 11 languages were detected, the model's reading of the first fact matched plain code in
11 of 11, the median call took 295 ms, and all 11 calls together cost 0.000331 USD.

**What this is not.** These gates describe and guard a state a program has already measured. They do not
forecast. We tested that hard: six pre-registered trials on these same markets, and no model (this one,
Claude, or our own) forecast direction. A model in a trading loop supplies judgment about *now*; it does
not create an edge, and a strategy without one loses faster with a model in it. Keep the arithmetic, the
thresholds and every veto in code.

## The one rule about routing

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

## More

[TypeSafe over MCP, and an approval gate for agent tool calls](docs/MCP.md) ·
[Supplying keys securely](docs/SECURE_KEYS.md) · [Workflow patterns](docs/WORKFLOWS.md) ·
[How Translate works, rule by rule](docs/TRANSLATION.md) · [Trading gates in eleven languages](docs/TRADING_GATES.md) · [Key policy and rotation](docs/KEY_POLICY.md)

This package integrates one service: TypeSafe. It is published from GitHub Actions with an npm provenance
statement, and every release must pass n8n's community-package scanner.


## Licence

MIT. An independent community node by [Taifoon](https://github.com/taifoon-io). TypeSafe and Jev are
trademarks of TypeSafe AI; this project is not affiliated with or endorsed by TypeSafe AI.
