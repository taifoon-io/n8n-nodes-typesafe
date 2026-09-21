// Offline self-test for the dual translation layer. Run: npx tsx lib/typed-translate.selftest.mjs
import { translateTask, decide, clauses, detectLang, LANGS } from "./translate.ts";
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
console.log(fails ? `\nSELF-TEST RED · ${fails} failed` : "\nSELF-TEST GREEN"); process.exit(fails ? 1 : 0);
