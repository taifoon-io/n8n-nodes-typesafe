// verify(): recompute every digest a receipt carries, re-compose its verdict from its own answers, then find the chain
// events that hold those digests. Given a bare answers digest, it finds the JevAnswered log for it.
import { decode, type AbiType } from './abi.js';
import { CONTRACTS } from './contracts.js';
import { keccakHex, sha256Hex, type Hex } from './hash.js';
import type { Receipt } from './receipt.js';
import { answersDigestOf, confidenceBpsOf, decisionAnswersOf, decisionDigest, subjectIdOf } from './records.js';
import { defineRubric, receiptBody, receiptHashOf, RUBRIC_v1, type Rubric, type RubricInput } from './rubric.js';

const TOPIC_ANSWERED = keccakHex('JevAnswered(address,bytes32,bytes32,bytes32,bytes32,bytes32,string,string,uint256,bool)');
const TOPIC_DECIDED = keccakHex('Decided(bytes32,bytes32,address,uint256,bytes32,uint16,string,string)');
const ANSWERED_DATA: AbiType[] = ['address', 'bytes32', 'bytes32', 'string', 'string', 'uint256', 'bool'];
const DECIDED_DATA: AbiType[] = ['uint256', 'bytes32', 'uint16', 'string', 'string'];

export type AnswerEvent = { tx: string; block: number; recorder: string; trusted: boolean; subject: Hex; inputDigest: Hex; decisionDigest: Hex; model: string; uri: string };
export type DecisionEvent = { tx: string; block: number; recorder: string; index: number; digest: Hex; confidenceBps: number; model: string; uri: string };
export type Verification = {
  ok: boolean;
  checks: Record<string, boolean>;
  onChain: { chainId: number; answers: AnswerEvent[]; decisions: DecisionEvent[] };
  problems: string[];
};

type Log = { transactionHash: string; blockNumber: string; topics: string[]; data: Hex };
async function logs(rpc: string, f: typeof fetch, address: string, topics: Array<string | null>, fromBlock: number): Promise<Log[]> {
  const r = await f(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address, topics, fromBlock: '0x' + fromBlock.toString(16), toBlock: 'latest' }] }), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json()) as { result?: Log[]; error?: { message: string } };
  if (j.error) throw new Error(`eth_getLogs: ${j.error.message}`);
  return j.result ?? [];
}
const answerEvent = (l: Log): AnswerEvent => { const [recorder, inputDigest, decisionDigest, model, uri, , trusted] = decode(ANSWERED_DATA, l.data); return { tx: l.transactionHash, block: parseInt(l.blockNumber, 16), recorder: String(recorder), trusted: Boolean(trusted), subject: l.topics[2] as Hex, inputDigest: inputDigest as Hex, decisionDigest: decisionDigest as Hex, model: String(model), uri: String(uri) }; };
const decisionEvent = (l: Log): DecisionEvent => { const [index, digest, bps, model, uri] = decode(DECIDED_DATA, l.data); return { tx: l.transactionHash, block: parseInt(l.blockNumber, 16), recorder: `0x${String(l.topics[3]).slice(26)}`, index: Number(index), digest: digest as Hex, confidenceBps: Number(bps), model: String(model), uri: String(uri) }; };

export async function verify(x: Receipt | string, opts: { rpc?: string; fetch?: typeof fetch; rubric?: Rubric | RubricInput; chain?: boolean } = {}): Promise<Verification> {
  const f = opts.fetch ?? fetch; const rpc = opts.rpc ?? CONTRACTS.devnet.rpc; const dev = CONTRACTS.devnet;
  const checks: Record<string, boolean> = {}; const problems: string[] = [];
  const onChain: Verification['onChain'] = { chainId: dev.chainId, answers: [], decisions: [] };
  let answersDigest: Hex | null; let subjectId: Hex | null = null; let decision: Hex | null = null;
  if (typeof x === 'string') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(x)) throw new Error('verify takes a receipt or a 32-byte answers digest');
    answersDigest = x.toLowerCase() as Hex;
  } else {
    const rubric = opts.rubric ? defineRubric(opts.rubric) : RUBRIC_v1;
    const composed = rubric.compose(x.facts, x.answers);
    const body = receiptBody({ rubric, subject: x.subject, state: '', facts: x.facts, answers: x.answers, model: x.model, composed });
    body.stateHash = x.stateHash; // the pack itself is not in the receipt; its hash is carried as is
    checks.rubric = x.rubricHash === rubric.hash;
    checks.verdict = composed.verdict === x.verdict && composed.forced === x.forced;
    checks.receiptHash = receiptHashOf(body) === x.receiptHash;
    checks.inputDigest = sha256Hex(x.input) === x.inputDigest;
    checks.subjectId = subjectIdOf(x.chainSubject) === x.subjectId;
    if (x.answers && x.decision && x.answersRecord) {
      const dA = decisionAnswersOf(x.answers, rubric.questions);
      checks.decisionDigest = decisionDigest({ kind: x.decision.kind, subject: x.chainSubject, answers: dA, model: x.model, input_digest: x.inputDigest }) === x.decision.digest;
      checks.confidenceBps = confidenceBpsOf(dA) === x.decision.confidenceBps;
      checks.answersDigest = answersDigestOf(x.answersRecord) === x.answersDigest;
    }
    for (const [k, v] of Object.entries(checks)) if (!v) problems.push(`${k} does not recompute`);
    answersDigest = x.answersDigest; subjectId = x.subjectId; decision = x.decision?.digest ?? null;
  }
  if (opts.chain !== false && answersDigest) {
    try {
      onChain.answers = (await logs(rpc, f, dev.answerLog.address, [TOPIC_ANSWERED, null, null, answersDigest], dev.answerLog.fromBlock)).map(answerEvent);
      // a bare digest: the answer row names its subject and decision, so the decision row can be found too
      const first = onChain.answers[0];
      if (!subjectId && first && !/^0x0{64}$/.test(first.decisionDigest)) { subjectId = first.subject; decision = first.decisionDigest; }
      if (subjectId && decision) onChain.decisions = (await logs(rpc, f, dev.decisionLog.address, [TOPIC_DECIDED, subjectId], dev.decisionLog.fromBlock)).map(decisionEvent).filter((d) => d.digest.toLowerCase() === decision!.toLowerCase());
    } catch (e) { problems.push(`chain read failed: ${e instanceof Error ? e.message : String(e)}`); }
    checks.answersOnChain = onChain.answers.length > 0;
    if (decision) checks.decisionOnChain = onChain.decisions.length > 0;
  }
  const recomputed = Object.entries(checks).filter(([k]) => !k.endsWith('OnChain')).every(([, v]) => v);
  return { ok: recomputed && (opts.chain === false || Boolean(checks.answersOnChain)), checks, onChain, problems };
}
