/**
 * lib/typed-translate — the dual translation layer (_TYPED_TRANSLATE_v1_ 2026-09-20; multilingual v2 2026-09-21).
 *
 *   forward   a plain-language TASK  ->  a battery of typed questions (noul | choice | score)
 *   backward  typed ANSWERS + a routing map  ->  decisions a workflow can branch on
 *
 * Both are pure, deterministic code. The forward half is a rule compiler, not a model: the same
 * task always yields the same battery, every rule that fired is named in `explain`, and where a
 * task does not say enough (a "classify" with no options) the question is marked `needs_input`
 * instead of being filled in with a guess. TypeSafe's own guidance is the design: one atomic
 * gut-check per question, decompose anything compound, recombine in code.
 */

export type Kind = "noul" | "choice" | "score";
export interface Compiled {
  id: string;
  kind: Kind;
  text: string;
  options?: string[];
  levels?: string[];
  /** the language pack that matched this clause */
  lang?: string;
  /** which rule chose this primitive, in words */
  explain: string;
  /** set when the task named a primitive but not enough to run it */
  needs_input?: string;
  /** a sane starting threshold for the backward half. A default, never a fit. */
  routing: Route;
}
export interface Route {
  /** noul: pass when p >= gte (or <= lte) */
  gte?: number;
  lte?: number;
  /** choice: pass only when the winner's confidence is at least this; else "review" */
  minConfidence?: number;
  /** choice: pass only when the winner is one of these */
  in?: string[];
  /** score: pass when score >= min (and <= max) */
  min?: number;
  max?: number;
}

/* ── language packs (_TYPED_TRANSLATE_v2_, 2026-09-21) ──────────────────────────────────────────
 * The compiler is the same in every language; only the WORDS differ. A pack lists the verbs that
 * mean "pick one", the words that mean "rate it", the prepositions that introduce options, the
 * conjunctions that separate them, the from/to words of a scale, the lead-ins to strip from a
 * yes/no, and a default rubric. Adding a language is adding a pack, never touching the logic.
 * Matching is Unicode-aware: JavaScript's \b treats "é" and "ł" as non-letters, so boundaries are
 * written as "no letter before / no letter after". */
export type Lang = "en" | "es" | "de" | "fr" | "pt" | "it" | "pl" | "nl" | "ru" | "ja" | "ar";
interface Pack { /** true for scripts without spaces between words (Japanese) or with attached particles (Arabic): match anywhere, not on word boundaries */ loose?: boolean; /** a script range that identifies the language outright */ script?: RegExp; choice: string; score: string; intro: string; or: string; and: string; from: string; to: string; outOf: string; lead: string; rubric: [string, string, string, string]; stop: string }
const PACKS: Record<Lang, Pack> = {
  en: { choice: "classif(?:y|ication)|categori[sz]e|which (?:of|one|category|type|kind)|route|pick|choose|select|label|tag|assign|triage|sort|bucket|decide between|one of|either|(?:decide|determine|identify|work out|figure out) which|which \\p{L}+(?: \\p{L}+)? (?:to|should|is|are|would|best)",
        score: "rate|rating|score|rank|grade|how (?:much|severe|serious|likely|good|bad|urgent|confident|relevant|well|strong|risky|important|complete|angry|satisfied|positive|negative)|severity|urgency|priority|quality|on a scale|out of \\d+",
        intro: "into|as one of|as either|as|between|among|one of|either|from|out of these|of these|options?|categories|labels?|types?", or: "or", and: "and", from: "from", to: "to|through", outOf: "out of",
        lead: "(?:please )?(?:check|determine|decide|tell me|find out|verify|detect|flag|see|assess|evaluate|identify|confirm) (?:if|whether|that|when)", rubric: ["None", "Low", "Medium", "High"], stop: "the a an is are was were be to of in on for and or it this that if whether does do did has have with by from at as into one which how what should would can any there its their we you i" },
  es: { choice: "clasific(?:a|ar|ue)|categoriz(?:a|ar)|elig[ea]|escog[ea]|seleccion(?:a|ar|e)|asign(?:a|ar|e)|etiquet(?:a|ar|e)|decid[ea] (?:cuál|qué)|cuál de|uno de",
        score: "calific(?:a|ar)|puntú[ae]|punt(?:úa|uar)|evalú[ae]|valor(?:a|ar|e)|qué tan|cuán|gravedad|urgencia|prioridad|calidad|en una escala|sobre \\d+",
        intro: "en|como|entre|uno de|una de|de entre|opciones|categorías|etiquetas|tipos", or: "o|u", and: "y|e", from: "de|desde", to: "a|al|hasta", outOf: "sobre",
        lead: "(?:por favor )?(?:comprueba|verifica|determina|detecta|confirma|indica|dime|revisa)(?:r)? (?:si|que)", rubric: ["Ninguna", "Baja", "Media", "Alta"], stop: "el la los las un una unos unas es son de del en y o que si se su sus por para con al lo como este esta" },
  de: { choice: "klassifizier(?:e|en)|kategorisier(?:e|en)|wähl(?:e|en)|ordne|weise|entscheide,? welche[rsn]?|welche[rsn]? von|eine[rs]? von",
        score: "bewert(?:e|en|ung)|wie (?:dringend|schwer|schwerwiegend|wahrscheinlich|gut|schlecht|wichtig|relevant|riskant|zufrieden)|dringlichkeit|schweregrad|priorität|qualität|auf einer skala|von \\d+ bis \\d+",
        intro: "in|als|zwischen|unter|eine[rs]? von|optionen|kategorien|labels?|typen", or: "oder", and: "und", from: "von", to: "bis", outOf: "von",
        lead: "(?:bitte )?(?:prüfe|überprüfe|bestimme|ermittle|erkenne|bestätige|stelle fest|sag mir),? (?:ob|dass)", rubric: ["Keine", "Niedrig", "Mittel", "Hoch"], stop: "der die das den dem des ein eine einen einem ist sind und oder ob dass zu von in im für mit auf es sich nicht wie was" },
  fr: { choice: "class(?:e|er|ez|ifie|ifier)|catégoris(?:e|er|ez)|chois(?:is|ir|issez)|sélectionn(?:e|er|ez)|attribu(?:e|er|ez)|étiquet(?:te|er)|décide(?:r|z)? (?:quel|laquelle|lequel)|lequel|laquelle|l'une? de",
        score: "not(?:e|er|ez)|évalu(?:e|er|ez)|à quel point|quelle est la (?:gravité|urgence|priorité|qualité)|gravité|urgence|priorité|qualité|sur une échelle|sur \\d+",
        intro: "en|comme|entre|parmi|l'une? de|options|catégories|étiquettes|types", or: "ou", and: "et", from: "de", to: "à", outOf: "sur",
        lead: "(?:s'il vous plaît )?(?:vérifie|vérifier|vérifiez|détermine|déterminer|déterminez|détecte|confirme|indique|dis-moi) (?:si|que)", rubric: ["Aucune", "Faible", "Moyenne", "Élevée"], stop: "le la les un une des est sont de du et ou que si se son sa ses pour par avec au aux en ce cette il elle" },
  pt: { choice: "classifi(?:que|ca|car)|categoriz(?:e|a|ar)|escolh(?:a|e|er)|selecion(?:e|a|ar)|atribu(?:a|i|ir)|rotul(?:e|a|ar)|decid(?:a|e|ir) qual|qual d[eoa]s?|um d[eoa]s",
        score: "avali(?:e|a|ar)|pontu(?:e|a|ar)|quão|qual (?:é )?a (?:gravidade|urgência|prioridade|qualidade)|gravidade|urgência|prioridade|qualidade|numa escala|em uma escala|de \\d+ a \\d+",
        intro: "em|como|entre|um d[eoa]s|uma das|opções|categorias|rótulos|tipos", or: "ou", and: "e", from: "de", to: "a|até", outOf: "sobre",
        lead: "(?:por favor )?(?:verifique|verifica|verificar|determine|determinar|detecte|confirme|indique|diga-me) (?:se|que)", rubric: ["Nenhuma", "Baixa", "Média", "Alta"], stop: "o a os as um uma é são de do da dos das e ou que se seu sua por para com no na em ao este esta" },
  it: { choice: "classific(?:a|are|hi)|categorizz(?:a|are)|scegli(?:ere)?|selezion(?:a|are|i)|assegn(?:a|are|i)|etichett(?:a|are)|decid(?:i|ere) quale|quale (?:di|dei|delle)|uno (?:di|dei)|una delle",
        score: "valut(?:a|are|i)|dai un voto|quanto è|qual è la (?:gravità|urgenza|priorità|qualità)|gravità|urgenza|priorità|qualità|su una scala|su \\d+|da \\d+ a \\d+",
        intro: "in|come|tra|fra|uno (?:di|dei)|una delle|opzioni|categorie|etichette|tipi", or: "o|oppure", and: "e|ed", from: "da", to: "a", outOf: "su",
        lead: "(?:per favore )?(?:verifica|verificare|controlla|controllare|determina|determinare|rileva|conferma|indica|dimmi) (?:se|che)", rubric: ["Nessuna", "Bassa", "Media", "Alta"], stop: "il lo la i gli le un uno una è sono di del della dei delle e o che se suo sua per con al nel in questo questa" },
  pl: { choice: "sklasyfikuj|zaklasyfikuj|skategoryzuj|przypisz|wybierz|oznacz|zdecyduj,? (?:który|która|które|jaki|jaka)|który z|która z|które z|jeden z|jedną z",
        score: "oceń|ocenić|jak bardzo|jak (?:pilne|pilna|poważne|poważny|prawdopodobne|ważne|dobre|złe)|pilność|waga|priorytet|jakość|w skali|na \\d+",
        intro: "na|jako|między|pomiędzy|spośród|jeden z|jedną z|opcje|kategorie|etykiety|typy", or: "lub|albo|czy", and: "i|oraz", from: "od", to: "do", outOf: "na",
        lead: "(?:proszę )?(?:sprawdź|sprawdzić|ustal|ustalić|określ|wykryj|potwierdź|wskaż|powiedz mi),? (?:czy|że)", rubric: ["Brak", "Niska", "Średnia", "Wysoka"], stop: "i w z na do od to jest są czy że się nie jak co ten ta te dla po o u przez przy lub albo oraz" },
  nl: { choice: "classificeer|categoriseer|kies|selecteer|wijs .* toe|label|bepaal welke?|welke van|een van",
        score: "beoordeel|waardeer|hoe (?:dringend|ernstig|waarschijnlijk|goed|slecht|belangrijk|relevant)|urgentie|ernst|prioriteit|kwaliteit|op een schaal|van \\d+ tot \\d+",
        intro: "in|als|tussen|onder|een van|opties|categorieën|labels?|typen", or: "of", and: "en", from: "van", to: "tot|t/m", outOf: "op",
        lead: "(?:alsjeblieft )?(?:controleer|bepaal|stel vast|detecteer|bevestig|geef aan|vertel me) (?:of|dat)", rubric: ["Geen", "Laag", "Gemiddeld", "Hoog"], stop: "de het een is zijn van en of dat als te in op voor met aan er dit die deze niet wat hoe" },
  ru: { script: /[Ѐ-ӿ]/u, choice: "классифицируй(?:те)?|категоризируй(?:те)?|отнеси(?:те)?|выбери(?:те)?|определи(?:те)?,? (?:какой|какая|какое|к какой)|назначь(?:те)?|пометь(?:те)?|один из|одну из",
        score: "оцени(?:те)?|оценка|насколько|срочность|серьёзность|серьезность|приоритет|качество|по шкале|из \\d+",
        intro: "на|как|между|среди|один из|одну из|к одной из|варианты|категории|метки|типы", or: "или|либо", and: "и", from: "от", to: "до", outOf: "из",
        lead: "(?:пожалуйста,? )?(?:проверь(?:те)?|определи(?:те)?|выясни(?:те)?|установи(?:те)?|подтверди(?:те)?|скажи(?:те)?),? (?:ли|что)?\\s*", rubric: ["Нет", "Низкая", "Средняя", "Высокая"], stop: "и в на с не что как это по к у за от для или ли же бы" },
  ja: { loose: true, script: /[぀-ヿ]/u, choice: "分類|振り分け|選択|選んで|割り当て|どれ|どの(?:チーム|カテゴリ|種類)|いずれか",
        score: "評価|採点|どの程度|どれくらい|緊急度|重大度|優先度|品質|段階で|点満点",
        intro: "に分類|として|から|のうち|の中から|カテゴリ[:：]|選択肢[:：]", or: "または|もしくは|か", and: "と|および", from: "", to: "から|〜|~", outOf: "点満点",
        lead: "", rubric: ["なし", "低", "中", "高"], stop: "" },
  ar: { loose: true, script: /[؀-ۿ]/u, choice: "صن[ّ]?ف|اختر|اختار|حد[ّ]?د (?:أي|الفريق|الفئة)|عي[ّ]?ن|أي من|واحد من|إحدى",
        score: "قي[ّ]?م|قدّر|ما مدى|إلى أي مدى|الإلحاح|الخطورة|الأولوية|الجودة|على مقياس|من \\d+ إلى \\d+",
        intro: "إلى|الى|بين|من بين|واحد من|إحدى|الخيارات|الفئات|الأنواع", or: "أو|او", and: "و", from: "من", to: "إلى|الى|حتى", outOf: "من",
        lead: "(?:من فضلك )?(?:تحقق|تأكد|حد[ّ]?د|اكتشف|أك[ّ]?د)\\s+(?:مما إذا كان|مما إذا كانت|إذا كان|إذا كانت|من أن|أن)?\\s*", rubric: ["لا شيء", "منخفضة", "متوسطة", "عالية"], stop: "" },
};
export const LANGS = Object.keys(PACKS) as Lang[];
const NB = "(?<![\\p{L}\\p{N}])";            // no letter or digit before
const NA = "(?![\\p{L}\\p{N}])";             // no letter or digit after
const word = (alt: string, loose = false, flags = "iu") => new RegExp(loose ? `(?:${alt})` : `${NB}(?:${alt})${NA}`, flags);
const nb = (l: Lang) => (PACKS[l].loose ? "" : NB);
const na = (l: Lang) => (PACKS[l].loose ? "" : NA);
const RX = Object.fromEntries(LANGS.map((l) => [l, { choice: word(PACKS[l].choice, PACKS[l].loose), score: word(PACKS[l].score, PACKS[l].loose), lead: PACKS[l].lead ? new RegExp(`^\\s*(?:${PACKS[l].lead})\\s*`, "iu") : /^(?!)/u }])) as Record<Lang, { choice: RegExp; score: RegExp; lead: RegExp }>;

/** which language's words does this clause use? English wins a tie: it is the fallback, not a guess. */
export function detectLang(clause: string, hint?: Lang): Lang {
  if (hint && PACKS[hint]) return hint;
  // a script settles it outright: kana means Japanese, the Arabic block Arabic, Cyrillic the Russian pack
  for (const l of LANGS) if (PACKS[l].script?.test(clause)) return l;
  let best: Lang = "en"; let bestN = 0;
  const lower = ` ${clause.toLowerCase()} `;
  for (const l of LANGS) {
    if (PACKS[l].script) continue;
    const stops = new Set(PACKS[l].stop.split(" "));
    let n = 0;
    for (const w of lower.split(/[^\p{L}']+/u)) if (w && stops.has(w)) n++;
    if (RX[l].choice.test(clause) || RX[l].score.test(clause) || RX[l].lead.test(clause)) n += 3;
    if (n > bestN || (n === bestN && l === "en")) { best = l; bestN = n; }
  }
  return best;
}

/** split a compound task into atomic clauses: lines, list markers at a line start, semicolons, sentences */
export function clauses(task: string): string[] {
  const t = task.replace(/\r/g, "").trim();
  // list markers count ONLY at the start of a line. Measured 2026-09-20: matching them after any
  // space turned "from 1 to 5. Decide" into a list item "5." and cut the scale out of the clause.
  const lines = t.split(/\n+|;\s+|。|；|؛|(?<=[؟])\s+/u).map((s) => s.replace(/^\s*(?:\d+[.)]|[-*•–])\s+/u, "").trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    // a sentence boundary needs a capital after it, so a decimal or "z.B." never splits; ¿ and ¡ open Spanish sentences
    // …or a letter from a CASELESS script (Arabic, Hebrew, kana, hanzi: Unicode "Lo"). Arabic has no capitals, so
    // "a capital follows" kept three Arabic sentences fused into one clause.
    for (const s of line.split(/(?<=[.?!؟])\s+(?=[\p{Lu}\p{Lo}¿¡])/u)) {
      const c = s.trim().replace(/[.]+$/, "");
      if (c.length >= 4) out.push(c);
    }
  }
  return out.slice(0, 12);
}

/** options named by the task itself: after a colon or an introducing word, split on separators and "or"/"and" */
export function extractOptions(clause: string, lang: Lang = "en"): string[] {
  const p = PACKS[lang];
  const colon = clause.match(/[:：]\s*(.+)$/u);
  const m = colon ?? clause.match(new RegExp(p.loose ? `(?:[:：]|(?:${p.intro}))[:：\\s]*(.+)$` : `(?::|${NB}(?:${p.intro})${NA}[:\\s])\\s*(.+)$`, "iu"));
  if (!m) return [];
  const tail = m[1].replace(/\s*\(.*?\)\s*/g, " ").replace(/[.?!]+$/, "");
  const parts = tail.split(new RegExp(p.loose ? `\\s*(?:,|،|/|\\||、|\\s(?:${p.or})\\s|(?:または|もしくは)|\\sو(?=\\p{L}))\\s*` : `\\s*(?:,|/|\\||、|${NB}(?:${p.or}|${p.and})${NA})\\s*`, "iu"))
    .map((s) => s.trim().replace(/^["'`«»„“”「」]+|["'`«»„“”「」]+$/gu, "").replace(/(?:に分類|のいずれか|から選|です|してください|する)[^、]*$/u, "").trim()).filter((s) => s.length > 0 && s.length <= 40);
  const uniq = [...new Set(parts)];
  return uniq.length >= 2 ? uniq.slice(0, 50) : [];
}

function levelsFor(clause: string, lang: Lang): { levels: string[]; why: string; matched: string | null } {
  const p = PACKS[lang];
  const r = clause.match(p.loose
    ? new RegExp(`(\\d{1,2})\\s*(?:-|–|—|〜|~|${p.to})\\s*(\\d{1,2})|(\\d{1,2})\\s*(?:${p.outOf})`, "iu")
    : new RegExp(`${NB}(?:(?:${p.from})\\s+)?(\\d{1,2})\\s*(?:-|–|—|${NB}(?:${p.to})${NA})\\s*(\\d{1,2})${NA}|${NB}(?:${p.outOf})\\s+(\\d{1,2})${NA}`, "iu"));
  if (r) {
    const lo = r[3] ? 1 : Number(r[1]);
    const hi = r[3] ? Number(r[3]) : Number(r[2]);
    const n = hi - lo + 1;
    if (hi > lo && n >= 2 && n <= 10) {
      return { levels: Array.from({ length: n }, (_, k) => `${lo + k}${k === 0 ? " (lowest)" : k === n - 1 ? " (highest)" : ""}`), why: `the task names a ${lo} to ${hi} scale`, matched: r[0] };
    }
  }
  return { levels: [...p.rubric], why: "no scale was named, so a four-level rubric is used: replace it with your own", matched: null };
}

function slug(text: string, taken: Set<string>, lang: Lang): string {
  const stops = new Set(PACKS[lang].stop.split(" "));
  // ids are ASCII: fold diacritics (ł and ß do not decompose, so they are mapped by hand)
  const folded = text.toLowerCase().replace(/ł/g, "l").replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").normalize("NFD").replace(/\p{M}+/gu, "");
  const words = folded.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !stops.has(w)).slice(0, 4);
  let base = (words.join("_") || `q${taken.size + 1}`).replace(/^[^a-z]+/, "").slice(0, 36) || `q${taken.size + 1}`;
  if (!/^[a-z]/.test(base)) base = `q_${base}`;
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base.slice(0, 33)}_${k}`;
  taken.add(id);
  return id;
}

const asQuestion = (c: string, lang: Lang) => {
  const s = c.replace(RX[lang].lead, "").replace(/^[¿¡]\s*/u, "").trim();
  const q = s.charAt(0).toLocaleUpperCase() + s.slice(1);
  return /[?？]$/u.test(q) ? q : `${q}?`;
};

/** FORWARD: task -> battery. `lang` pins a language; otherwise each clause is detected on its own, so a mixed task works. */
export function translateTask(task: string, maxQuestions = 8, lang?: Lang): { questions: Compiled[]; dropped: number; notes: string[]; langs: Lang[] } {
  const all = clauses(task);
  const taken = new Set<string>();
  const questions: Compiled[] = [];
  const seen = new Set<Lang>();
  for (const c of all.slice(0, maxQuestions)) {
    const l = detectLang(c, lang); seen.add(l);
    const tag = l === "en" ? "" : ` [${l}]`;
    if (RX[l].choice.test(c)) {
      const opts = extractOptions(c, l);
      const stem = (/[:：]/u.test(c) ? c.replace(/\s*(?:\p{L}+\s*)?[:：].*$/u, "") : c).replace(new RegExp(PACKS[l].loose ? `(?:[:：]|(?:${PACKS[l].intro})).*$` : `(?::|${nb(l)}(?:${PACKS[l].intro})${na(l)}[:\\s]).*$`, "iu"), "").trim();
      questions.push({
        id: slug(stem || c, taken, l), kind: "choice", text: asQuestion(stem || c, l), options: opts, lang: l,
        explain: (opts.length ? `a selection verb plus ${opts.length} options named in the task -> choice` : "a selection verb -> choice, but the task names no options") + tag,
        ...(opts.length ? {} : { needs_input: "list the options to choose between (2 to 50); the translator will not invent them" }),
        routing: { minConfidence: 0.6 },
      });
    } else if (RX[l].score.test(c)) {
      const { levels, why, matched } = levelsFor(c, l);
      const text = (matched ? c.replace(matched, "") : c).replace(/\s{2,}/g, " ").trim();
      questions.push({ id: slug(c, taken, l), kind: "score", text: asQuestion(text, l), levels, lang: l, explain: `a rating verb -> score; ${why}${tag}`, routing: { min: Math.ceil((levels.length - 1) / 2) } });
    } else {
      questions.push({ id: slug(c, taken, l), kind: "noul", text: asQuestion(c, l), lang: l, explain: `a statement that is true or false -> noul (the probability it is true)${tag}`, routing: { gte: 0.5 } });
    }
  }
  const notes = [
    "thresholds in `routing` are starting points, not fits: tune them on your own labelled items",
    "one atomic question per clause; a clause that weighs several factors should be split further",
    `languages with a word pack: ${LANGS.join(", ")}. Anything else compiles with the English rules: a yes/no still works, a selection or rating verb may be missed, so check \`explain\`.`,
  ];
  return { questions, dropped: Math.max(0, all.length - maxQuestions), notes, langs: [...seen] };
}

export interface AnswerLike {
  id: string;
  kind: string;
  schema_ok?: boolean;
  p?: number | null;
  value?: unknown;
  confidence?: number | null;
}
export interface Decision {
  id: string;
  outcome: "pass" | "fail" | "review";
  reason: string;
}

/** BACKWARD: answers + routing -> decisions. Fail closed: no valid answer is never a pass. */
export function decide(answers: AnswerLike[], routing: Record<string, Route>): { decisions: Decision[]; allPass: boolean; branch: "pass" | "fail" | "review" } {
  const decisions: Decision[] = [];
  for (const a of answers) {
    const r = routing[a.id];
    if (!r) continue;
    if (a.schema_ok === false || a.value === null || a.value === undefined) {
      decisions.push({ id: a.id, outcome: "review", reason: "no valid answer: failing closed to review" });
      continue;
    }
    if (a.kind === "noul") {
      const p = typeof a.p === "number" ? a.p : a.value === true ? 1 : 0;
      const ok = (r.gte === undefined || p >= r.gte) && (r.lte === undefined || p <= r.lte);
      decisions.push({ id: a.id, outcome: ok ? "pass" : "fail", reason: `p=${p.toFixed(3)} against ${r.gte !== undefined ? `>= ${r.gte}` : ""}${r.lte !== undefined ? ` <= ${r.lte}` : ""}`.trim() });
    } else if (a.kind === "choice") {
      const conf = typeof a.confidence === "number" ? a.confidence : null;
      if (r.minConfidence !== undefined && conf !== null && conf < r.minConfidence) {
        decisions.push({ id: a.id, outcome: "review", reason: `chose ${String(a.value)} at confidence ${conf.toFixed(2)}, below ${r.minConfidence}: a person should look` });
      } else {
        const ok = !r.in || r.in.includes(String(a.value));
        decisions.push({ id: a.id, outcome: ok ? "pass" : "fail", reason: `chose ${String(a.value)}${r.in ? ` (accepting ${r.in.join(", ")})` : ""}` });
      }
    } else {
      const v = Number(a.value);
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      decisions.push({ id: a.id, outcome: ok ? "pass" : "fail", reason: `score ${v} against ${r.min !== undefined ? `>= ${r.min}` : ""}${r.max !== undefined ? ` <= ${r.max}` : ""}`.trim() });
    }
  }
  const branch = decisions.some((d) => d.outcome === "review") ? "review" : decisions.every((d) => d.outcome === "pass") && decisions.length > 0 ? "pass" : "fail";
  return { decisions, allPass: branch === "pass", branch };
}
