# What the translation layer can and cannot do

**Languages:** English, Spanish, German, French, Portuguese, Italian, Polish, Dutch, Russian, Japanese, Arabic. The tables below show the English words; every language has the equivalent pack in `translate.ts`. European packs match whole words (Unicode-aware, so accents are safe). Japanese and Arabic match anywhere, because Japanese has no spaces between words and Arabic attaches particles; for the same reason a one-letter particle is never used as a marker. A colon, in any language, always starts the option list.

The node sits between a workflow, which speaks JSON items and branches, and a System One model, which
speaks typed questions and probabilities. It translates in both directions, in plain code.

## Forward: a task becomes typed questions (the Translate operation)

Rules, applied per clause, in this order:

| The clause contains | Becomes | Details |
|---|---|---|
| a selection verb: classify, categorise, route, pick, choose, select, label, tag, assign, triage, sort, "which of", "one of", "decide which …" | **choice** | Options are taken from the task itself: after a colon or after *into / as / between / among / one of*, split on commas, slashes, pipes and "or". 2 to 50. |
| a rating verb: rate, score, rank, grade, "how severe / likely / urgent / relevant …", severity, priority, quality, "on a scale", "out of N" | **score** | A named numeric scale ("from 1 to 5", "out of 10", up to ten levels) becomes that many levels; otherwise a four-level rubric *None / Low / Medium / High* that you should replace. |
| anything else | **noul** | Rewritten as a question; lead-ins such as "check if" and "determine whether" are removed. Returns the probability the statement is true. |

Compound tasks are split on new lines, list markers at the start of a line, semicolons, and sentence
boundaries (never inside a decimal). Up to 12 clauses; the default battery is 8.

What it refuses to do, deliberately:

- **It never invents options.** "Classify this ticket" with no categories comes back as a choice
  marked `needs_input`, and is left out of the runnable battery. `ready` is `false`.
- **It asks no model.** The same task always compiles to the same battery, it costs nothing, and
  every question carries `explain`: the rule that produced it.
- **It does not write your rubric.** A score without a named scale gets a generic one and says so.

## Backward: answers become branches (the Routing map on Ask)

| Question kind | Threshold keys | Outcome |
|---|---|---|
| noul | `gte`, `lte` on the probability | pass / fail |
| choice | `minConfidence`; `in` (accepted options) | below `minConfidence` → **review**; outside `in` → fail |
| score | `min`, `max` on the level | pass / fail |

`branch` is **review** if any decision is review, **pass** only if every routed question passed,
otherwise **fail**. An answer that did not validate is always **review**: nothing fails open. The
node exposes the three as real outputs, so they are wires on the canvas.

Translate returns thresholds only as `suggestedRouting` and leaves `routing` EMPTY: the branch is the AND of every routed question, so auto-filled thresholds made a calm refund ticket "fail" for not being urgent (measured in n8n). Copy in only what you mean to gate on. A score is a zero-based level index.

Suggested thresholds are starting points, not fits. A System One model's probabilities
are calibrated on its vendor's distribution, not on your items. Measured on our own benchmark, Jev
matched or beat Claude on every thresholded decision while its raw calibration was worse: **fit each
threshold on your own labelled items, and leave a question unrouted until you have.**

## State

With `jev`, state is any JSON up to 96,000 characters: `{{ JSON.stringify($json) }}` sends the whole
incoming item. Compute first, judge second: do arithmetic in a Code node and send the result; ask the
model for judgment, never for a sum.

## The reply: answers back into sentences

The third leg, for chat surfaces. `reply(answers, { questions, decisions, branch, lang })` returns
`{ lang, lines, verdict, flagHuman, text }`. It is the same kind of code as the rest: templates, no model.

| Answer | How it is said (English voice) |
|---|---|
| yes/no, p at least 0.8 | `Yes (97% sure)` |
| 0.6 to 0.8 | `Probably yes (74%)` |
| 0.4 to 0.6 | `Hard to say (52% likely)`: never yes, never no |
| 0.2 to 0.4 | `Probably not (70%)`: the percentage is how sure it is of NO |
| under 0.2 | `No (97% sure)` |
| pick one | `billing (93% confident)`; sent to Review, or under 0.6 with no gate: `Probably billing, but not sure (41%)` |
| rate it | the level's own label and its place: `Medium (3 of 5), 70% confident`; under 0.4, or sent to Review: `Probably Medium (3 of 5), but not sure (33%)` |
| did not validate | `No valid answer`: never read as a no |
| a selection with no options | not asked; the person is told `List the options to choose between, and I will pick one.` |

Rules that keep it honest:

1. **Echo, do not paraphrase.** Each line starts with the clause exactly as the person wrote it
   (`source`, kept by Translate), and options and levels are the person's own words. Only the glue is translated.
2. **The language is the asker's.** Pinned, or the language most of the questions were written in.
3. **A verdict states an outcome, never an action.** `Every check passed.`, not "going ahead": on an exit
   guard, passing does not mean go.
4. **Review is said out loud.** `flagHuman` is true when any line went to Review, and the last line says a
   person is taking over.
5. **A rating is a centre of mass.** The value is fractional (3.24 on a five-level scale is "between 4 and
   5, nearer 4"); the reply names the nearest level and, when confidence is low, says it is unsure. A gate on
   a rating can carry `minConfidence` so an unsure rating goes to Review instead of clearing `min` by accident.

Adding a voice is adding one row to `VOICES` and one line to the self-test.

### What the first real run caught

We ran eleven trading tasks in eleven languages against the real model before shipping this, and it found
bugs no unit test had: French `moyenne sur 20 bougies` was read as a rating "out of 20" (a number that
counts something is not a scale); the Arabic feminine lead `مما إذا كانت` left a stray letter, and removing
a scale left its `من` dangling; a German question ended in `,?`; our English scale notes `(lowest)` leaked
into Russian replies. Each is now a regression check. The self-test has 107.
