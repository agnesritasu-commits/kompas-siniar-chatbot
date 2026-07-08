import fs from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const MISSING_INFO_MESSAGE = "Informasi tersebut belum tersedia di data episode ini.";
const MAX_CONTEXT_ROWS = 8;
const MAX_OPENAI_CONTEXT_ROWS = 30;
const MAX_OPENAI_CONTEXT_CHARS = 32000;
const MAX_OPENAI_TRANSCRIPT_CHARS = 18000;
const MAX_OPENAI_ROW_CHARS = 2800;
const MAX_QUESTION_LENGTH = 600;
const MIN_RELEVANCE_SCORE = 6;
const LOW_VALUE_TOPICS = new Set(["nomor video", "judul", "link video", "tanggal tayang yyyymmdd", "bentuk video"]);
const DOMAIN_TERM_KEYWORDS = [
  "dmo domestic market obligation kewajiban pasar domestik",
  "hop hari operasi pembangkit stok batu bara pltu",
  "pltu pembangkit listrik tenaga uap listrik batu bara",
  "rkab rencana kerja anggaran biaya produksi tambang",
  "pln perusahaan listrik negara pengguna batu bara",
  "data stok sistem monitoring terintegrasi koordinasi kementerian esdm pln",
  "batubara batu bara tambang pertambangan energi pasokan",
  "kurs dolar dollar as rupiah nilai tukar pelemahan mata uang",
  "desa pedesaan masyarakat desa dampak ekonomi harga barang",
  "litbang kompas survei data analisis penelitian ekonomi"
].join(" ");
const CONTENT_TOPICS = new Set([
  "ringkasan isi siniar",
  "poin penting siniar",
  "deskripsi episode",
  "kenapa siniar penting",
  "catenaccio",
  "isi lengkap siniar sampai menit 6",
  "isi lengkap siniar sampai menit 6 57",
  "ringkasan dan time stamp"
]);
const PERSON_TOPICS = new Set(["nama host", "profil host", "nama narasumber", "profil narasumber"]);

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\s().-]?){8,}\d/;

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gunakan metode POST." });
  }

  try {
    const body = await readJson(req);
    const question = String(body.question || "").trim();
    const podcastId = String(body.podcastId || "").trim();
    const episodeId = String(body.episodeId || "").trim();
    const history = sanitizeHistory(body.history);

    if (!question) {
      return res.status(400).json({ error: "Pertanyaan belum diisi." });
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: "Pertanyaan terlalu panjang. Ringkas pertanyaan terlebih dahulu." });
    }

    if (containsSensitiveData(question)) {
      return res.status(400).json({
        error: "Jangan kirim data pribadi seperti email, nomor telepon, alamat rumah, atau informasi sensitif."
      });
    }

    const answerLanguage = detectQuestionLanguage(question);
    const utilityAnswer = getUtilityAnswer(question, answerLanguage);
    if (utilityAnswer) {
      return res.status(200).json({
        answer: utilityAnswer,
        mode: "utility",
        sources: []
      });
    }

    const config = await loadConfig();
    const podcast = selectPodcast(config, podcastId);
    const rows = normalizeSpreadsheetRows(await fetchSpreadsheetRows(podcast.csvUrl), podcast.id);
    const filteredRows = filterRows(rows, podcast.id, episodeId);
    const normalizedQuestion = normalizeQuestionEntities(question, filteredRows);
    const followUpContext = getFollowUpContext(normalizedQuestion, history);
    const personContext = followUpContext || getDirectPersonContext(normalizedQuestion, filteredRows);
    const directAnswer = getDirectDataAnswer(normalizedQuestion, filteredRows);
    const rankingQuestion = expandQuestionForSearch(resolveFollowUpQuestion(normalizedQuestion, personContext));
    const rankedRows = rankRows(filteredRows, rankingQuestion, {
      knownEntityReference: hasKnownEntityReference(rankingQuestion, filteredRows)
    });
    const relevantRows = (directAnswer?.rows?.length ? directAnswer.rows : rankedRows).slice(0, MAX_CONTEXT_ROWS);

    if (!directAnswer && !relevantRows.length && !process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        answer: makeMissingInfoAnswer(filteredRows, podcast, answerLanguage),
        mode: "fallback",
        sources: []
      });
    }

    const fallbackAnswer = directAnswer?.text || (relevantRows.length
      ? makeFallbackAnswer(relevantRows, filteredRows, personContext)
      : missingInfoMessageForLanguage(answerLanguage));
    const contextRows = buildOpenAIContextRows(directAnswer?.rows || relevantRows, filteredRows);
    const sourceRows = directAnswer?.rows?.length ? directAnswer.rows : relevantRows;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        answer: fallbackAnswer,
        mode: "fallback",
        sources: formatSources(sourceRows)
      });
    }

    try {
      const answer = await askOpenAI(normalizedQuestion, contextRows, podcast, fallbackAnswer, answerLanguage);
      const finalAnswer = isMissingInfoAnswer(answer.text)
        ? makeMissingInfoAnswer(filteredRows, podcast, answerLanguage)
        : answer.text || fallbackAnswer;

      return res.status(200).json({
        answer: finalAnswer,
        mode: "openai",
        model: answer.model,
        sources: isMissingInfoAnswer(answer.text) ? [] : formatSources(sourceRows)
      });
    } catch (error) {
      console.error("OpenAI unavailable, using fallback:", error);
      return res.status(200).json({
        answer: fallbackAnswer,
        mode: "fallback",
        sources: formatSources(sourceRows)
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "API belum bisa memproses pertanyaan. Coba beberapa saat lagi." });
  }
}

function getDirectDataAnswer(question, rows) {
  return getEpisodeAnswer(question, rows) ||
    getExactTermAnswer(question, rows) ||
    getContextAnswer(question, rows) ||
    getEvaluativeAnswer(question, rows) ||
    getSpeakerStatementAnswer(question, rows) ||
    getContentAnswer(question, rows) ||
    getExistenceAnswer(question, rows);
}

function buildOpenAIContextRows(primaryRows = [], allRows = []) {
  const anchorTopics = new Set([
    "nama siniar",
    "judul",
    "nama narasumber",
    "profil narasumber",
    "nama host",
    "profil host",
    "ringkasan isi siniar",
    "kenapa siniar penting",
    "poin penting siniar",
    "deskripsi episode",
    "ringkasan dan time stamp"
  ]);

  const transcriptRows = allRows.filter((row) => isTranscriptTopic(row.topic));
  const anchorRows = allRows.filter((row) => {
    const topic = normalizeText(row.topic);
    return (anchorTopics.has(topic) ||
      topic.startsWith("nama narasumber") ||
      topic.startsWith("profil narasumber")) &&
      !isTranscriptTopic(row.topic);
  });

  return uniqueRows([
    ...primaryRows,
    ...anchorRows,
    ...transcriptRows,
    ...allRows
  ]).slice(0, MAX_OPENAI_CONTEXT_ROWS);
}

function uniqueRows(rows = []) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = [
      normalizeText(row.topic),
      normalizeLooseText(row.question),
      normalizeLooseText(row.answer || row.ringkasan || row.summary || row.content)
    ].join("|");

    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function isTranscriptTopic(topic) {
  const normalized = normalizeText(topic);
  return normalized.includes("isi lengkap") ||
    normalized.includes("transkrip") ||
    normalized.includes("timestamp") ||
    normalized.includes("time stamp");
}

function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;
  const origin = allowed.length && allowed.includes(requestOrigin) ? requestOrigin : "*";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function containsSensitiveData(value) {
  return emailPattern.test(value) || phonePattern.test(value);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8).map((item) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: String(item?.content || "").slice(0, 700),
    sources: Array.isArray(item?.sources) ? item.sources.slice(0, 3) : []
  }));
}

function normalizeQuestionEntities(question, rows = []) {
  let text = String(question || "").trim();
  if (!text) return "";

  const knownNames = [
    ...findAnswersByTopicBase(rows, "nama narasumber"),
    findAnswerByTopic(rows, "nama host"),
    findAnswerByTopic(rows, "nama siniar")
  ].filter(Boolean).join(" ").toLowerCase();

  const hasKnownName = (...tokens) => tokens.some((token) => knownNames.includes(token));
  const rules = [
    {
      when: hasKnownName("chatib", "basri"),
      pattern: /\b(?:muhamad|muhammad|mohammad|mohamad)?\s*(?:khatib|hatib|catib|catip|cetib|cetip|chatip|chat it|cati|cathy)\s+(?:basri|basry|basrie)\b|\b(?:basry|basrie)\b/giu,
      replacement: "Muhammad Chatib Basri"
    },
    {
      when: hasKnownName("chatib", "basri"),
      pattern: /\b(?:khatib|hatib|catib|catip|cetib|cetip|chatip|chat it|cati|cathy)\b/giu,
      replacement: "Chatib"
    },
    {
      when: hasKnownName("agung", "timbul", "laksana"),
      pattern: /\b(?:ef\s*ex|efeks|efek|fx|f\s*x|epik)\s+agung(?:\s+timbul)?(?:\s+laksana)?\b|\b(?:agung|timbul|laksana)\b/giu,
      replacement: "FX Agung Timbul Laksana"
    },
    {
      when: hasKnownName("aris", "prasetyo"),
      pattern: /\b(?:aris|haris)\s+(?:prasetyo|prasetio|praseto|prasetya)\b|\b(?:aris|haris|prasetyo|prasetio|prasetya)\b/giu,
      replacement: "Aris Prasetyo"
    },
    {
      when: hasKnownName("ardhi", "ishak"),
      pattern: /\b(?:ardi|ardhy|ardy|ardhi|hardy|hardhi)\s+(?:ishak|ishaq|isak|isaac)\b|\b(?:ardhi|ardi|ardhy|ardy|ishak|ishaq|isak)\b/giu,
      replacement: "Ardhi Ishak"
    },
    {
      when: hasKnownName("agustina", "purwanti"),
      pattern: /\bagustina\s+(?:purwanti|purwanto|perwanti|perwanto)\b|\b(?:agustina|purwanti|purwanto|perwanti)\b/giu,
      replacement: "Agustina Purwanti"
    },
    {
      when: hasKnownName("karina", "isna", "irawan"),
      pattern: /\bkarina\s+(?:isna|ishna|isnah|isna')\s+(?:irawan|erawan)\b|\b(?:karina|isna|ishna|irawan|erawan)\b/giu,
      replacement: "Karina Isna Irawan"
    },
    {
      when: hasKnownName("susy", "sartika", "rumbo"),
      pattern: /\b(?:susi|susy|suzy)\s+sartika\s+(?:rumbo|rumba|rumboh|rambo|rombo)\b|\b(?:susi|susy|suzy|rumbo|rumba|rambo|rombo)\b/giu,
      replacement: "Susy Sartika Rumbo"
    },
    {
      when: true,
      pattern: /\b(?:d\s*m\s*o|di em o|dimo)\b/giu,
      replacement: "DMO"
    },
    {
      when: true,
      pattern: /\b(?:h\s*o\s*p|ha o pe)\b/giu,
      replacement: "HOP"
    },
    {
      when: true,
      pattern: /\b(?:p\s*l\s*t\s*u|pe el te u|pel tu)\b/giu,
      replacement: "PLTU"
    }
  ];

  for (const rule of rules) {
    if (rule.when) text = text.replace(rule.pattern, rule.replacement);
  }

  return text.replace(/\s+/gu, " ").trim();
}

function getFollowUpContext(question, history) {
  const text = normalizeText(question);
  const pronounQuestion = /\b(dia|ia|beliau|orang itu|tokoh itu|narasumber itu|host itu)\b/u.test(text);
  if (!pronounQuestion || !history.length) return null;

  const recentAssistant = [...history].reverse().find((item) => item.role === "assistant");
  const recentSources = recentAssistant?.sources || [];
  const sourceTopics = recentSources.map((source) => normalizeText(source.topic)).join(" ");
  const firstSourceTopic = normalizeText(recentSources[0]?.topic || "");
  const recentAnswer = recentAssistant?.content || "";
  const mentionedPerson = extractPersonName(recentAnswer);

  if (mentionedPerson === "FX Agung Timbul Laksana" || /\bhost itu\b/u.test(text)) {
    return {
      target: "host",
      label: mentionedPerson || "FX Agung Timbul Laksana"
    };
  }

  if (mentionedPerson === "Muhammad Chatib Basri" || /\bnarasumber itu\b/u.test(text)) {
    return {
      target: "narasumber",
      label: mentionedPerson || "Muhammad Chatib Basri"
    };
  }

  if (firstSourceTopic.includes("host") || (sourceTopics.includes("host") && !sourceTopics.includes("narasumber"))) {
    return {
      target: "host",
      label: "FX Agung Timbul Laksana"
    };
  }

  if (firstSourceTopic.includes("narasumber") || sourceTopics.includes("narasumber")) {
    return {
      target: "narasumber",
      label: "Muhammad Chatib Basri"
    };
  }

  return null;
}

function resolveFollowUpQuestion(question, followUpContext) {
  if (!followUpContext) return question;
  if (followUpContext.target === "narasumber") {
    return `${question} profil narasumber alasan pemilihan narasumber ${followUpContext.label}`;
  }
  if (followUpContext.target === "host") {
    return `${question} profil host nama host ${followUpContext.label}`;
  }
  return question;
}

function expandQuestionForSearch(question) {
  const text = normalizeLooseText(`${question} ${normalizeText(question)}`);
  const expansions = [];
  const rules = [
    [/\b(ngomongin|ngomong|diomongin|omongin|omong|bahasin|ngebahas|bahas|dibahas|ceritain|cerita|ulas|kupas)\b/u, "ringkasan isi siniar topik utama pembahasan dibahas disampaikan"],
    [/\b(bilang|dibilang|katanya|kata|nyebut|sebut|disebut|sampaikan|disampaikan|jelasin|menjelaskan)\b/u, "pernyataan narasumber pembicara menyampaikan menjelaskan"],
    [/\b(pembicara|tamu)\b/u, "narasumber nama narasumber profil narasumber"],
    [/\b(host|pembawa|pewara|moderator)\b/u, "host nama host profil host"],
    [/\b(intinya|inti|garis besar|kesimpulan|simpulan|summary|ringkasannya|ringkas|rangkuman)\b/u, "ringkasan isi siniar poin penting topik utama"],
    [/\b(konteks|latar|background|awalnya|mulanya|situasinya|kenapa dibuat|mengapa dibuat)\b/u, "deskripsi episode konteks latar belakang kenapa siniar penting"],
    [/\b(problem|masalah|persoalan|isu|sengkarut|kendala|tantangan|hambatan)\b/u, "persoalan masalah isu tantangan ringkasan isi siniar poin penting"],
    [/\b(solusi|saran|usul|jalan keluar|rekomendasi|cara mencegah)\b/u, "solusi usulan rekomendasi poin penting ringkasan isi siniar"],
    [/\b(menarik|penting|kenapa perlu|perlu ditonton|layak ditonton|manfaat)\b/u, "kenapa siniar ini penting alasan manfaat rekomendasi"],
    [/\b(maksud|artinya|arti|definisi|apa sih|itu apa)\b/u, "apa itu definisi istilah maksud"],
    [/\b(data|stok|monitoring|pantau|terintegrasi)\b/u, "data stok sistem monitoring terintegrasi koordinasi"],
    [/\b(listrik|mati lampu|pemadaman|byarpet)\b/u, "PLTU pasokan batu bara pemadaman listrik krisis"],
    [/\b(sepakbola|bola|piala dunia|catenaccio)\b/u, "sepak bola Piala Dunia catenaccio ekonomi"]
  ];

  for (const [pattern, expansion] of rules) {
    if (pattern.test(text)) expansions.push(expansion);
  }

  if (!expansions.length) return question;
  return `${question} ${expansions.join(" ")}`;
}

function getEpisodeAnswer(question, rows) {
  const text = normalizeLooseText(question);
  const evaluativeQuestion = /\b(menarik|penting|bagus|rekomendasi|layak|disimak|didengar|manfaat|kenapa|mengapa)\b/u.test(text);
  const contextQuestion = isContextQuestion(question, text);
  const asksEpisodeTitle = !evaluativeQuestion && !contextQuestion &&
    (/\b(episode|judul|tema)\b.*\b(apa|berapa|kali ini)\b|\b(apa|ini)\b.*\b(episode|judul|tema)\b/u.test(text));
  if (!asksEpisodeTitle) return null;

  const title = findAnswerByTopic(rows, "judul");
  if (!title) return null;

  const podcastName = findAnswerByTopic(rows, "nama siniar") || "siniar ini";
  const selectedRows = rows.filter((row) => {
    const topic = normalizeText(row.topic);
    return topic === "judul" || topic === "nama siniar" || topic === "ringkasan isi siniar";
  });

  return {
    text: `Siniar: ${podcastName}. Episode kali ini berjudul "${title}".`,
    rows: selectedRows
  };
}

function getContextAnswer(question, rows) {
  if (!isContextQuestion(question)) return null;

  const podcastName = findAnswerByTopic(rows, "nama siniar");
  const description = findAnswerByTopic(rows, "deskripsi episode");
  const summary = findAnswerByTopic(rows, "ringkasan isi siniar");
  const importance = findAnswerByTopic(rows, "kenapa siniar ini penting");
  const title = findAnswerByTopic(rows, "judul");
  const parts = [
    description ? `Konteksnya: ${description}` : "",
    summary ? `Intinya, episode ini membahas ${summary}` : "",
    importance ? `Nilai pentingnya: ${importance}` : ""
  ].filter(Boolean);

  if (!parts.length) return null;

  const selectedRows = rows.filter((row) => {
    const topic = normalizeText(row.topic);
    return topic === "deskripsi episode" ||
      topic === "ringkasan isi siniar" ||
      topic === "kenapa siniar penting" ||
      topic === "nama siniar" ||
      topic === "judul";
  });

  return {
    text: [
      podcastName ? `Siniar: ${podcastName}.` : "",
      title ? `Episode: "${title}".` : "",
      ...parts
    ].filter(Boolean).join("\n"),
    rows: selectedRows
  };
}

function getExactTermAnswer(question, rows) {
  if (!isTermQuestion(question)) return null;

  const termTokens = Array.from(tokenize(question));
  if (!termTokens.length) return null;

  const row = rows.find((candidate) => {
    const topic = normalizeLooseText(candidate.topic);
    const searchableTopic = normalizeText(candidate.topic);
    return topic.startsWith("apa itu") && termTokens.some((token) => searchableTopic.includes(token));
  });

  if (!row?.answer) return null;

  return {
    text: makeFriendlyDataAnswer(row.answer),
    rows: [row]
  };
}

function getEvaluativeAnswer(question, rows) {
  const text = normalizeLooseText(question);
  const asksEvaluation = /\b(menarik|penting|bagus|rekomendasi|layak|disimak|didengar|manfaat|kenapa|mengapa)\b/u.test(text);
  if (!asksEvaluation) return null;

  const answer = findAnswerByTopic(rows, "kenapa siniar ini penting");
  if (!answer) return null;

  const selectedRows = rows.filter((row) => {
    const topic = normalizeText(row.topic);
    return topic === "kenapa siniar penting";
  });

  return {
    text: makeFriendlyDataAnswer(answer),
    rows: selectedRows
  };
}

function getContentAnswer(question, rows) {
  const text = normalizeLooseText(question);
  const asksContent = /\b(apa|hal|isi|topik|pokok|bahasan|bahas|dibahas|membahas|disampaikan|sampaikan|bilang|dibilang|katakan|dikatakan|ucap|diucapkan|omong|diomongkan|ngomong|cerita|diceritakan|inti|utama)\b.*\b(disampaikan|sampaikan|dibahas|membahas|bahas|bahasan|isi|isinya|topik|pokok|bilang|dibilang|katakan|dikatakan|ucap|diucapkan|omong|diomongkan|ngomong|cerita|diceritakan|inti|utama)\b/u.test(text);
  if (!asksContent) return null;

  const answer = findAnswerByTopic(rows, "ringkasan isi siniar") || findAnswerByTopic(rows, "deskripsi episode");
  if (!answer) return null;

  const selectedRows = rows.filter((row) => {
    const topic = normalizeText(row.topic);
    return topic === "ringkasan isi siniar" || topic === "deskripsi episode";
  });

  return {
    text: makeFriendlyDataAnswer(answer),
    rows: selectedRows
  };
}

function getSpeakerStatementAnswer(question, rows) {
  const text = normalizeLooseText(question);
  const asksSpeakerStatement = /\b(narasumber(?:nya)?|pembicara(?:nya)?|tamu(?:nya)?|dia|beliau)\b.*\b(bilang|dibilang|katakan|dikatakan|ucap|diucapkan|sampaikan|disampaikan|bahas|dibahas|membahas|omong|diomongkan|ngomong)\b|\b(apa|hal|isi|inti)\b.*\b(bilang|dibilang|katakan|dikatakan|ucap|diucapkan|sampaikan|disampaikan|bahas|dibahas|membahas|omong|diomongkan|ngomong)\b.*\b(narasumber(?:nya)?|pembicara(?:nya)?|tamu(?:nya)?|dia|beliau)\b/u.test(text);
  if (!asksSpeakerStatement) return null;

  const name = formatList(findAnswersByTopicBase(rows, "nama narasumber")) || "Narasumber";
  const answer = findBestContentAnswer(rows);
  if (!answer) return null;

  const selectedRows = rows.filter((row) => {
    const topic = normalizeText(row.topic);
    return CONTENT_TOPICS.has(topic) || topic.includes("isi lengkap") || topic.includes("transkrip") || topic.startsWith("nama narasumber");
  });

  return {
    text: makeSpeakerStatementText(name, answer),
    rows: selectedRows
  };
}

function findBestContentAnswer(rows) {
  const preferredTopics = [
    "ringkasan isi siniar",
    "poin penting siniar",
    "ringkasan dan time stamp",
    "deskripsi episode"
  ];

  for (const topic of preferredTopics) {
    const answer = findAnswerByTopic(rows, topic);
    if (answer) return answer;
  }

  const transcriptRow = rows.find((row) => {
    const topic = normalizeText(row.topic);
    return topic.includes("isi lengkap") || topic.includes("transkrip");
  });

  return transcriptRow?.answer || "";
}

function makeSpeakerStatementText(name, answer) {
  const points = extractAnswerPoints(answer, 4);
  if (!points.length) return `${name} menyampaikan bahwa ${answer}`;

  return [
    `${name} menyampaikan beberapa poin utama:`,
    ...points.map((point) => `- ${point}`)
  ].join("\n");
}

function getExistenceAnswer(question, rows) {
  const text = normalizeLooseText(question);
  const asksNarasumber = /\b(ada|punya|siapa)\b.*\b(narasumber(?:nya)?|pembicara(?:nya)?|tamu(?:nya)?)\b|\b(narasumber(?:nya)?|pembicara(?:nya)?|tamu(?:nya)?)\b.*\b(ada|siapa)\b/u.test(text);
  const asksHost = /\b(ada|punya|siapa)\b.*\b(host|pembawa acara|pewara)\b|\b(host|pembawa acara|pewara)\b.*\b(ada|siapa)\b/u.test(text);

  if (asksNarasumber) {
    const name = formatList(findAnswersByTopicBase(rows, "nama narasumber"));
    if (!name) return null;
    const selectedRows = rows.filter((row) => {
      const topic = normalizeText(row.topic);
      return topic.startsWith("nama narasumber") || topic.startsWith("profil narasumber");
    });

    return {
      text: `Ada. Pembicara atau narasumber episode ini adalah ${name}.`,
      rows: selectedRows
    };
  }

  if (asksHost) {
    const name = findAnswerByTopic(rows, "nama host");
    if (!name) return null;
    const selectedRows = rows.filter((row) => {
      const topic = normalizeText(row.topic);
      return topic === "nama host" || topic === "profil host";
    });

    return {
      text: `Ada. Host episode ini adalah ${name}.`,
      rows: selectedRows
    };
  }

  return null;
}

function getDirectPersonContext(question, rows) {
  const normalizedQuestion = normalizeText(question);
  if (!isPersonQuestion(question, normalizedQuestion)) return null;

  const queryTokens = tokenize(question);
  const candidates = [
    {
      target: "narasumber",
      name: formatList(findAnswersByTopicBase(rows, "nama narasumber"))
    },
    {
      target: "host",
      name: findAnswerByTopic(rows, "nama host")
    }
  ];

  const matched = candidates.find((candidate) => {
    if (!candidate.name) return false;
    const nameTokens = [...tokenize(candidate.name)];
    return nameTokens.some((token) => queryTokens.has(token));
  });

  if (!matched) return null;

  return {
    target: matched.target,
    label: matched.name
  };
}

function extractPersonName(value) {
  const text = String(value || "");
  if (/(?:Muhammad\s+)?Chatib(?:\s+Basri)?/i.test(text)) return "Muhammad Chatib Basri";
  if (/FX Agung/i.test(text)) return "FX Agung Timbul Laksana";
  return "";
}

function detectQuestionLanguage(value) {
  const text = normalizeLooseText(value);
  if (!text) return "id";

  const englishWords = [
    "hello", "hi", "thanks", "thank", "please", "what", "who", "why", "when", "where", "how",
    "does", "do", "did", "is", "are", "can", "could", "would", "tell", "explain", "summarize",
    "summary", "speaker", "guest", "host", "topic", "about", "discussed", "said", "mean",
    "meaning", "episode", "podcast", "watch"
  ];
  const indonesianWords = [
    "halo", "hai", "terima", "makasih", "tolong", "apa", "siapa", "kenapa", "mengapa",
    "bagaimana", "gimana", "jelaskan", "ringkas", "ringkasan", "narasumber", "pembicara",
    "siniar", "bahas", "dibahas", "dibilang", "disampaikan", "episode", "tonton"
  ];

  const englishScore = scoreLanguageWords(text, englishWords);
  const indonesianScore = scoreLanguageWords(text, indonesianWords);
  return englishScore > indonesianScore ? "en" : "id";
}

function scoreLanguageWords(text, words) {
  return words.reduce((score, word) => {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "u");
    return score + (pattern.test(text) ? 1 : 0);
  }, 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function missingInfoMessageForLanguage(language) {
  return language === "en"
    ? "That information is not available for this episode."
    : MISSING_INFO_MESSAGE;
}

function getUtilityAnswer(question, language = "id") {
  const text = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";

  const hasGreeting = /\b(halo|hallo|hai|hi|hello|pagi|siang|sore|malam|assalamualaikum|permisi)\b/u.test(text);
  const asksWellbeing = /\b(apa kabar|kabarmu|kabar|sehat|lagi apa)\b/u.test(text);
  const answersEnglish = language === "en";

  if (hasGreeting && asksWellbeing) {
    if (answersEnglish) {
      return "Welcome. I am well and ready to help. Please ask about this episode; I will answer briefly, politely, and clearly.";
    }
    return "Selamat datang. Kabar saya baik dan siap membantu. Silakan tanyakan isi episode; saya akan menjawab dengan singkat, sopan, dan informatif berdasarkan data.";
  }

  const greetingOnly = /^(halo|hallo|hai|hi|hello|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|assalamualaikum|permisi|met pagi|met siang|met sore|met malam)$/u;
  if (greetingOnly.test(text)) {
    if (answersEnglish) {
      return "Welcome. Please ask a question about this episode. I can help summarize it, explain the context, or clarify terms discussed.";
    }
    return "Selamat datang. Silakan ajukan pertanyaan tentang episode ini. Saya bisa membantu dengan jawaban ringkas, menjelaskan konteks, atau menjawab istilah yang dibahas.";
  }

  const wellbeingOnly = /^(apa kabar|gimana kabarmu|bagaimana kabarmu|kabar baik|sehat|sehat kah|lagi apa)$/u;
  if (wellbeingOnly.test(text)) {
    return "Terima kasih, saya siap membantu. Tanyakan saja isi episode, narasumber, konteks, atau istilah tertentu; saya akan menjawab secara singkat dan jelas.";
  }

  const identityOnly = /^(siapa kamu|kamu siapa|kamu apa|apa kamu|kamu ini apa|kamu itu apa|apa kamu ini|apa kamu itu|ini apa|chatbot apa|chatbot ini apa|apa ini|dia apa|ini bot apa|bot apa ini|bot ini apa|botnya apa|ini chatbot apa|asisten apa|asisten ini apa|asisten apa ini)$/u;
  const identityOnlyEnglish = /^(who are you|what are you|what is this|what can you do|what is this bot|what is this chatbot|what kind of assistant are you|what are your capabilities)$/u;
  if (identityOnly.test(text) || identityOnlyEnglish.test(text)) {
    if (answersEnglish) {
      return [
        "I am a conversation assistant for Kompas podcasts.",
        "My role is to read the available episode information and present short, polite, easy-to-understand answers.",
        "I do not search the internet or add facts beyond the episode material."
      ].join(" ");
    }
    return [
      "Saya asisten percakapan untuk siniar Kompas.",
      "Tugas saya membaca data episode yang tersedia, lalu menyajikannya dalam jawaban singkat, sopan, dan mudah dipahami.",
      "Saya tidak mencari informasi di internet dan tidak menambahkan fakta di luar data."
    ].join(" ");
  }

  const thanksOnly = /^(terima kasih|makasih|thanks|thank you|oke|ok|sip|baik|mantap|siap|nice|bagus)$/u;
  if (thanksOnly.test(text)) {
    if (answersEnglish) {
      return "You are welcome. Please continue if there is another part of the episode you would like to understand.";
    }
    return "Sama-sama. Silakan lanjutkan bila ada bagian episode yang ingin dipahami lebih jauh.";
  }

  const apologyOnly = /^(maaf|sorry|maaf ya|maaf tadi salah|sori)$/u;
  if (apologyOnly.test(text)) {
    if (answersEnglish) {
      return "No problem. Please continue with your question; I will help answer based on the available episode material.";
    }
    return "Tidak apa-apa. Silakan lanjutkan pertanyaannya; saya akan membantu menjawab berdasarkan data episode yang tersedia.";
  }

  const helpOnly = /^(bantuan|help|apa yang bisa kamu jawab|kamu bisa apa|dia bisa apa|bisa apa|bisa ngapain|apa kemampuannya|kemampuannya apa|apa kemampuanmu|apa fiturmu|fiturnya apa|fungsinya apa|gunanya apa|cara pakai|mau tanya apa|contoh pertanyaan|aku bisa tanya apa|saya bisa tanya apa)$/u;
  if (helpOnly.test(text)) {
    if (answersEnglish) {
      return [
        "I can help answer questions about this episode.",
        "- The episode title and podcast name.",
        "- The speaker, guest, and host.",
        "- A summary, main points, and why the episode matters.",
        "- Terms or context available in the episode material.",
        "- The link to watch the episode."
      ].join("\n");
    }
    return [
      "Saya dapat membantu menjawab pertanyaan tentang episode ini.",
      "- Judul episode dan nama siniar.",
      "- Narasumber dan host.",
      "- Ringkasan, pokok bahasan, dan alasan episode ini penting.",
      "- Istilah atau konteks yang tersedia di data.",
      "- Tautan untuk menonton episode."
    ].join("\n");
  }

  const unsupportedChatOnly = /^(cerita dong|ngobrol dong|temani aku|ayo ngobrol|boleh ngobrol|aku bosan|lucu dong|kasih jokes|bercanda dong)$/u;
  if (unsupportedChatOnly.test(text)) {
    if (answersEnglish) {
      return "I can respond politely to light conversation. For deeper information, please ask about the episode or the topic discussed.";
    }
    return "Saya dapat merespons percakapan ringan secara sopan. Untuk informasi lebih mendalam, silakan ajukan pertanyaan tentang episode atau topik yang dibahas.";
  }

  return "";
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function loadConfig() {
  const configPath = path.join(process.cwd(), "config", "podcasts.json");
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

function selectPodcast(config, requestedId) {
  const id = requestedId || config.defaultPodcastId;
  const podcast = config.podcasts.find((item) => item.id === id);
  if (!podcast) {
    throw new Error(`Podcast tidak ditemukan: ${id}`);
  }
  return podcast;
}

async function fetchSpreadsheetRows(csvUrl) {
  const response = await fetch(csvUrl, {
    headers: {
      "User-Agent": "kompas-siniar-chatbot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Gagal mengambil CSV: ${response.status}`);
  }

  const csv = await response.text();
  return parseCsv(csv);
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const headers = rows.shift()?.map(normalizeHeader) || [];
  return rows.map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (values[index] || "").trim();
    });
    return item;
  });
}

function normalizeSpreadsheetRows(rows, podcastId = "kompas-siniar") {
  if (!rows.length) return rows;

  const first = rows[0];
  const keyColumn = Object.keys(first).find((key) => key === "kunci" || key === "key");
  const valueColumn = Object.keys(first).find((key) => key !== keyColumn && key !== "podcast_id" && key !== "episode_id");

  if (!keyColumn || !valueColumn) return rows;

  const sourceUrl = rows.find((row) => row[keyColumn] === "link_video")?.[valueColumn] || "";
  const episodeTitle = rows.find((row) => row[keyColumn]?.trim() === "judul")?.[valueColumn] || "";
  const podcastName = rows.find((row) => row[keyColumn] === "nama_siniar")?.[valueColumn] || "";
  const episodeId = rows.find((row) => row[keyColumn] === "nomor_video")?.[valueColumn] || "";

  return rows
    .map((row) => {
      const key = String(row[keyColumn] || "").trim();
      const value = String(row[valueColumn] || "").trim();
      if (!key || !value) return null;

      return {
        podcast_id: podcastId,
        episode_id: episodeId || "utama",
        episode_title: episodeTitle,
        podcast_name: podcastName,
        topic: humanizeKey(key),
        question: `Apa ${humanizeKey(key)}?`,
        answer: value,
        keywords: `${humanizeKey(key)} ${value} ${semanticKeywordsForKey(key)}`,
        source_url: sourceUrl
      };
    })
    .filter(Boolean);
}

function semanticKeywordsForKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized.startsWith("nama_narasumber")) return "narasumber pembicara tamu siapa";
  if (normalized.startsWith("profil_narasumber")) return "profil narasumber pembicara tamu latar belakang jabatan profesi";
  const keywords = {
    ringkasan_isi_siniar: `ringkasan isi bahas dibahas pembahasan diomongkan ngomong bicara dibicarakan disampaikan cerita inti episode topik utama pesan utama bilang dibilang dikatakan ucapan narasumber ${DOMAIN_TERM_KEYWORDS}`,
    kenapa_siniar_ini_penting: `penting menarik alasan rekomendasi perlu didengar layak disimak bagus nilai manfaat ${DOMAIN_TERM_KEYWORDS}`,
    deskripsi_episode: `deskripsi tentang episode pengantar konteks latar belakang situasi momentum alasan hadir membahas diomongkan dibicarakan ${DOMAIN_TERM_KEYWORDS}`,
    poin_penting_siniar: `poin penting bagian struktur segmen alur pembahasan bahasan pembicaraan pernyataan narasumber disampaikan dikatakan ${DOMAIN_TERM_KEYWORDS}`,
    nama_narasumber: "narasumber pembicara tamu siapa",
    profil_narasumber: "profil narasumber latar belakang jabatan profesi",
    nama_host: "host pembawa acara pewara presenter fx agung timbul laksana",
    profil_host: "profil host pembawa acara pewara presenter",
    apa_itu_catenaccio: "catenaccio arti definisi maksud istilah taktik sepak bola",
    apa_itu_kompas_professional_mining: "kompas professional mining profesional pertambangan mineral batubara batu bara definisi tentang",
    isi_lengkap_siniar_sampai_menit_6: `isi lengkap transkrip menit pembicaraan kutipan dibahas sampai menit ${DOMAIN_TERM_KEYWORDS}`,
    "isi_lengkap_siniar_sampai_menit_6:57": `isi lengkap transkrip menit pembicaraan kutipan dibahas sampai menit ${DOMAIN_TERM_KEYWORDS}`,
    transkrip_siniar: `transkrip siniar isi lengkap percakapan pembicaraan kutipan ${DOMAIN_TERM_KEYWORDS}`,
    deskripsi_siniar: `deskripsi siniar tentang program profil acara ${DOMAIN_TERM_KEYWORDS}`,
    ringkasan_dan_time_stamp: `ringkasan timestamp time stamp menit alur bagian segmen pembahasan ${DOMAIN_TERM_KEYWORDS}`
  };
  return keywords[normalized] || "";
}

function humanizeKey(value) {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function filterRows(rows, podcastId, episodeId) {
  return rows.filter((row) => {
    const rowPodcast = row.podcast_id || podcastId;
    const rowEpisode = row.episode_id || "";
    const podcastMatches = !rowPodcast || rowPodcast === podcastId;
    const episodeMatches = !episodeId || !rowEpisode || rowEpisode === episodeId;
    return podcastMatches && episodeMatches && rowToText(row);
  });
}

function rankRows(rows, question, options = {}) {
  const queryTokens = Array.from(tokenize(question));
  const normalizedQuestion = normalizeText(question);
  const evaluativeQuestion = /\b(menarik|penting|bagus|rekomendasi|layak|disimak|didengar|manfaat|kenapa|mengapa)\b/u.test(normalizedQuestion);
  const contentQuestion = isContentQuestion(normalizedQuestion);
  const termQuestion = isTermQuestion(question, normalizedQuestion);
  const speakerContentQuestion = isSpeakerContentQuestion(question, normalizedQuestion);
  const personQuestion = isPersonQuestion(question, normalizedQuestion);
  const preferredRows = (contentQuestion && (!personQuestion || speakerContentQuestion))
    ? rows.filter((row) => CONTENT_TOPICS.has(normalizeText(row.topic)))
    : evaluativeQuestion
    ? rows.filter((row) => {
        const topic = normalizeText(row.topic);
        return topic.includes("kenapa") || topic.includes("penting") || topic.includes("menarik");
      })
    : [];
  const rankedRows = preferredRows.length ? preferredRows : rows;

  return rankedRows
    .map((row) => {
      const topic = normalizeText(row.topic);
      const questionText = normalizeText(row.question);
      const answer = normalizeText(row.answer || row.ringkasan || row.summary || row.content);
      const keywords = normalizeText(row.keywords);
      const episodeTitle = normalizeText(row.episode_title);

      let score = 0;
      score += weightedTokenScore(queryTokens, topic, 10);
      score += weightedTokenScore(queryTokens, questionText, 7);
      score += weightedTokenScore(queryTokens, keywords, 4);
      score += weightedTokenScore(queryTokens, answer, 2);
      score += weightedTokenScore(queryTokens, episodeTitle, 0.4);

      if (termQuestion) {
        score += weightedTokenScore(queryTokens, topic, 8);
        score += weightedTokenScore(queryTokens, keywords, 8);
        score += weightedTokenScore(queryTokens, answer, 7);
        if (isTranscriptTopic(row.topic)) score += 6;
        if (CONTENT_TOPICS.has(topic)) score += 5;
      }
      if (topic && normalizedQuestion.includes(topic)) score += 12;
      if (topic.includes(normalizedQuestion)) score += 8;
      if (contentQuestion && CONTENT_TOPICS.has(topic)) score += 28;
      if (speakerContentQuestion && CONTENT_TOPICS.has(topic)) score += 30;
      if (speakerContentQuestion && PERSON_TOPICS.has(topic) && topic !== "nama narasumber") score -= 35;
      if (contentQuestion && !personQuestion && PERSON_TOPICS.has(topic)) score -= 30;
      if (evaluativeQuestion && topic === "kenapa siniar penting") score += 40;
      if (evaluativeQuestion && topic === "deskripsi episode") score -= 18;
      if (LOW_VALUE_TOPICS.has(topic)) score -= 4;

      const matchedTokens = countMatchedTokens(queryTokens, [topic, questionText, keywords, answer, episodeTitle]);
      const directTopicMatch = topic && [...tokenize(topic)].some((token) => queryTokens.includes(token));
      const strongTermMatch = termQuestion && matchedTokens >= 1 && queryTokens.length <= 3 && (
        hasAnyToken(queryTokens, [topic, questionText, keywords, answer]) ||
        directTopicMatch
      );
      const relevantEnough = score >= MIN_RELEVANCE_SCORE && (
        matchedTokens >= 2 ||
        (contentQuestion && matchedTokens >= 1) ||
        strongTermMatch ||
        directTopicMatch ||
        personQuestion ||
        evaluativeQuestion ||
        (contentQuestion && options.knownEntityReference)
      );

      return { row, score, relevantEnough };
    })
    .filter((item) => item.relevantEnough)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.row);
}

function isContentQuestion(normalizedQuestion) {
  return /\b(omong|omongkan|ngomong|bicara|bicarakan|bahas|dibahas|membahas|pembahasan|sampaikan|disampaikan|bilang|dibilang|katakan|dikatakan|ucap|diucapkan|cerita|diceritakan|ulas|diulas|topik|inti|ringkasan|isinya|isi|problem|masalah|persoalan|isu|kendala|tantangan|hambatan|solusi|saran|usul|rekomendasi)\b/u.test(normalizedQuestion);
}

function isContextQuestion(question, normalizedQuestion = "") {
  const text = normalizeLooseText(`${question} ${normalizedQuestion}`);
  return /\b(konteks|latar belakang|background|pengantar|situasi|momentum|mengapa hadir|kenapa hadir|kenapa episode|alasan episode|dibuat untuk apa)\b/u.test(text);
}

function isTermQuestion(question, normalizedQuestion = "") {
  const text = normalizeLooseText(`${question} ${normalizedQuestion}`);
  const tokens = Array.from(tokenize(question));
  const hasDomainTerm = /\b(dmo|hop|pltu|rkab|pln|batubara|batu bara|data stok|stok|monitoring|pasokan|pembangkit)\b/u.test(text);
  const asksTerm = /\b(apa itu|apa arti|artinya apa|maksudnya apa|maksud dari|jelaskan|jelasin|definisi|istilah|terangkan)\b/u.test(text);
  return asksTerm || (hasDomainTerm && tokens.length <= 3);
}

function isSpeakerContentQuestion(question, normalizedQuestion = "") {
  const text = normalizeLooseText(`${question} ${normalizedQuestion}`);
  const hasSpeaker = /\b(narasumber|pembicara|tamu|dia|beliau)\b/u.test(text);
  const hasStatementVerb = /\b(bilang|dibilang|katakan|dikatakan|ucap|diucapkan|sampaikan|disampaikan|bahas|dibahas|membahas|omong|diomongkan|ngomong|jelaskan|dijelaskan)\b/u.test(text);
  return hasSpeaker && hasStatementVerb;
}

function isPersonQuestion(question, normalizedQuestion = "") {
  return /\b(siapa|profil|latar|belakang|jabatan|profesi|narasumber|pembicara|tamu|host|pembawa|pewara)\b/u.test(
    normalizeLooseText(`${question} ${normalizedQuestion}`)
  );
}

function hasKnownEntityReference(question, rows) {
  const queryTokens = tokenize(question);
  const personRows = rows.filter((row) => PERSON_TOPICS.has(normalizeText(row.topic)));

  return personRows.some((row) => {
    const answerTokens = tokenize(row.answer || "");
    return [...answerTokens].some((token) => queryTokens.has(token));
  });
}

function tokenize(value) {
  const stopwords = new Set(["yang", "dan", "di", "ke", "dari", "apa", "siapa", "kapan", "bagaimana", "untuk", "ini", "itu", "dengan", "the", "a", "an"]);
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length > 2 && !stopwords.has(token))
  );
}

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return Array.from(tokenize(value)).join(" ");
}

function weightedTokenScore(queryTokens, value, weight) {
  if (!value) return 0;
  const valueTokens = new Set(value.split(/\s+/).filter(Boolean));
  return queryTokens.reduce((total, token) => total + (valueTokens.has(token) ? weight : 0), 0);
}

function countMatchedTokens(queryTokens, values) {
  const haystack = new Set(values.join(" ").split(/\s+/).filter(Boolean));
  return queryTokens.filter((token) => haystack.has(token)).length;
}

function hasAnyToken(queryTokens, values) {
  const haystack = new Set(values.join(" ").split(/\s+/).filter(Boolean));
  return queryTokens.some((token) => haystack.has(token));
}

function normalizeToken(token) {
  return token
    .replace(/(nya|lah|kah|pun)$/u, "")
    .replace(/^(di|ke)(?=\p{L}{4,})/u, "");
}

function makeFallbackAnswer(rows, allRows = [], followUpContext = null) {
  if (followUpContext?.target === "narasumber") {
    return makePersonAnswer(allRows, "narasumber");
  }

  if (followUpContext?.target === "host") {
    return makePersonAnswer(allRows, "host");
  }

  const answers = rows
    .map((row) => row.answer || row.ringkasan || row.summary || row.content || "")
    .filter(Boolean);

  if (!answers.length) return makeMissingInfoAnswer(allRows);
  return makeFriendlyDataAnswer(answers[0]);
}

function makePersonAnswer(rows, type) {
  const name = type === "narasumber"
    ? formatList(findAnswersByTopicBase(rows, "nama narasumber"))
    : findAnswerByTopic(rows, `nama ${type}`);
  const profile = type === "narasumber"
    ? findAnswersByTopicBase(rows, "profil narasumber").join(" ")
    : findAnswerByTopic(rows, `profil ${type}`);
  const reason = type === "narasumber" ? findAnswerByTopic(rows, "alasan pemilihan narasumber") : "";

  if (!name && !profile && !reason) return MISSING_INFO_MESSAGE;

  if (type === "narasumber") {
    return [
      name ? `${name} adalah narasumber dalam episode ini.` : "",
      profile ? `Profil: ${profile}.` : "",
      reason ? `Alasan pemilihan narasumber: ${reason}` : ""
    ].filter(Boolean).join(" ");
  }

  return [
    name ? `${name} adalah host dalam episode ini.` : "",
    profile || ""
  ].filter(Boolean).join(" ");
}

function findAnswerByTopic(rows, topic) {
  const wanted = normalizeText(topic);
  return rows.find((row) => normalizeText(row.topic) === wanted)?.answer || "";
}

function findAnswersByTopicBase(rows, topic) {
  const wanted = normalizeText(topic);
  return rows
    .filter((row) => {
      const rowTopic = normalizeText(row.topic);
      return rowTopic === wanted || rowTopic.startsWith(`${wanted} `);
    })
    .map((row) => row.answer || "")
    .filter(Boolean);
}

function formatList(values = []) {
  const unique = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} dan ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, dan ${unique.at(-1)}`;
}

function makeFriendlyDataAnswer(answer) {
  const text = String(answer || "").trim();
  if (!text) return MISSING_INFO_MESSAGE;
  if (text.length < 90 && !/[\n:;-]/u.test(text)) return text;

  const points = extractAnswerPoints(text, 4);
  if (!points.length) return `Berdasarkan data episode ini: ${text}`;

  return [
    "Berikut inti jawabannya:",
    ...points.map((point) => `- ${point}`)
  ].join("\n");
}

function extractAnswerPoints(value, limit = 4) {
  const text = String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  const linePoints = text
    .split(/\n+/u)
    .map(cleanAnswerPoint)
    .filter((point) => point && !looksLikeIntroLine(point));

  const sentencePoints = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/u)
    .map(cleanAnswerPoint)
    .filter((point) => point && !looksLikeIntroLine(point));

  const source = linePoints.length >= 2 ? linePoints : sentencePoints;
  const seen = new Set();
  const points = [];

  for (const point of source) {
    const normalized = normalizeLooseText(point);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    points.push(truncatePoint(point));
    if (points.length >= limit) break;
  }

  return points;
}

function cleanAnswerPoint(value) {
  return String(value || "")
    .replace(/^[\s•\-–—*]+/u, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function looksLikeIntroLine(value) {
  const text = String(value || "").trim();
  return /[:：]$/u.test(text) && text.split(/\s+/u).length <= 12;
}

function truncatePoint(value, maxLength = 180) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength).replace(/\s+\S*$/u, "").trim();
  return `${truncated}...`;
}

function makeMissingInfoAnswer(rows = [], podcast = {}, language = "id") {
  const podcastName = findAnswerByTopic(rows, "nama siniar") || podcast.title || podcast.name || "siniar ini";
  const episodeTitle = findAnswerByTopic(rows, "judul");
  const summary = findAnswerByTopic(rows, "ringkasan isi siniar") || findAnswerByTopic(rows, "deskripsi episode");
  const shortSummary = summarizeForFallback(summary);

  if (language === "en") {
    return [
      `Sorry, that information is not available for this ${podcastName} episode.`,
      episodeTitle ? `- This episode is titled "${episodeTitle}".` : "",
      shortSummary ? `- Brief context: ${shortSummary}` : "",
      "- Please ask another question about this episode."
    ].filter(Boolean).join("\n");
  }

  return [
    `Maaf, informasi itu belum tersedia di data episode ${podcastName}.`,
    episodeTitle ? `- episode ini berjudul "${episodeTitle}".` : "",
    shortSummary ? `- Gambaran singkat: ${shortSummary}` : "",
    "- Silakan ajukan pertanyaan lain tentang episode ini."
  ].filter(Boolean).join("\n");
}

function isMissingInfoAnswer(value) {
  const text = normalizeLooseText(value);
  return text.includes("informasi tersebut belum tersedia di data spreadsheet") ||
    text.includes("informasi itu belum tersedia di data spreadsheet") ||
    text.includes("informasi tersebut belum tersedia di data episode") ||
    text.includes("informasi itu belum tersedia di data episode") ||
    text.includes("that information is not available for this episode") ||
    text.includes("that information is not available in this episode") ||
    text.includes("information is not available for this episode") ||
    text.includes("information is not available in this episode");
}

function summarizeForFallback(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/u).find(Boolean) || text;
  const words = sentence.split(/\s+/).slice(0, 28).join(" ");
  const suffix = sentence.split(/\s+/).length > 28 ? "..." : "";
  return `${words}${suffix}`;
}

function rowToText(row) {
  return Object.values(row)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function formatSources(rows) {
  return rows.slice(0, 3).map((row) => ({
    podcastId: row.podcast_id || "",
    episodeId: row.episode_id || "",
    episodeTitle: row.episode_title || "",
    topic: row.topic || "",
    sourceUrl: row.source_url || ""
  }));
}

function formatOpenAIContext(rows, podcast) {
  let usedChars = 0;
  const sections = [];

  for (const [index, row] of rows.entries()) {
    const transcript = isTranscriptTopic(row.topic);
    const answer = row.answer || row.ringkasan || row.summary || row.content || "";
    const answerLimit = transcript ? MAX_OPENAI_TRANSCRIPT_CHARS : MAX_OPENAI_ROW_CHARS;
    const remaining = MAX_OPENAI_CONTEXT_CHARS - usedChars;

    if (remaining <= 0) break;

    const section = [
      `Data ${index + 1}${transcript ? " (transkrip/isi lengkap)" : ""}:`,
      `Podcast: ${row.podcast_id || podcast.id}`,
      `Episode: ${row.episode_id || ""}`,
      `Judul episode: ${row.episode_title || ""}`,
      `Topik: ${row.topic || ""}`,
      `Pertanyaan data: ${row.question || ""}`,
      `Jawaban data: ${limitText(answer, Math.min(answerLimit, remaining))}`,
      `Kata kunci: ${limitText(row.keywords || "", 800)}`
    ].join("\n");

    if (usedChars + section.length > MAX_OPENAI_CONTEXT_CHARS) {
      const roomForAnswer = Math.max(500, remaining - 500);
      const shortenedSection = [
        `Data ${index + 1}${transcript ? " (transkrip/isi lengkap)" : ""}:`,
        `Podcast: ${row.podcast_id || podcast.id}`,
        `Episode: ${row.episode_id || ""}`,
        `Judul episode: ${row.episode_title || ""}`,
        `Topik: ${row.topic || ""}`,
        `Pertanyaan data: ${row.question || ""}`,
        `Jawaban data: ${limitText(answer, roomForAnswer)}`,
        `Kata kunci: ${limitText(row.keywords || "", 400)}`
      ].join("\n");
      sections.push(shortenedSection);
      break;
    }

    sections.push(section);
    usedChars += section.length + 2;
  }

  return sections.join("\n\n");
}

function limitText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

async function askOpenAI(question, rows, podcast, draftAnswer, answerLanguage = "id") {
  const text = await createOpenAIResponse(question, rows, podcast, MODEL, draftAnswer, answerLanguage);
  return { text, model: MODEL };
}

async function createOpenAIResponse(question, rows, podcast, model, draftAnswer, answerLanguage = "id") {
  const context = formatOpenAIContext(rows, podcast);
  const responseLanguageLabel = answerLanguage === "en" ? "English" : "Bahasa Indonesia";
  const missingInfoMessage = missingInfoMessageForLanguage(answerLanguage);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 450,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Anda adalah chatbot editorial Kompas.id untuk siniar.",
                "Tugas Anda menjawab dengan natural berdasarkan draf jawaban, konteks data episode, dan transkrip jika tersedia.",
                "Jawab dalam bahasa yang sama dengan pertanyaan pengguna.",
                "Jika pengguna bertanya dalam bahasa Inggris, jawab dalam bahasa Inggris yang sopan, natural, informatif, dan ringkas.",
                "Jika pengguna bertanya dalam bahasa Indonesia, jawab dalam bahasa Indonesia yang sopan, natural, informatif, dan ringkas.",
                "Jangan membuat jawaban baru di luar draf dan konteks data episode.",
                `Jika draf atau konteks tidak menjawab pertanyaan pengguna, jawab persis: ${missingInfoMessage}`,
                "Jangan mencari informasi di internet.",
                "Jangan mengarang nama, tanggal, angka, kutipan, atau kesimpulan.",
                "Jangan menambahkan interpretasi seperti penyebab, dampak, atau opini jika tidak tertulis jelas di data.",
                "Jika pertanyaan meminta hal spesifik yang tidak disebut di data, katakan informasi tersebut belum tersedia.",
                "Jika ada konteks bertopik transkrip, isi lengkap, timestamp, atau time stamp, baca dan gunakan konteks itu untuk memahami isi pembicaraan.",
                "Gunakan karakter pembawa berita televisi: sangat sopan, ramah, informatif, tenang, dan to the point.",
                "Jawablah seperti manusia yang memahami pertanyaan, bukan seperti template sistem.",
                "Jika pertanyaan pengguna santai atau tidak formal, tetap jawab dengan bahasa yang sama secara luwes, hangat, dan profesional.",
                "Boleh memberi pengantar sangat singkat seperti 'Intinya,' atau 'Secara sederhana,' jika membuat jawaban lebih natural.",
                "Utamakan jawaban cerdas yang menyarikan maksud data, bukan daftar mentah.",
                "Jawab langsung inti pertanyaan pada kalimat pertama.",
                "Boleh menyebut nama narasumber, host, episode, atau siniar jika ada di konteks dan membantu memperjelas jawaban.",
                "Gunakan nada diplomatis, tidak menghakimi, dan tidak berspekulasi.",
                "Saring dan sarikan jawaban dari data yang tersedia. Jangan menyalin teks panjang secara mentah jika bisa diringkas.",
                "Gunakan kalimat pendek, jernih, dan mengalir. Hindari gaya terlalu akrab, bercanda, robotik, atau bertele-tele.",
                "Hindari frasa kaku seperti 'data menunjukkan' berulang-ulang.",
                "Jawaban maksimal lima kalimat pendek.",
                "Jika jawaban berisi lebih dari satu gagasan, gunakan pointer dengan tanda '-' maksimal empat poin.",
                "Setiap pointer harus mudah dipahami pembaca umum, cukup satu kalimat pendek, dan tidak lebih dari 18 kata.",
                "Jangan menyebut istilah teknis sumber data dalam jawaban kepada pengguna.",
                "Untuk sapaan atau percakapan ringan, jawab secara hangat dan profesional tanpa menambahkan fakta baru.",
                "Jawaban harus ringkas, jelas, dan mudah dipahami pembaca.",
                "Jangan gunakan Markdown heading atau teks tebal."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Draf jawaban dari data terpilih:\n${draftAnswer}`,
                `Konteks data episode:\n${context}`,
                `Pertanyaan pengguna:\n${question}`,
                `Bahasa jawaban: ${responseLanguageLabel}`,
                "Jawab pertanyaan pengguna secara langsung. Baca konteks data episode dan transkrip terlebih dahulu. Sarikan menjadi jawaban pendek yang cerdas, natural, diplomatis, informatif, dan terasa seperti jawaban manusia. Pakai pointer pendek bila membantu. Jangan tambahkan fakta baru. Jangan menyebut istilah teknis sumber data."
              ].join("\n\n")
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${body.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = extractResponseText(data).trim();
  return text || missingInfoMessage;
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n")
    .trim();
}
