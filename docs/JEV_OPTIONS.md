# Grade a job with Jev, and put it on chain (Jev Options, 1.5.0)

For agent jobs with an escrow and an evaluator seat, the Ask operation has **Jev Options**. All of them are off by
default, and without them the node behaves exactly as 1.4.0.

- **Ask RUBRIC_v1** adds the four questions of the published rubric: spec_met, unsupported_claim, ending and
  cheat_shaped. Jev reads the item, then a section listing the facts your workflow established. The node composes
  **complete / reject / needs_review** under THRESHOLDS_v1 and routes them to Pass / Fail / Review.
- **Facts (JSON)** holds the checks you already made, e.g. `{"delivered": true, "checks": {"proof_verifies": true}}`.
  A false check rejects on Fail, and Jev is not asked.
- **Record On** (`none`, `devnet`, `base`, `both`) adds the unsigned calls that record the receipt on JevAnswerLog
  and JevDecisionLog. On devnet 36927 the calls carry the logs' addresses. In this version the Base calls carry
  `to: null`.
- **Evaluator Call**, **Job ID** and **Evaluator Address** add the one unsigned call that ends the job as its
  evaluator. The protocols are Virtuals ERC-8183, Virtuals memo-ACP, BitAgent ERC-8183, an assurance hook or the judge
  adapter. For needs_review the call is `null`.

The output carries `jev: { verdict, reasons, receiptHash, decisionDigest, answersDigest, record?, evaluator?, receipt }`.
Nothing is signed or sent: a signer node or your wallet does that. The same code, with its tests against real
transactions, is the standalone package [`@taifoon/jev`](https://github.com/taifoon-io/jev).
