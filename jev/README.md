# @taifoon/jev

Jev is a grader that any protocol can call from a contract's evaluator seat. The pipeline is code facts, then calibrated
answers, then a composed verdict, a receipt, the on-chain record and finally the evaluator call.

Built by Taifoon. MIT. The package has no runtime dependencies and contains no key.

```
npm i @taifoon/jev
```

The package also ships the n8n workflows that run Jev as a versioned bundle (see [Workflows](#workflows)).

## What Jev is

Jev is TypeSafe's System One decision model. When this was written it answered as **`jev-1.13.0`**. You don't ask Jev
for prose. You give it closed questions, and every answer comes back as a **full probability distribution** over the
options, plus a confidence value. An answer to "did the delivery meet the spec?" looks like `{ yes: 0.93, no: 0.07 }`,
not a paragraph.

This package puts Jev inside a fixed judging procedure:

- Code establishes the facts first. A failed check ends the job, and Jev is never asked.
- Jev answers four **atomic** questions from a published rubric. It never gets a holistic "is the job good?".
- Code composes the verdict from the facts and the answers under published thresholds.
- Everything is hashed into a receipt, recorded on chain and turned into the one call that ends the job.

How to describe the result: *graded against a published rubric by a pinned decision model, with an appeal.* It is not
"independently verified". An on-chain record is an attestation by whoever sent it, not a proof that the answer is right.

## The pipeline

```
 evidence ─► facts() ──── a check failed? ── yes ─► reject (hard fail; Jev is not asked)
             code checks                     │
                                             no
                                             ▼
             Jev reads: evidence (cut at 3,600 chars) + the facts section + one instruction
             Jev answers RUBRIC_v1:  spec_met · unsupported_claim · ending · cheat_shaped
                                             ▼
             compose under THRESHOLDS_v1 ─► complete | reject | needs_review
                                             ▼
             receipt: rubric hash, input digest, every distribution, verdict, reasons, receiptHash
                                             ▼
             record()  ─► JevAnswerLog.record (jev.answer.v1)  +  JevDecisionLog.record (decision.v2)
                                             ▼
             evaluatorCall() ─► complete / reject on the job's protocol   (needs_review ends nothing: appeal)
```

THRESHOLDS_v1:

- **complete** needs spec_met ≥ 0.85, unsupported_claim ≤ 0.20 and ending = complete.
- **reject** follows from spec_met ≤ 0.40, unsupported_claim ≥ 0.70 or ending = reject.
- **needs_review** is the result when cheat_shaped ≥ 0.50 (escalate, never slash on this alone) or when the answers
  land in the mid band.
- Above 50 USDC a complete is held for review.

## Quickstart

This is `examples/quickstart.mjs`, run as is:

```js
import { createHash } from 'node:crypto';
import { grade, facts, record, evaluatorCall, verify } from '@taifoon/jev';

const task = 'Return the SHA-256 hex digest of the ASCII string "jev".';
const delivered = createHash('sha256').update('jev').digest('hex');   // what the seller handed in

const receipt = await grade({
  subject: { chainId: 8453, ref: 'quickstart:sha256-jev' },            // what is being judged (your job id)
  evidence: { task, delivered },
  facts: facts({ delivered: true, checks: { digest_recomputes: () => createHash('sha256').update('jev').digest('hex') === delivered } }),
  trial: true,                                                          // 3 free calls; or { key: process.env.TYPESAFE_KEY }
});
console.log(receipt.verdict, '·', receipt.reasons[0]);
console.log('spec_met', receipt.answers?.spec_met.probabilities, '· model', receipt.model);
const onchain = await record(receipt);                                  // unsigned: JevAnswerLog + JevDecisionLog (devnet)
const end = evaluatorCall('virtuals-erc8183', 1n, receipt, receipt);    // unsigned: complete / reject as job 1's evaluator
console.log(onchain.calls.map((c) => c.fn), '→', end?.fn, '· verifies:', (await verify(receipt, { chain: false })).ok);
```

Real output from one call to the public trial (2026-09-27):

```
complete · spec_met 0.93 ≥ 0.85 · unsupported_claim 0.10 ≤ 0.2 · ending complete
spec_met { no: 0.07, yes: 0.93 } · model jev-1.13.0
[ 'JevAnswerLog.record', 'JevDecisionLog.record' ] → complete(uint256,bytes32,bytes) · verifies: true
```

## The five calls

| Call | What it does | Network |
|---|---|---|
| `grade({ subject, evidence, facts?, rubric?, key? \| trial })` | Checks the facts first. If none fails, asks Jev the rubric, composes the verdict and returns the receipt. | Asks Jev once, or never on a hard fail |
| `facts({ delivered, checks, priceUsdc? })` | Runs the checks your protocol supplies. A check is a value or an (async) function; one that throws counts as "could not be checked". | None |
| `record(receipt, { network, send? })` | Returns the unsigned `JevAnswerLog.record` and `JevDecisionLog.record` calls. `network` is a flag: `none`, `devnet` (default), `base` or `both`. Pass `send` (your wallet) to send every call that has an address. | None unless you pass `send` |
| `evaluatorCall(protocol, jobId, verdict, digest)` | Returns the one unsigned call that ends the job on that protocol. For `needs_review` it returns `null`. | None |
| `verify(receiptOrDigest)` | Recomputes every digest, re-composes the verdict and finds the `JevAnswered` and `Decided` events. | One devnet RPC read |

It also exports `RUBRIC_v1` and `CONTRACTS`. Nothing else.

**Where Jev is reached.** With `trial: true`, calls go to `https://typesafe.taifoon.dev/v1/trial`. The trial is free for
3 calls per caller, takes at most 4 questions and 4,000 JSON characters, and SDK cuts the evidence to fit (never the facts
section). With `key`, calls go to `https://api.typesafe.ai/v1/systemone` using your own TypeSafe key from
[console.typesafe.ai](https://console.typesafe.ai). The key is not stored and never appears in a receipt. If you already
have the answers (from the n8n node, for example), pass `answers` and nothing is asked.

**Your own rubric.** `grade({ rubric: { version, questions, asked?, thresholds?, compose? } })`. The rubric hash is
sha256 of its questions and goes into the receipt.

## Evaluator seats

Each adapter is one small file with its ABI fragment. Each one is tested against calldata that a mined transaction
carried (`test/fixtures/evaluator-calls.json`, written by `scripts/record-evaluator-fixtures.mjs`).

| `protocol` | Call | Tested against |
|---|---|---|
| `assurance-hook` | `complete(bytes32)` / `reject(bytes32 jobId, bytes32 digest)`, with `opts.to` = the hook | Base [`0xc606d00f…3116`](https://basescan.org/tx/0xc606d00fed64e912585bbc93feb15a9289cfcde94289f49f7c74a7a468903116), the complete of a covered GLMR hire on Moonbeam's hook (funded in [`0xfbe436ce…f193`](https://basescan.org/tx/0xfbe436ced5caf66dde0e96033f041480316fc5f62cd273006ad9c1852a57f193)) |
| `judge-adapter` | `postVerdict(bytes32 jobId, 1\|2, 2, bytes32 digest)` → hook complete / reject | devnet [`0x07853069…2012`](https://www.taifoon.io/scan/36927/tx/0x07853069cf43200fad3761d05b532c654df6f02b8a47f5f767bec18cb91a2012) |
| `virtuals-erc8183` | AgenticCommerceV3 `complete` / `reject(uint256, bytes32 reason, bytes)` as the job's evaluator | Base [`0x60890802…27bd`](https://basescan.org/tx/0x60890802a3b399af7face54c1cb33d771cffc9b8594d0113de14ae290b5c27bd) (complete) and [`0x152b5fb8…db76`](https://basescan.org/tx/0x152b5fb8900e57119cee6cbc15206d8938c11dc4056b20ec4c986f4d8acddb76) (reject), inside ERC-4337 handleOps |
| `virtuals-memo-acp` | ACPRouter `signMemo(uint256 memoId, bool approved, string reason)` on the evaluation memo | Base [`0x94ba6b49…622e`](https://basescan.org/tx/0x94ba6b497e2fc2ecf7ae256e1a490cabdc4a5357ed306ee2071f46a1c4ef622e) |
| `bitagent-erc8183` | AgenticCommerce `complete` / `reject(uint256, bytes32, bytes)` as the job's evaluator; `seat: 'platform'` → Evaluator `forceSettleJob(uint256, bool)` | Base [`0x195359ba…b01e`](https://basescan.org/tx/0x195359ba64f8ba429c449e82c27d0c57486511593646886b59a0d80c808fb01e) (forceSettleJob, job 8941) and its submit [`0xa4a49696…4ebc`](https://basescan.org/tx/0xa4a496968877ccbf1ba73fe5c5908f064d7333a2ced984e1867da9ee70f74ebc) (same layout) |

The digest in the call is the receipt's decision digest. That is the same 32 bytes JevDecisionLog holds, so the job's
ending, the decision record and the receipt all carry one value. On a hard fail no decision exists, so pass
`receipt.receiptHash`.

Whoever holds the seat signs the call; this package never does. The BitAgent implementation is unverified on Base, and
its layout was read from its own transactions. Its jobs settle today through the platform Evaluator, which only
BitAgent's operators can call.

## On chain today

The logs are on the public devnet (chain 36927, free gas from `https://faucet.taifoon.dev`). Any account may send to
them.

| Contract | Address | Rule |
|---|---|---|
| JevAnswerLog | `0xD8c1d8188Fc8EE388792f6EB3B3dbd4f341Ba8e3` | Append-only, no owner. Recorders fixed at deploy are `trusted`; any other sender is logged with `trusted = false` |
| JevDecisionLog | `0x1D622511862DD7DEffB8fEeBc225E0FAdA1e9A05` | Append-only, no owner, no upgrade. The recorder is `msg.sender` |

On Base (8453), since 0.1.1:

| Contract | Address | Rule |
|---|---|---|
| JevAnswerLog | `0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d` | Same bytecode. The only `trusted` recorder is the KMS key `0xe9F0E71e7Fc66864126C0aE5588a7858b25dE51D` |
| JevDecisionLog | `0x209490d6A0FFC5368A42b0c2208BDCda853f6a92` | Same bytecode. The recorder is `msg.sender` |

`record(receipt, { network: 'base' })` returns the Base calls with `to` set. `verify(digest, { network: 'base' })` and
`npx @taifoon/jev verify <digest> --network base` read them (the CLI's default `any` tries the devnet, then Base).
0.1.0 carried no Base addresses. An earlier Base answer log, `0x5bac70eb78224bbCBa83f5A36DF09D549d3f57fa`, is superseded and holds no records.

Here is one real grade, end to end: n8n execution 86, a proof-verification job graded with RUBRIC_v1.

- Answers recorded in devnet tx
  [`0x9a38cf55…a61b`](https://www.taifoon.io/scan/36927/tx/0x9a38cf5541bb82a8a6e2e5cf1a96ed25fdc46921c351506da83023f5dec1a61b).
  The answers digest is `0x6c7e6d2977689f1c9639a377b165f998d1160cc30eca8ff4f1fedc793db2f52d`.
- Decision anchored in devnet tx
  [`0x687ba9d7…4ee4`](https://www.taifoon.io/scan/36927/tx/0x687ba9d73d5789a2df9d9d09e94b6ed005447d7f5ece97f9226ea0d51f514ee4).
  Decision digest `0x781b0fce…3667`, confidence 2,700 bps.
- Jev answered spec_met `{ yes: 0.36, no: 0.64 }`, so the composed verdict is **reject** (spec_met ≤ 0.40).

`verify('0x6c7e6d29…f52d')` finds both rows. This is the real output:

```
{"ok":true,"checks":{"answersOnChain":true,"decisionOnChain":true},
 "answer":{"tx":"0x9a38cf5541bb82a8a6e2e5cf1a96ed25fdc46921c351506da83023f5dec1a61b","trusted":true},
 "decision":{"tx":"0x687ba9d73d5789a2df9d9d09e94b6ed005447d7f5ece97f9226ea0d51f514ee4","confidenceBps":2700}}
```

The tests re-derive these rows offline, byte for byte:

- **Execution 86:** the answers digest, the `JevAnswerLog.record` calldata (equal to the mined input) and the decision
  digest.
- **Execution 88:** run through `grade()` itself, it lands on the anchored decision digest and composes needs_review.

## The records

- **Receipt.** `receiptHash = sha256(JSON.stringify(body))`. The body holds the rubric and its hash, the thresholds, the
  subject, `stateHash`, the facts, the model, every answer with its distribution, what was not asked, the verdict,
  `auto`, `forced`, the reasons and the scores.
- **decision.v2.** `digest = sha256(canonical { v, kind, subject{chainId, at, ref}, model, answers[id, question,
  options, value, probabilities, confidence], input_digest })`, with keys sorted.
  `subjectId = keccak256(abi.encode("taifoon.decision.subject.v1", chainId, at, ref))`.
- **jev.answer.v1.** `digest = sha256(canonical record)`, covering questions, answers with distributions, model,
  upstream model, latency, credential path (`trial` or `caller-credential`), caller and time.

## In n8n

The TypeSafe node (`@taifoon/n8n-nodes-typesafe` 1.5.0) carries this package's network-free core under **Jev Options**:

- **Ask RUBRIC_v1** routes Pass = complete, Fail = reject and Review = needs_review.
- **Facts (JSON)** takes checks you already made. A false check rejects without asking Jev.
- **Record On** takes `none`, `devnet`, `base` or `both`, and **Evaluator Call** takes a protocol and a job id.

The node outputs the receipt and the unsigned calls, and it signs nothing. With the options unset it behaves exactly as
1.4.0.

## Workflows

`workflows/0.1.0/` holds the four n8n workflows that run Jev on n8n.taifoon.dev. The same files are attached to the
GitHub release as `jev-workflows-0.1.0.zip`:

- **`hire-judge-settle.json`** runs hire → prepare (facts) → TypeSafe (the four RUBRIC_v1 questions) → answers
  (verdict, recorded and anchored) → settle on devnet. Executions 86 and 88 of this workflow are the golden runs above.
- **`jev-grader.json`** grades Base jobs nobody ruled on, then stamps each verdict on the devnet GradeStampRegistry.
- **`batch-judge.json`** runs prepare → Jev → answers for each subject, then `POST /v1/judge/batch`.
- **`stamp-grade.json`** takes a recorded decision, turns it into the canonical verdict and stamps it.

Credential references are placeholders: `{ "id": "", "name": "REPLACE: <credential type>" }`. After import, pick your
own credential of that type. Each step names the entity it takes and emits by `$id` (`meta.taifoon.steps`). The schemas
behind those `$id`s are in `workflows/0.1.0/schemas/`. `manifest.json` pins every file by sha256.
`workflows/0.1.0/README.md` explains each workflow step by step and lists the nodes and credentials it needs:

- `@taifoon/n8n-nodes-typesafe`, tested with 1.3.0, is on npm.
- `n8n-nodes-taifoon`, tested with 0.4.2, and `n8n-nodes-taifoon-devnet-signer`, tested with 0.2.0, are custom
  extensions and are not on npm.

```
npx @taifoon/jev workflows list
npx @taifoon/jev workflows export ./jev-workflows      # workflows + schemas + manifest + README
npx @taifoon/jev verify 0x6c7e6d2977689f1c9639a377b165f998d1160cc30eca8ff4f1fedc793db2f52d
```

## Develop

```
npm ci && npm run check      # typecheck, tests (golden runs, recorded calldata, hashes vs viem), build
node scripts/vendor-n8n.mjs  # refresh the n8n node's copy of the core; test/vendor.test.ts fails when it drifts
npm run bundle && npm run zip   # rebuild workflows/<version>/ from the umbrella's workflows/ and zip it for the release
```
