/**
 * lib/typed-translate — the dual translation layer (_TYPED_TRANSLATE_v1_ 2026-09-20; multilingual v2 2026-09-21).
 *
 *   forward   a plain-language TASK  ->  a battery of typed questions (noul | choice | score)
 *   backward  typed ANSWERS + a routing map  ->  decisions a workflow can branch on
 *   reply     typed ANSWERS + decisions       ->  sentences in the asker's own language (v3, for chat surfaces)
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
  /** the clause exactly as the person wrote it; `reply` echoes this, so nothing they said is paraphrased */
  source?: string;
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
  /** choice and score: pass only when the model's confidence is at least this; else "review" */
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
        lead: "(?:من فضلك )?(?:تحقق|تأكد|حد[ّ]?د|اكتشف|أك[ّ]?د)\\s+(?:مما إذا كانت|مما إذا كان|إذا كانت|إذا كان|من أن|أن)?\\s*", rubric: ["لا شيء", "منخفضة", "متوسطة", "عالية"], stop: "" },
};
export const LANGS = Object.keys(PACKS) as Lang[];
const NB = "(?<![\\p{L}\\p{N}])";            // no letter or digit before
const NA = "(?![\\p{L}\\p{N}])";             // no letter or digit after
const word = (alt: string, loose = false, flags = "iu") => new RegExp(loose ? `(?:${alt})` : `${NB}(?:${alt})${NA}`, flags);
const nb = (l: Lang) => (PACKS[l].loose ? "" : NB);
const na = (l: Lang) => (PACKS[l].loose ? "" : NA);
const RX = Object.fromEntries(LANGS.map((l) => [l, { choice: word(PACKS[l].choice, PACKS[l].loose), score: word(PACKS[l].score.replace(/\\d\+(?!\\s)/g, "\\d+(?!\\s*\\p{L})"), PACKS[l].loose), lead: PACKS[l].lead ? new RegExp(`^\\s*(?:${PACKS[l].lead})\\s*`, "iu") : /^(?!)/u }])) as Record<Lang, { choice: RegExp; score: RegExp; lead: RegExp }>;

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
    ? new RegExp(`${p.from ? `(?:(?:${p.from})\\s*)?` : ""}(\\d{1,2})\\s*(?:-|–|—|〜|~|${p.to})\\s*(\\d{1,2})|(\\d{1,2})\\s*(?:${p.outOf})`, "iu")
    : new RegExp(`${NB}(?:(?:${p.from})\\s+)?(\\d{1,2})\\s*(?:-|–|—|${NB}(?:${p.to})${NA})\\s*(\\d{1,2})${NA}|${NB}(?:${p.outOf})\\s+(\\d{1,2})${NA}(?!\\s*\\p{L})`, "iu"));
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
  const s = c.replace(RX[lang].lead, "").replace(/^[¿¡]\s*/u, "").replace(/[\s,;:،、，．。.]+$/u, "").trim();
  const q = s.charAt(0).toLocaleUpperCase() + s.slice(1);
  return /[?？؟]$/u.test(q) ? q : `${q}${lang === "ar" ? "؟" : lang === "ja" ? "？" : "?"}`;
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
        id: slug(stem || c, taken, l), kind: "choice", text: asQuestion(stem || c, l), options: opts, source: c, lang: l,
        explain: (opts.length ? `a selection verb plus ${opts.length} options named in the task -> choice` : "a selection verb -> choice, but the task names no options") + tag,
        ...(opts.length ? {} : { needs_input: "list the options to choose between (2 to 50); the translator will not invent them" }),
        routing: { minConfidence: 0.6 },
      });
    } else if (RX[l].score.test(c)) {
      const { levels, why, matched } = levelsFor(c, l);
      const text = (matched ? c.replace(matched, "") : c).replace(/\s{2,}/g, " ").trim();
      questions.push({ id: slug(c, taken, l), kind: "score", text: asQuestion(text, l), levels, source: c, lang: l, explain: `a rating verb -> score; ${why}${tag}`, routing: { min: Math.ceil((levels.length - 1) / 2) } });
    } else {
      questions.push({ id: slug(c, taken, l), kind: "noul", text: asQuestion(c, l), source: c, lang: l, explain: `a statement that is true or false -> noul (the probability it is true)${tag}`, routing: { gte: 0.5 } });
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
      const conf = typeof a.confidence === "number" ? a.confidence : null;
      // a rating is a centre of mass: when the model is spread across levels it clears a threshold by accident
      if (r.minConfidence !== undefined && conf !== null && conf < r.minConfidence) {
        decisions.push({ id: a.id, outcome: "review", reason: `score ${v} at confidence ${conf.toFixed(2)}, below ${r.minConfidence}: a person should look` });
        continue;
      }
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      decisions.push({ id: a.id, outcome: ok ? "pass" : "fail", reason: `score ${v} against ${r.min !== undefined ? `>= ${r.min}` : ""}${r.max !== undefined ? ` <= ${r.max}` : ""}`.trim() });
    }
  }
  const branch = decisions.some((d) => d.outcome === "review") ? "review" : decisions.every((d) => d.outcome === "pass") && decisions.length > 0 ? "pass" : "fail";
  return { decisions, allPass: branch === "pass", branch };
}


/* ── REPLY: answers -> sentences in the asker's language (_TYPED_TRANSLATE_v3_, 2026-09-21) ──────
 * The third leg, for chat surfaces. A person asked in their own language; the model answered in
 * numbers; this says the numbers back as sentences in that language. Like the rest of the layer it is
 * templates, not a model: the question, the option and the level are echoed exactly as the person
 * wrote them, and only the glue around them ("Yes, 97% sure", "passing this to a person") is
 * translated. So nothing is paraphrased, nothing is invented, and the same answers always read the same.
 * A voice is one row of short strings: adding a language is adding a row. */
interface Voice { yes: string; likelyYes: string; unsure: string; likelyNo: string; no: string; choice: string; choiceLow: string; pos: string; conf: string; invalid: string; pass: string; fail: string; review: string; needOptions: string }
const VOICES: Record<Lang, Voice> = {
  en: { yes: "Yes ({pct}% sure)", likelyYes: "Probably yes ({pct}%)", unsure: "Hard to say ({pct}% likely)", likelyNo: "Probably not ({pct}%)", no: "No ({pct}% sure)", choice: "{value} ({pct}% confident)", choiceLow: "Probably {value}, but not sure ({pct}%)", pos: " ({n} of {max})", conf: ", {pct}% confident", invalid: "No valid answer", pass: "Every check passed.", fail: "At least one check did not pass.", review: "Not sure enough: I am passing this to a person.", needOptions: "List the options to choose between, and I will pick one." },
  es: { yes: "Sí ({pct}% de certeza)", likelyYes: "Probablemente sí ({pct}%)", unsure: "Difícil de decir ({pct}% de probabilidad)", likelyNo: "Probablemente no ({pct}%)", no: "No ({pct}% de certeza)", choice: "{value} ({pct}% de confianza)", choiceLow: "Probablemente {value}, pero no es seguro ({pct}%)", pos: " ({n} de {max})", conf: ", {pct}% de confianza", invalid: "Sin respuesta válida", pass: "Todas las comprobaciones pasaron.", fail: "Al menos una comprobación no pasó.", review: "No hay suficiente certeza: lo paso a una persona.", needOptions: "Indica las opciones entre las que elegir y escogeré una." },
  de: { yes: "Ja ({pct} % sicher)", likelyYes: "Wahrscheinlich ja ({pct} %)", unsure: "Schwer zu sagen ({pct} % wahrscheinlich)", likelyNo: "Wahrscheinlich nicht ({pct} %)", no: "Nein ({pct} % sicher)", choice: "{value} ({pct} % Konfidenz)", choiceLow: "Vermutlich {value}, aber unsicher ({pct} %)", pos: " ({n} von {max})", conf: ", {pct} % Konfidenz", invalid: "Keine gültige Antwort", pass: "Alle Prüfungen bestanden.", fail: "Mindestens eine Prüfung ist nicht bestanden.", review: "Nicht sicher genug: Ich gebe das an einen Menschen weiter.", needOptions: "Nenne die Optionen, zwischen denen gewählt werden soll, dann wähle ich eine." },
  fr: { yes: "Oui (sûr à {pct} %)", likelyYes: "Probablement oui ({pct} %)", unsure: "Difficile à dire ({pct} % de chances)", likelyNo: "Probablement pas ({pct} %)", no: "Non (sûr à {pct} %)", choice: "{value} (confiance {pct} %)", choiceLow: "Probablement {value}, sans certitude ({pct} %)", pos: " ({n} sur {max})", conf: ", confiance {pct} %", invalid: "Pas de réponse valide", pass: "Tous les contrôles sont passés.", fail: "Au moins un contrôle n'est pas passé.", review: "Pas assez de certitude : je transmets à une personne.", needOptions: "Indiquez les options entre lesquelles choisir, et j'en choisirai une." },
  pt: { yes: "Sim ({pct}% de certeza)", likelyYes: "Provavelmente sim ({pct}%)", unsure: "Difícil dizer ({pct}% de probabilidade)", likelyNo: "Provavelmente não ({pct}%)", no: "Não ({pct}% de certeza)", choice: "{value} ({pct}% de confiança)", choiceLow: "Provavelmente {value}, mas sem certeza ({pct}%)", pos: " ({n} de {max})", conf: ", {pct}% de confiança", invalid: "Sem resposta válida", pass: "Todas as verificações passaram.", fail: "Pelo menos uma verificação não passou.", review: "Não há certeza suficiente: vou passar a uma pessoa.", needOptions: "Indica as opções entre as quais escolher e eu escolho uma." },
  it: { yes: "Sì (sicuro al {pct}%)", likelyYes: "Probabilmente sì ({pct}%)", unsure: "Difficile da dire ({pct}% di probabilità)", likelyNo: "Probabilmente no ({pct}%)", no: "No (sicuro al {pct}%)", choice: "{value} (confidenza {pct}%)", choiceLow: "Probabilmente {value}, ma non è certo ({pct}%)", pos: " ({n} di {max})", conf: ", confidenza {pct}%", invalid: "Nessuna risposta valida", pass: "Tutti i controlli sono superati.", fail: "Almeno un controllo non è superato.", review: "Non abbastanza certo: lo passo a una persona.", needOptions: "Indica le opzioni tra cui scegliere e ne sceglierò una." },
  pl: { yes: "Tak (pewność {pct}%)", likelyYes: "Raczej tak ({pct}%)", unsure: "Trudno powiedzieć (prawdopodobieństwo {pct}%)", likelyNo: "Raczej nie ({pct}%)", no: "Nie (pewność {pct}%)", choice: "{value} (pewność {pct}%)", choiceLow: "Prawdopodobnie {value}, ale bez pewności ({pct}%)", pos: " ({n} z {max})", conf: ", pewność {pct}%", invalid: "Brak poprawnej odpowiedzi", pass: "Wszystkie warunki spełnione.", fail: "Co najmniej jeden warunek nie jest spełniony.", review: "Za mało pewności: przekazuję to człowiekowi.", needOptions: "Podaj opcje do wyboru, a wybiorę jedną." },
  nl: { yes: "Ja ({pct}% zeker)", likelyYes: "Waarschijnlijk wel ({pct}%)", unsure: "Moeilijk te zeggen ({pct}% kans)", likelyNo: "Waarschijnlijk niet ({pct}%)", no: "Nee ({pct}% zeker)", choice: "{value} ({pct}% zekerheid)", choiceLow: "Waarschijnlijk {value}, maar niet zeker ({pct}%)", pos: " ({n} van {max})", conf: ", {pct}% zekerheid", invalid: "Geen geldig antwoord", pass: "Alle controles zijn geslaagd.", fail: "Ten minste één controle is niet geslaagd.", review: "Niet zeker genoeg: ik geef dit door aan een mens.", needOptions: "Noem de opties waaruit gekozen moet worden, dan kies ik er één." },
  ru: { yes: "Да (уверенность {pct}%)", likelyYes: "Скорее да ({pct}%)", unsure: "Трудно сказать (вероятность {pct}%)", likelyNo: "Скорее нет ({pct}%)", no: "Нет (уверенность {pct}%)", choice: "{value} (уверенность {pct}%)", choiceLow: "Вероятно, {value}, но без уверенности ({pct}%)", pos: " ({n} из {max})", conf: ", уверенность {pct}%", invalid: "Нет корректного ответа", pass: "Все проверки пройдены.", fail: "Как минимум одна проверка не пройдена.", review: "Недостаточно уверенности: передаю человеку.", needOptions: "Перечислите варианты для выбора, и я выберу один." },
  ja: { yes: "はい（確信度{pct}%）", likelyYes: "おそらくはい（{pct}%）", unsure: "判断が難しいです（可能性{pct}%）", likelyNo: "おそらくいいえ（{pct}%）", no: "いいえ（確信度{pct}%）", choice: "{value}（確信度{pct}%）", choiceLow: "おそらく{value}ですが、確信はありません（{pct}%）", pos: "（{max}段階中{n}）", conf: "、確信度{pct}%", invalid: "有効な回答がありません", pass: "すべての確認を通過しました。", fail: "通過しなかった確認があります。", review: "確信が足りないため、担当者に確認を依頼します。", needOptions: "選択肢を挙げてください。その中から一つ選びます。" },
  ar: { yes: "نعم (بثقة {pct}%)", likelyYes: "على الأرجح نعم ({pct}%)", unsure: "يصعب الجزم (احتمال {pct}%)", likelyNo: "على الأرجح لا ({pct}%)", no: "لا (بثقة {pct}%)", choice: "{value} (بثقة {pct}%)", choiceLow: "على الأرجح {value}، لكن دون يقين ({pct}%)", pos: " ({n} من {max})", conf: "، بثقة {pct}%", invalid: "لا توجد إجابة صالحة", pass: "اجتازت جميع الفحوص.", fail: "لم يجتز أحد الفحوص على الأقل.", review: "الثقة غير كافية: سأحيل الأمر إلى شخص.", needOptions: "اذكر الخيارات المتاحة للاختيار، وسأختار واحدًا منها." },
};
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const pct = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100);
/** a clause the person wrote, closed with a full stop in its own script so the answer reads as the next sentence */
const said = (t: string, lang: Lang) => (/[.!?。．？؟:：]$/u.test(t.trim()) ? t.trim() : `${t.trim()}${lang === "ja" ? "。" : "."}`);
const MARK = { pass: "✓", fail: "✗", review: "?" } as const;

export interface ReplyQuestion { id: string; text?: string; source?: string; levels?: string[] | string; lang?: string }
export interface ReplyLine { id: string; question: string; answer: string; outcome: "pass" | "fail" | "review" | null }
export interface Reply { lang: Lang; lines: ReplyLine[]; verdict: string | null; flagHuman: boolean; text: string }

/** REPLY: say typed answers back as sentences. `lang` pins the language; otherwise it is the language most
 *  of the questions were written in. `decisions`/`branch` (from `decide`) add a mark per line and a verdict. */
export function reply(answers: AnswerLike[], opts: { lang?: Lang; questions?: ReplyQuestion[]; decisions?: Decision[]; branch?: "pass" | "fail" | "review"; /** clauses that named a selection without options: not asked, and said so in the person's language */ needsInput?: ReplyQuestion[] } = {}): Reply {
  const qById = new Map((opts.questions ?? []).map((q) => [q.id, q]));
  let lang = opts.lang;
  if (!lang || !VOICES[lang]) {
    const votes = new Map<Lang, number>();
    for (const q of [...(opts.questions ?? []), ...(opts.needsInput ?? [])]) { const l = (q.lang && VOICES[q.lang as Lang] ? q.lang : q.text ? detectLang(q.text) : "en") as Lang; votes.set(l, (votes.get(l) ?? 0) + 1); }
    lang = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";
  }
  const v = VOICES[lang];
  const dById = new Map((opts.decisions ?? []).map((d) => [d.id, d]));
  const lines: ReplyLine[] = answers.map((a) => {
    const q = qById.get(a.id);
    const outcome = dById.get(a.id)?.outcome ?? null;
    let answer: string;
    if (a.schema_ok === false || a.value === null || a.value === undefined) answer = v.invalid;
    else if (a.kind === "noul") {
      const p = typeof a.p === "number" ? a.p : a.value === true ? 1 : 0;
      answer = p >= 0.8 ? fill(v.yes, { pct: pct(p) }) : p >= 0.6 ? fill(v.likelyYes, { pct: pct(p) }) : p > 0.4 ? fill(v.unsure, { pct: pct(p) }) : p > 0.2 ? fill(v.likelyNo, { pct: pct(1 - p) }) : fill(v.no, { pct: pct(1 - p) });
    } else if (a.kind === "choice") {
      const c = typeof a.confidence === "number" ? a.confidence : null;
      const low = outcome === "review" || (outcome === null && c !== null && c < 0.6);
      answer = c === null ? String(a.value) : fill(low ? v.choiceLow : v.choice, { value: String(a.value), pct: pct(c) });
    } else {
      const asList = (raw: unknown): string[] => Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\s*\|\s*/).filter(Boolean) : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).map(String) : [];
      const fromLegend = asList((a as AnswerLike & { legend?: unknown }).legend);
      const levels = fromLegend.length ? fromLegend : asList(q?.levels);
      const n = Math.round(Number(a.value));
      const label = (levels[n] ?? String(a.value)).replace(/ \((?:lowest|highest)\)$/, "");
      const where = levels.length ? fill(v.pos, { n: n + 1, max: levels.length }) : "";
      const c = typeof a.confidence === "number" ? a.confidence : null;
      // under 0.4 the model is spread across levels: the label is its centre of mass, not a verdict
      answer = c !== null && (c < 0.4 || outcome === "review") ? fill(v.choiceLow, { value: `${label}${where}`, pct: pct(c) }) : `${label}${where}${c !== null ? fill(v.conf, { pct: pct(c) }) : ""}`;
    }
    return { id: a.id, question: said(q?.source ?? q?.text ?? a.id, lang as Lang), answer, outcome };
  });
  for (const q of opts.needsInput ?? []) lines.push({ id: q.id, question: said(q.source ?? q.text ?? q.id, lang), answer: v.needOptions, outcome: null });
  const branch = opts.branch ?? null;
  const verdict = branch ? v[branch] : null;
  const body = lines.map((l) => `${l.outcome ? `${MARK[l.outcome]} ` : ""}${l.question} ${l.answer}`);
  return { lang, lines, verdict, flagHuman: branch === "review" || lines.some((l) => l.outcome === "review"), text: [...body, ...(verdict ? [verdict] : [])].join("\n") };
}
