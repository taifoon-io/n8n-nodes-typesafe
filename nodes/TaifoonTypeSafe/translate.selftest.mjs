// Offline self-test for the dual translation layer. Run: npx tsx lib/typed-translate.selftest.mjs
import { translateTask, decide, clauses, detectLang, LANGS, reply } from "./translate.ts";
let fails = 0; const t = (name, ok) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) fails++; };
const task = "Check if the customer is asking for a refund. Classify the ticket into billing, technical, sales or abuse. Rate the urgency from 1 to 5. Decide which language to reply in.";
const { questions: q } = translateTask(task);
t("four clauses, four questions", q.length === 4);
t("a plain statement is a noul", q[0].kind === "noul" && q[0].text.endsWith("?") && !/^check if/i.test(q[0].text));
t("a selection verb with named options is a choice with exactly those options", q[1].kind === "choice" && JSON.stringify(q[1].options) === JSON.stringify(["billing", "technical", "sales", "abuse"]));
t("a named 1 to 5 scale survives a sentence boundary and yields five levels", q[2].kind === "score" && q[2].levels.length === 5 && q[2].levels[0].startsWith("1") && q[2].levels[4].startsWith("5"));
t("a selection with no named options asks for input and never invents them", q[3].kind === "choice" && q[3].options.length === 0 && Boolean(q[3].needs_input));
t("the same task compiles to the same battery", JSON.stringify(translateTask(task)) === JSON.stringify(translateTask(task)));
t("ids are unique, lower-case and start with a letter", new Set(q.map((x) => x.id)).size === q.length && q.every((x) => /^[a-z][a-z0-9_]*$/.test(x.id)));
t("numbered and bulleted lists split per item", clauses("1. Is it spam?\n2) Is it urgent?\n- Rate the tone out of 10").length === 3);
t("'out of 10' yields ten levels", translateTask("Rate the tone out of 10").questions[0].levels.length === 10);
t("a decimal is not a sentence boundary", clauses("Is the score above 0.5 for this item").length === 1);
const A = [{ id: "a", kind: "noul", p: 0.9, value: true }, { id: "b", kind: "choice", value: "billing", confidence: 0.4 }, { id: "c", kind: "score", value: 3 }, { id: "d", kind: "noul", schema_ok: false, value: null }];
t("noul passes on its threshold", decide([A[0]], { a: { gte: 0.7 } }).branch === "pass" && decide([A[0]], { a: { gte: 0.95 } }).branch === "fail");
t("a low-confidence choice goes to review, not pass", decide([A[1]], { b: { minConfidence: 0.6 } }).branch === "review");
t("a choice outside the accepted set fails", decide([{ ...A[1], confidence: 0.9 }], { b: { in: ["sales"] } }).branch === "fail");
t("a score is held to min and max", decide([A[2]], { c: { min: 2, max: 4 } }).branch === "pass" && decide([A[2]], { c: { min: 4 } }).branch === "fail");
t("an invalid answer fails CLOSED to review", decide([A[3]], { d: { gte: 0.1 } }).branch === "review");
t("one review outranks every pass", decide([A[0], A[3]], { a: { gte: 0.5 }, d: { gte: 0.5 } }).branch === "review");
t("no routing, no decisions, and never an accidental pass", decide(A, {}).decisions.length === 0 && decide(A, {}).allPass === false);

// ── multilingual: the same three decisions, asked in each language with a word pack ──
const CASES = {
  es: ["Comprueba si el cliente pide un reembolso. Clasifica el ticket en facturación, técnico, ventas o abuso. Califica la urgencia de 1 a 5.", ["facturación", "técnico", "ventas", "abuso"]],
  de: ["Prüfe, ob der Kunde eine Rückerstattung verlangt. Klassifiziere das Ticket in Abrechnung, Technik, Vertrieb oder Missbrauch. Bewerte die Dringlichkeit von 1 bis 5.", ["Abrechnung", "Technik", "Vertrieb", "Missbrauch"]],
  fr: ["Vérifie si le client demande un remboursement. Classe le ticket en facturation, technique, ventes ou abus. Note l'urgence de 1 à 5.", ["facturation", "technique", "ventes", "abus"]],
  pt: ["Verifique se o cliente pede um reembolso. Classifique o ticket em faturamento, técnico, vendas ou abuso. Avalie a urgência de 1 a 5.", ["faturamento", "técnico", "vendas", "abuso"]],
  it: ["Verifica se il cliente chiede un rimborso. Classifica il ticket in fatturazione, tecnico, vendite o abuso. Valuta l'urgenza da 1 a 5.", ["fatturazione", "tecnico", "vendite", "abuso"]],
  pl: ["Sprawdź, czy klient prosi o zwrot pieniędzy. Sklasyfikuj zgłoszenie jako rozliczenia, techniczne, sprzedaż lub nadużycie. Oceń pilność od 1 do 5.", ["rozliczenia", "techniczne", "sprzedaż", "nadużycie"]],
  nl: ["Controleer of de klant een terugbetaling vraagt. Classificeer het ticket als facturering, technisch, verkoop of misbruik. Beoordeel de urgentie van 1 tot 5.", ["facturering", "technisch", "verkoop", "misbruik"]],
};
CASES.ru = ["Проверь, просит ли клиент возврат денег. Классифицируй обращение на биллинг, техническое, продажи или злоупотребление. Оцени срочность от 1 до 5.", ["биллинг", "техническое", "продажи", "злоупотребление"]];
for (const [lang, [task, want]] of Object.entries(CASES)) {
  const r = translateTask(task).questions;
  t(`${lang}: three clauses become noul, choice, score`, r.length === 3 && r.map((x) => x.kind).join() === "noul,choice,score");
  t(`${lang}: the choice carries exactly the four options the task named`, JSON.stringify(r[1]?.options) === JSON.stringify(want));
  t(`${lang}: the named 1 to 5 scale gives five levels`, r[2]?.levels?.length === 5);
  t(`${lang}: every clause is detected as ${lang}`, r.every((x) => x.lang === lang));
  t(`${lang}: the yes/no lead-in is stripped and it ends with a question mark`, /\?$/.test(r[0].text) && r[0].text.split(" ").length < task.split(".")[0].split(" ").length);
  t(`${lang}: ids are ASCII, unique and start with a letter`, new Set(r.map((x) => x.id)).size === 3 && r.every((x) => /^[a-z][a-z0-9_]*$/.test(x.id)));
}
// scripts without word spacing or with attached particles: looser matching, so they get their own assertions
const ja = translateTask("顧客は返金を求めていますか。チケットを次のいずれかに分類: 請求、技術、営業、不正。緊急度を1から5で評価してください。").questions;
t("ja: kana selects Japanese, and the three clauses are noul, choice, score", ja.length === 3 && ja.map((x) => x.kind).join() === "noul,choice,score" && ja.every((x) => x.lang === "ja"));
t("ja: options split on the Japanese comma", JSON.stringify(ja[1].options) === JSON.stringify(["請求", "技術", "営業", "不正"]));
t("ja: '1から5' is a five-level scale", ja[2].levels.length === 5);
const ar = translateTask("تحقق مما إذا كان العميل يطلب استرداد الأموال. صنف التذكرة إلى: الفوترة، التقنية، المبيعات، إساءة الاستخدام. قيّم الإلحاح من 1 إلى 5.").questions;
t("ar: the Arabic block selects Arabic, and the three clauses are noul, choice, score", ar.length === 3 && ar.map((x) => x.kind).join() === "noul,choice,score" && ar.every((x) => x.lang === "ar"));
t("ar: options split on the Arabic comma", JSON.stringify(ar[1].options) === JSON.stringify(["الفوترة", "التقنية", "المبيعات", "إساءة الاستخدام"]));
t("ar: 'من 1 إلى 5' is a five-level scale", ar[2].levels.length === 5);
t("non-Latin tasks still get valid, unique ASCII ids", [...ja, ...ar].every((x) => /^[a-z][a-z0-9_]*$/.test(x.id)) && new Set(ja.map((x) => x.id)).size === 3);
t("a rating with no named scale gets the rubric of ITS language", translateTask("Bewerte die Dringlichkeit.").questions[0].levels.join() === "Keine,Niedrig,Mittel,Hoch");
t("a selection with no options asks for input in any language", translateTask("Clasifica el ticket.").questions[0].needs_input !== undefined && translateTask("Sklasyfikuj zgłoszenie.").questions[0].needs_input !== undefined);
t("a mixed-language task is detected clause by clause", translateTask("Check if this is spam. Bewerte die Dringlichkeit von 1 bis 3.").questions.map((x) => x.lang).join() === "en,de");
t("pinning a language overrides detection", translateTask("Rate the urgency from 1 to 5.", 8, "en").questions[0].lang === "en");
t("accented words are whole words: 'clasifica' inside 'desclasificado' is not a selection verb", translateTask("El documento fue desclasificado ayer.").questions[0].kind === "noul");
t("an English sentence is not mistaken for another language", detectLang("Is the customer asking for a refund?") === "en");
t("an unsupported language still compiles, as a yes/no, and says which rules were used", translateTask("고객이 환불을 요청하고 있습니까").questions[0].kind === "noul" && translateTask("x y z w").notes.some((n) => n.includes(LANGS.join(", "))));
// ── reply: answers said back in the asker's language ──
const RQ = [{ id: "a", text: "Is the customer asking for a refund?" }, { id: "b", text: "Which team?" }, { id: "c", text: "How urgent is this?", levels: ["None", "Low", "Medium", "High", "Critical"] }, { id: "d", text: "Is it spam?" }];
const r0 = reply(A, { questions: RQ });
t("reply: English questions are answered in English, one line per answer", r0.lang === "en" && r0.lines.length === A.length);
t("reply: a confident yes reads as yes with its percentage", reply([{ id: "a", kind: "noul", p: 0.97, value: true }], { questions: RQ }).lines[0].answer === "Yes (97% sure)");
t("reply: a confident no reports how sure it is of NO, not the 3%", reply([{ id: "a", kind: "noul", p: 0.03, value: false }], { questions: RQ }).lines[0].answer === "No (97% sure)");
t("reply: a coin-flip never reads as yes or no", reply([{ id: "a", kind: "noul", p: 0.5, value: true }], { questions: RQ }).lines[0].answer.startsWith("Hard to say"));
t("reply: a score is named by ITS level label, with its place on the rubric", reply([{ id: "c", kind: "score", value: 2.4, confidence: 0.7 }], { questions: RQ }).lines[0].answer === "Medium (3 of 5), 70% confident");
t("reply: a numeric scale keeps its place on the scale, so 3 is never read as 3 of 10", reply([{ id: "c", kind: "score", value: 2, confidence: 0.7 }], { questions: [{ id: "c", text: "Urgency?", levels: "1 | 2 | 3 | 4 | 5" }] }).lines[0].answer === "3 (3 of 5), 70% confident");
t("reply: the model's own legend outranks the question's levels", reply([{ id: "c", kind: "score", value: 1, legend: { 0: "calm", 1: "busy" } }], { questions: RQ }).lines[0].answer === "busy (2 of 2)");
t("reply: an invalid answer says so and never reads as a no", reply([A[3]], { questions: RQ }).lines[0].answer === "No valid answer");
const dz = decide([A[0], A[1]], { a: { gte: 0.7 }, b: { minConfidence: 0.6 } });
const rz = reply([A[0], A[1]], { questions: RQ, decisions: dz.decisions, branch: dz.branch });
t("reply: review flags a human, marks the unsure line, and says so in the verdict", rz.flagHuman === true && rz.lines[1].outcome === "review" && rz.lines[1].answer.startsWith("Probably ") && rz.verdict.includes("person") && rz.text.split("\n").length === 3);
t("reply: without routing there is no verdict and nobody is flagged", r0.verdict === null && r0.flagHuman === false);
const jq = translateTask("顧客は返金を求めていますか。チケットを次のいずれかに分類してください：請求、技術、営業、不正。").questions;
const jr = reply([{ id: jq[0].id, kind: "noul", p: 0.99, value: true }, { id: jq[1].id, kind: "choice", value: "請求", confidence: 0.93 }], { questions: jq, branch: "pass" });
t("reply: a Japanese task is answered in Japanese, echoing the user's own option", jr.lang === "ja" && jr.lines[0].answer === "はい（確信度99%）" && jr.lines[1].answer === "請求（確信度93%）" && jr.verdict.includes("通過しました"));
t("reply: every language has a complete voice with its placeholders intact", LANGS.every((l) => { const x = reply([{ id: "a", kind: "noul", p: 0.9, value: true }, { id: "b", kind: "choice", value: "X", confidence: 0.3 }, { id: "c", kind: "score", value: 1, confidence: 0.5 }], { lang: l, questions: RQ, branch: "review" }); return x.lang === l && x.lines[0].answer.includes("90") && x.lines[1].answer.includes("X") && x.lines[1].answer.includes("30") && x.lines[2].answer.includes("Low") && x.lines[2].answer.includes("50") && !/[{}]/.test(x.text) && x.verdict.length > 8; }));
t("reply: pinning a language overrides detection", reply([A[0]], { questions: RQ, lang: "pl" }).lang === "pl");
t("reply: is deterministic", JSON.stringify(reply(A, { questions: RQ })) === JSON.stringify(reply(A, { questions: RQ })));
// ── found by the first run against the real model, 2026-09-21 ──
t("fr: 'moyenne sur 20 bougies' counts candles, it is not a rating out of 20", translateTask("Vérifie si le prix est au-dessus de sa moyenne sur 20 bougies.").questions[0].kind === "noul");
t("en: 'out of 10' is still a scale when nothing is being counted", translateTask("Rate the tone out of 10").questions[0].levels.length === 10 && translateTask("Check if 3 out of 10 orders failed.").questions[0].kind === "noul");
t("ar: the feminine 'كانت' lead is stripped whole, leaving no stray letter", translateTask("تحقق مما إذا كانت جلسة نيويورك الصباحية مفتوحة الآن.").questions[0].text === "جلسة نيويورك الصباحية مفتوحة الآن؟");
t("ar: removing the scale takes its 'من' with it", translateTask("قيّم مستوى التقلب من 1 إلى 5.").questions[0].text === "قيّم مستوى التقلب؟");
t("de: a question never ends in a dangling comma", translateTask("Bewerte die Dringlichkeit, eine Long-Position zu verkleinern, von 1 bis 5.").questions[0].text === "Bewerte die Dringlichkeit, eine Long-Position zu verkleinern?");
t("every question keeps the clause exactly as it was written", translateTask(task).questions.every((x) => task.includes(x.source)));
t("reply: echoes the person's own clause, not the compiled question", reply([{ id: "x", kind: "noul", p: 0.99, value: true }], { questions: [{ id: "x", text: "Der Kurs über dem Durchschnitt liegt?", source: "Prüfe, ob der Kurs über dem Durchschnitt liegt" }] }).text === "Prüfe, ob der Kurs über dem Durchschnitt liegt. Yes (99% sure)".replace("Yes (99% sure)", "Ja (99 % sicher)"));
t("reply: a rating the model is spread across is said as unsure, never as a verdict", reply([{ id: "c", kind: "score", value: 2.25, confidence: 0 }], { questions: RQ }).lines[0].answer === "Probably Medium (3 of 5), but not sure (0%)");
t("reply: our English scale annotations never leak into another language", !reply([{ id: "c", kind: "score", value: 0, confidence: 0.9, legend: { 0: "1 (lowest)", 1: "2" } }], { lang: "ru", questions: RQ }).text.includes("lowest"));
t("reply: a verdict states the outcome and never an action", !/going ahead|weiter|進めます/.test(LANGS.map((l) => reply([], { lang: l, branch: "pass" }).verdict).join(" ")));
t("a rating the model is unsure of goes to review when the gate asks for confidence, and passes as before when it does not", decide([{ id: "c", kind: "score", value: 3.4, confidence: 0.38 }], { c: { min: 3, minConfidence: 0.5 } }).branch === "review" && decide([{ id: "c", kind: "score", value: 3.4, confidence: 0.38 }], { c: { min: 3 } }).branch === "pass");
t("reply: a rating sent to review reads as unsure even at 40%", reply([{ id: "c", kind: "score", value: 3, confidence: 0.4 }], { questions: RQ, decisions: [{ id: "c", outcome: "review", reason: "" }], branch: "review" }).lines[0].answer.startsWith("Probably "));
const ni = translateTask("Sklasyfikuj rynek.").questions;
t("reply: a selection with no options is asked for in the person's language, and nothing is answered", reply([], { needsInput: ni }).lang === "pl" && reply([], { needsInput: ni }).text === "Sklasyfikuj rynek. Podaj opcje do wyboru, a wybiorę jedną.");
t("reply: every voice can ask for options", LANGS.every((l) => reply([], { lang: l, needsInput: [{ id: "x", text: "X" }] }).lines[0].answer.length > 10));
console.log(fails ? `\nSELF-TEST RED · ${fails} failed` : "\nSELF-TEST GREEN"); process.exit(fails ? 1 : 0);
