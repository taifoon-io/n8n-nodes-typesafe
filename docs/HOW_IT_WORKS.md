# How it works

Most automations have a moment where someone has to *decide*: is this a refund request, which team
gets this ticket, how urgent is it, is this invoice a duplicate. Today you either write brittle rules
for that, or you ask a chat model and then fight with its prose: parse the answer, handle the day it
says "It depends", pay for a paragraph you throw away.

This node does the deciding and nothing else. You hand it an item and a few questions. It hands back
answers your workflow can branch on directly, with a probability attached, usually in well under a
second and for about two thousandths of a cent.

It works by calling [TypeSafe's Jev](https://docs.typesafe.ai/introduction), a System One model built to make
decisions rather than write text, with TypeSafe's three question types: Noul (yes/no), Choice (pick one)
and Score (rate it).

## Three systems, each doing the one thing it is good at

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
[What it is good and bad at](RELIABILITY.md#what-it-is-good-and-bad-at).

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
