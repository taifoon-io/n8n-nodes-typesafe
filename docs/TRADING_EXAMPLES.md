# Basic trading tasks, with gates

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

All eleven languages, with the facts the model was shown: [TRADING_GATES.md](TRADING_GATES.md).
Across the run, 11 of 11 languages were detected, the model's reading of the first fact matched plain code in
11 of 11, the median call took 295 ms, and all 11 calls together cost 0.000331 USD.

**What this is not.** These gates describe and guard a state a program has already measured. They do not
forecast. We tested that hard: six pre-registered trials on these same markets, and no model (this one,
Claude, or our own) forecast direction. A model in a trading loop supplies judgment about *now*; it does
not create an edge, and a strategy without one loses faster with a model in it. Keep the arithmetic, the
thresholds and every veto in code.
