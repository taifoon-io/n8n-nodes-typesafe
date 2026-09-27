# Reply and Raw Output

Two options on the Ask operation change what the node returns. **Reply Language** adds sentences for a
person. **Raw Output** removes the node's interpretation and returns the model's own numbers.

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
strings in [`translate.ts`](../nodes/TaifoonTypeSafe/translate.ts). Native speakers, please correct ours.
The full wording rules are in [How Translate works](TRANSLATION.md#the-reply-answers-back-into-sentences).

## Raw output: the model's own numbers, untouched

Routing, Reply and the per-question shaping are this node interpreting the answer for you. When you
would rather do that yourself, turn on **Raw Output** on the Ask operation. The node then returns the
API's answer *exactly as TypeSafe sent it*, with none of its interpretation:

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
  returned. The probabilities, confidences and `noul`/`score`/`choice` values are the model's own. This
  is the `--raw` form for when you want the raw calibration to feed your own logic, a training set, or a
  model that learns from Jev's best cases.
- **Everything flows on the first output.** The fail/review outputs are a Routing feature, and Routing
  is skipped in raw mode, so nothing is split off.
- `Fail Closed` still applies before the raw
  object is emitted, so a malformed answer still stops the item unless you turn it off.
