# TypeSafe for n8n

**Ask a model that only judges: yes/no, pick-one and rate-it questions, each answered with a probability.**

- **What:** an n8n node that asks TypeSafe's Jev (System One) yes/no (Noul), pick-one (Choice) and rate-it (Score)
  questions about any item, and returns every answer with its probabilities on one output.
- **Why:** a chat model writes prose you have to parse and guesses when unsure. This node returns a number for
  every answer, so your workflow can tell a confident answer from a guess.
- **How:** in n8n, **Settings → Community Nodes → Install** `@taifoon/n8n-nodes-typesafe`, add your TypeSafe key, and ask
  "Is this a refund request?".

Use it to classify tickets and rows, check an LLM's input or output, or grade delivered work.
It is not for writing text, summarising, or reasoning about code.

```
item ──► TypeSafe ──► the item + answers (p, probabilities, confidence) + outcome: pass | fail | review
                                                          │
                          branch on it with n8n's own Switch or IF node, if you want to
```

## Install

In n8n: **Settings → Community Nodes → Install**, then enter `@taifoon/n8n-nodes-typesafe`.
The package has no run-time dependencies; everything it needs ships inside the node.

Get a TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai) and create a
**TypeSafe API** credential. The test button makes one tiny real call, so you know at once whether the key works.
The node talks to TypeSafe directly with your key, and nobody else, including us, is in the path.

Running n8n for a team? [Supply the key from a secrets file](docs/SECURE_KEYS.md). Upgrading from 1.1 or
earlier, or from 2.x (three outputs became one in 3.0.0)? See [Upgrading](docs/UPGRADING.md).

## Try it in two minutes

1. Add a **Manual Trigger** and an **Edit Fields** node with a `subject` and a `body`: paste in any
   support email.
2. Add **TypeSafe**, operation **Ask**. Leave *Item to Judge* alone; it already sends the whole item.
   Add three questions:
   - `is_refund` · Yes/no · *Is the customer asking for money back?*
   - `team` · Pick one · *Which team should handle this?* · `billing, technical, sales, abuse`
   - `urgency` · Rate it · *How urgent is this?* · `None | Low | Medium | High`
3. Run it. You get `answers.is_refund.p`, `answers.team.value`, `answers.urgency.value`.
4. Now label it. In **Thresholds** put `{"team": {"minConfidence": 0.6}}`. Tickets the model is sure about get
   `outcome: "pass"`; the ones it is unsure about get `outcome: "review"`. Add a **Switch** node on
   `{{ $json.outcome }}` to send each kind where you want it.

Ready-made versions are in [`examples/`](examples).

## Judge workflows, ready to import

Each one runs as imported on sample data, needs only your own TypeSafe key, and ends in a Switch on `outcome` with three
plainly named exits. Import
the file in n8n (**Workflows → Import from File**), pick your **TypeSafe API** credential, press **Test workflow**.

| # | Workflow | For | The judge decides | File |
|---|---|---|---|---|
| 1 | Grade an AI agent's delivered work | teams running agents | did the delivery meet the task's criteria? complete / reject / needs review | [judge-agent-delivery](examples/judge-agent-delivery.workflow.json) |
| 2 | Grade a Base agent job from its on-chain record | agent marketplaces, ERC-8183 builders | the same, from the job's public record, plus the unsigned evaluator call | [judge-base-job](examples/judge-base-job.workflow.json) |
| 3 | Fact-check a chatbot answer before it ships | support and RAG teams | does the answer claim anything its source does not say? send / hold / review | [judge-answer-factcheck](examples/judge-answer-factcheck.workflow.json) |
| 4 | Accept or return a freelancer's deliverable | agencies, marketplaces | criteria met? accept / request changes / escalate | [judge-freelancer-deliverable](examples/judge-freelancer-deliverable.workflow.json) |
| 5 | Refund-dispute judge | e-commerce, marketplaces | refund / deny / a person, from the complaint and the evidence | [judge-refund-dispute](examples/judge-refund-dispute.workflow.json) |
| 6 | QA an extraction against its source | finance operations | does every extracted value match the document? post / re-extract / review | [judge-extraction-qa](examples/judge-extraction-qa.workflow.json) |
| 7 | Grade a batch of submissions | educators, bounty programmes | per row: verdict, probabilities and a receipt | [judge-bulk-submissions](examples/judge-bulk-submissions.workflow.json) |
| 8 | Check a translation keeps its meaning | localisation | meaning kept, nothing added or dropped? publish / send back / review | [judge-translation](examples/judge-translation.workflow.json) |
| 9 | Moderate posts against your own rules | communities | which rule, if any, a post breaks: publish / remove / a moderator | [judge-moderation](examples/judge-moderation.workflow.json) |
| 10 | Triage support tickets | support teams | refund? which team? how urgent? | [support-triage-direct](examples/support-triage-direct.workflow.json) |

Workflows 1, 2, 4 and 7 use **Jev Options → Ask RUBRIC_v1**: code checks the facts first, Jev answers four closed
questions, and the verdict comes with a receipt anyone can recompute. The others ask your own Noul questions and label
them with thresholds. Every file is tested end to end in [`test/templates.test.mjs`](test/templates.test.mjs), and imported and run in n8n 1.123.82.

Workflow 2 needs only your TypeSafe key: the evidence route is a public read. It outputs `jev.verdict`, the receipt and
the unsigned `complete` / `reject` call for the job's evaluator seat. Nothing is signed or sent.

## Three kinds of question

| You ask | You get back | Think of it as |
|---|---|---|
| **Yes / no** ("Noul") | `p`, the probability the statement is true | a yes/no with a dial |
| **Pick one** ("Choice") | the option, a probability for every option, and a `confidence` | a classifier that knows when it is guessing |
| **Rate it** ("Score") | a level on a rubric you write, and a `confidence` | a ranking you can threshold |

Describe the options, and add an `other`, to sharpen a Choice. Ask every question that might matter in one node:
they are answered at once and independently, so ten cost about the same as one.

## What you must know

- **Threshold only what you gate on.** `outcome` is `pass` only if *every* question in Thresholds passed. Add
  `urgency` too, and a good refund ticket "fails" for not being urgent.
- **Nothing fails open.** A Thresholds mistake, or an answer that does not validate, makes the outcome `review`.
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
- [Thresholds, reliability, cost and benchmark](docs/RELIABILITY.md)
- [Workflow patterns](docs/WORKFLOWS.md)
- [Basic trading tasks, with gates](docs/TRADING_EXAMPLES.md) and [in eleven languages](docs/TRADING_GATES.md)
- [Supplying keys securely](docs/SECURE_KEYS.md) · [Key policy and rotation](docs/KEY_POLICY.md)

This package integrates one service: TypeSafe. It has no run-time dependencies, runs in n8n's strict mode, is
published from GitHub Actions with an npm provenance statement, and every release must pass n8n's
community-package scanner (`npm run scan` runs it locally on the source and the packed tarball).

## Licence

Independent project. Jev and TypeSafe are products of TypeSafe AI, Inc., which does not endorse this package.

MIT. An independent community node by [Taifoon](https://github.com/taifoon-io). TypeSafe and Jev are
trademarks of TypeSafe AI; this project is not affiliated with or endorsed by TypeSafe AI.
