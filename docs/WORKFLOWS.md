# Workflows

Each pattern below is one Taifoon TypeSafe node plus ordinary n8n nodes. All of them follow the same
three moves: **compute** the state upstream, **ask** every question that might matter in one call
(they are answered in parallel and in isolation, so ten cost about what one does), **route** on
thresholds that live on the canvas.

| Workflow | Trigger → state | Questions | Routing |
|---|---|---|---|
| **Support triage** | Helpdesk webhook → the ticket JSON | noul *is a refund requested?* · choice *team: billing, technical, sales, abuse* · score *urgency 1 to 5* | Pass → assign to team queue · Review (low confidence) → human inbox · Fail → auto-reply |
| **Lead qualification** | CRM new lead → lead + enrichment | score *fit against your ICP rubric* · noul *is the budget stated?* · choice *segment* | score ≥ 3 → sales · else nurture |
| **Invoice guard** | Inbox attachment → extracted fields + last 5 invoices | noul *duplicate of a previous one?* · noul *amount out of pattern?* | any pass → hold for approval |
| **Content moderation** | Form submit → text | choice *ok, spam, abusive, off-topic* · score *severity* | confidence < 0.6 → Review, never auto-ban |
| **LLM guardrail** | Before and after an LLM node → the prompt or the reply | noul *contains personal data?* · noul *instruction injection?* | fail closed: stop the item |
| **Alert de-noising** | Monitoring webhook → alert + last hour of context | noul *is this a repeat of a known flap?* · score *customer impact* | page only when impact ≥ High |
| **Strategy gate** (trading) | Schedule → indicators computed in a Code node | one noul per gate of your state machine | every gate must pass; Review → stand down |

The importable example is `examples/typed-gate.workflow.json`.

## Operating notes

- **Latency.** Jev answers a 4 to 8 question battery in 0.3 to 0.8 s. `auditor` takes about a minute.
  The edge cuts any request at 100 s.
- **Cost.** About 450 to 550 input tokens per battery, 0.00002 USD on Jev. Output is free.
- **Retries.** A `503` means the lane is unavailable and nothing was charged; n8n's *Retry On Fail*
  with backoff is the right response. A `402` is not retryable: it names what is missing.
- **Observability.** Use **List Lanes** on a schedule to alert on trial exhaustion, spend against the
  daily ceiling, and lane health. The deck logs every call and every charge on its own side.
- **Batching.** One item is one request. For many items, keep n8n's batching on and the deck's daily
  ceiling in mind; TypeSafe allows 1,200 requests a minute.
