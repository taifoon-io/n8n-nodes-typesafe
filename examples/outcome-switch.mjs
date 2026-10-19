// TypeSafe has ONE output (3.0.0): it labels each item with `outcome` (pass / fail / review) and never routes.
// A template that branches does it with n8n's own Switch node. This puts one after the TypeSafe node wherever a
// workflow still wires its old exits 0/1/2, and moves everything to its right along to make room.
//   node examples/outcome-switch.mjs <file.workflow.json …>   (build-judges.mjs calls outcomeSwitch() itself)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RULE = (value, key) => ({
	conditions: {
		options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
		conditions: [{ id: `outcome-${value}`, leftValue: '={{ $json.outcome }}', rightValue: value, operator: { type: 'string', operation: 'equals' } }],
		combinator: 'and',
	},
	renameOutput: true,
	outputKey: key,
});
export const OUTCOMES = [['pass', 'Pass'], ['fail', 'Fail'], ['review', 'Review']];

export function outcomeSwitch(w, from = 'TypeSafe', name = 'Outcome') {
	const outs = w.connections[from]?.main;
	if (!outs || outs.length <= 1) return w;
	const ts = w.nodes.find((n) => n.name === from);
	const [x, y] = ts.position;
	for (const n of w.nodes) if (n.type !== 'n8n-nodes-base.stickyNote' && n.position[0] > x) n.position = [n.position[0] + 220, n.position[1]];
	w.nodes.splice(w.nodes.indexOf(ts) + 1, 0, {
		parameters: { rules: { values: OUTCOMES.slice(0, outs.length).map(([v, k]) => RULE(v, k)) }, options: {} },
		name, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [x + 220, y],
	});
	w.connections[name] = { main: outs };
	w.connections[from] = { main: [[{ node: name, type: 'main', index: 0 }]] };
	return w;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	for (const f of process.argv.slice(2)) {
		const w = JSON.parse(readFileSync(f, 'utf8'));
		writeFileSync(f, JSON.stringify(outcomeSwitch(w), null, 2) + '\n');
		console.log(`${f}: ${w.connections.Outcome ? 'Outcome switch in place' : 'unchanged'}`);
	}
}
