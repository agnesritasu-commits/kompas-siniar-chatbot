import fs from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const FALLBACK_OPENAI_MODEL = process.env.OPENAI_FALLBACK_MODEL || "gpt-4.1-mini";
const MISSING_INFO_MESSAGE = "Informasi tersebut belum tersedia di data spreadsheet.";
const MAX_CONTEXT_ROWS = 8;
const MAX_QUESTION_LENGTH = 600;
const MIN_RELEVANCE_SCORE = 6;
const LOW_VALUE_TOPICS = new Set(["nomor video", "judul", "link video", "tanggal tayang yyyymmdd", "bentuk video"]);
const CONTENT_TOPICS = new Set([
  "ringkasan isi siniar",
  "poin penting siniar",
  "deskripsi episode",
  "kenapa siniar penting",
  "catenaccio"
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

    const utilityAnswer = getUtilityAnswer(question);
    if (utilityAnswer) {
      return res.status(200).json({
        answer: utilityAnswer,
        mode: "utility",
        sources: []
      });
    }

    const config = await loadConfig();
    const podcast = selectPodcast(config, podcastId);
    const rows = normalizeSpreadsheetRows(await fetchSpreadsheetRows(podcast.csvUrl));
    const filteredRows = filterRows(rows, podcast.id, episodeId);
    const followUpContext = getFollowUpContext(question, history);
    const personContext = followUpContext || getDirectPersonContext(question, filteredRows);
    const rankingQuestion = resolveFollowUpQuestion(question, personContext);
    const relevantRows = rankRows(filteredRows, rankingQuestion, {
      knownEntityReference: hasKnownEntityReference(rankingQuestion, filteredRows)
    }).slice(0, MAX_CONTEXT_ROWS);

    if (!relevantRows.length) {
      return res.status(200).json({
        answer: makeMissingInfoAnswer(filteredRows, podcast),
        mode: "fallback",
        sources: []
      });
    }

    const fallbackAnswer = makeFallbackAnswer(relevantRows, filteredRows, personContext);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        answer: fallbackAnswer,
        mode: "fallback",
        sources: formatSources(relevantRows)
      });
    }

    try {
      const answer = await askOpenAI(question, relevantRows, podcast, fallbackAnswer);
      const finalAnswer = isMissingInfoAnswer(answer.text)
        ? makeMissingInfoAnswer(filteredRows, podcast)
        : answer.text || fallbackAnswer;

      return res.status(200).json({
        answer: finalAnswer,
        mode: "openai",
        model: answer.model,
        sources: isMissingInfoAnswer(answer.text) ? [] : formatSources(relevantRows)
      });
    } catch (error) {
      console.error("OpenAI unavailable, using fallback:", error);
      return res.status(200).json({
        answer: fallbackAnswer,
        mode: "fallback",
        sources: formatSources(relevantRows)
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "API belum bisa memproses pertanyaan. Coba beberapa saat lagi." });
  }
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

function getFollowUpContext(question, history) {
  const text = normalizeText(question);
  const pronounQuestion = /\b(dia|ia|beliau|orang itu|tokoh itu|narasumber itu|host itu)\b/u.test(text);
  if (!pronounQuestion || !history.length) return null;

  const recentAssistant = [...history].reverse().find((item) => item.role === "assistant");
  const recentSources = recentAssistant?.sources || [];
  const sourceTopics = recentSources.map((source) => normalizeText(source.topic)).join(" ");
  const recentAnswer = recentAssistant?.content || "";

  if (sourceTopics.includes("narasumber") || /(?:Muhammad\s+)?Chatib(?:\s+Basri)?/i.test(recentAnswer)) {
    return {
      target: "narasumber",
      label: extractPersonName(recentAnswer) || "Muhammad Chatib Basri"
    };
  }

  if (sourceTopics.includes("host") || /FX Agung/i.test(recentAnswer)) {
    return {
      target: "host",
      label: extractPersonName(recentAnswer) || "FX Agung Timbul Laksana"
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

function getDirectPersonContext(question, rows) {
  const normalizedQuestion = normalizeText(question);
  if (!isPersonQuestion(question, normalizedQuestion)) return null;

  const queryTokens = tokenize(question);
  const candidates = [
    {
      target: "narasumber",
      name: findAnswerByTopic(rows, "nama narasumber")
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

function getUtilityAnswer(question) {
  const text = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";

  const hasGreeting = /\b(halo|hallo|hai|hi|hello|pagi|siang|sore|malam|assalamualaikum|permisi)\b/u.test(text);
  const asksWellbeing = /\b(apa kabar|kabarmu|kabar|sehat|lagi apa)\b/u.test(text);
  if (hasGreeting && asksWellbeing) {
    return "Selamat datang. Terima kasih sudah bertanya. Saya siap membantu menyajikan informasi dari data episode ini secara singkat, sopan, dan informatif.";
  }

  const greetingOnly = /^(halo|hallo|hai|hi|hello|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|assalamualaikum|permisi|met pagi|met siang|met sore|met malam)$/u;
  if (greetingOnly.test(text)) {
    return "Selamat datang. Saya akan membantu menjawab pertanyaan Anda tentang episode ini secara ringkas dan berdasarkan data spreadsheet. Anda dapat menanyakan narasumber, ringkasan, topik, atau istilah yang dibahas.";
  }

  const wellbeingOnly = /^(apa kabar|gimana kabarmu|bagaimana kabarmu|kabar baik|sehat|sehat kah|lagi apa)$/u;
  if (wellbeingOnly.test(text)) {
    return "Terima kasih. Saya siap membantu menyajikan informasi dari data episode ini secara jelas dan singkat. Silakan ajukan pertanyaan tentang narasumber, ringkasan, topik, atau istilah dalam siniar.";
  }

  const identityOnly = /^(siapa kamu|kamu siapa|ini apa|chatbot apa|apa ini)$/u;
  if (identityOnly.test(text)) {
    return "Saya chatbot Kompas Siniar. Tugas saya menyajikan jawaban singkat, sopan, dan informatif berdasarkan data spreadsheet episode ini.";
  }

  const thanksOnly = /^(terima kasih|makasih|thanks|thank you|oke|ok|sip|baik|mantap|siap|nice|bagus)$/u;
  if (thanksOnly.test(text)) {
    return "Sama-sama. Silakan ajukan pertanyaan berikutnya tentang episode ini.";
  }

  const apologyOnly = /^(maaf|sorry|maaf ya|maaf tadi salah|sori)$/u;
  if (apologyOnly.test(text)) {
    return "Tidak apa-apa. Silakan lanjutkan dengan pertanyaan tentang episode ini. Saya akan menjawab berdasarkan data yang tersedia.";
  }

  const helpOnly = /^(bantuan|help|apa yang bisa kamu jawab|kamu bisa apa|cara pakai|mau tanya apa|contoh pertanyaan|aku bisa tanya apa|saya bisa tanya apa)$/u;
  if (helpOnly.test(text)) {
    return "Anda dapat bertanya tentang hal yang tersedia dalam data episode. Contohnya: siapa narasumbernya, apa ringkasan episode ini, apa itu catenaccio, kenapa siniar ini penting, atau apa poin penting pembahasannya.";
  }

  const unsupportedChatOnly = /^(cerita dong|ngobrol dong|temani aku|ayo ngobrol|boleh ngobrol|aku bosan|lucu dong|kasih jokes|bercanda dong)$/u;
  if (unsupportedChatOnly.test(text)) {
    return "Saya dapat merespons percakapan ringan secara sopan. Namun, untuk informasi substantif, saya hanya menggunakan data spreadsheet episode ini. Silakan ajukan pertanyaan tentang episode atau topik yang dibahas.";
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

function normalizeSpreadsheetRows(rows) {
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
        podcast_id: "kompas-siniar",
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
  const keywords = {
    ringkasan_isi_siniar: "ringkasan isi bahas dibahas pembahasan diomongkan ngomong bicara dibicarakan disampaikan cerita inti episode topik utama pesan utama",
    kenapa_siniar_ini_penting: "penting menarik alasan rekomendasi perlu didengar layak disimak bagus nilai manfaat",
    deskripsi_episode: "deskripsi tentang episode pengantar konteks membahas diomongkan dibicarakan",
    poin_penting_siniar: "poin penting bagian struktur segmen alur pembahasan bahasan pembicaraan",
    nama_narasumber: "narasumber pembicara tamu siapa",
    profil_narasumber: "profil narasumber latar belakang jabatan profesi",
    nama_host: "host pembawa acara pewara presenter fx agung timbul laksana",
    profil_host: "profil host pembawa acara pewara presenter",
    apa_itu_catenaccio: "catenaccio arti definisi maksud istilah taktik sepak bola"
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
  const personQuestion = isPersonQuestion(question, normalizedQuestion);
  const preferredRows = contentQuestion && !personQuestion
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

      if (topic && normalizedQuestion.includes(topic)) score += 12;
      if (topic.includes(normalizedQuestion)) score += 8;
      if (contentQuestion && CONTENT_TOPICS.has(topic)) score += 28;
      if (contentQuestion && !personQuestion && PERSON_TOPICS.has(topic)) score -= 30;
      if (evaluativeQuestion && topic === "kenapa siniar penting") score += 40;
      if (evaluativeQuestion && topic === "deskripsi episode") score -= 18;
      if (LOW_VALUE_TOPICS.has(topic)) score -= 4;

      const matchedTokens = countMatchedTokens(queryTokens, [topic, questionText, keywords, answer, episodeTitle]);
      const directTopicMatch = topic && [...tokenize(topic)].some((token) => queryTokens.includes(token));
      const relevantEnough = score >= MIN_RELEVANCE_SCORE && (
        matchedTokens >= 2 ||
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
  return /\b(omong|omongkan|ngomong|bicara|bicarakan|bahas|dibahas|membahas|pembahasan|sampaikan|cerita|diceritakan|ulas|diulas|topik|inti|ringkasan|isinya|isi)\b/u.test(normalizedQuestion);
}

function isPersonQuestion(question, normalizedQuestion = "") {
  return /\b(siapa|profil|latar|belakang|jabatan|profesi|narasumber|host|pembawa|pewara)\b/u.test(
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
  const name = findAnswerByTopic(rows, `nama ${type}`);
  const profile = findAnswerByTopic(rows, `profil ${type}`);
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

function makeFriendlyDataAnswer(answer) {
  const text = String(answer || "").trim();
  if (!text) return MISSING_INFO_MESSAGE;
  if (text.length < 90) return text;
  return `Berdasarkan data episode ini: ${text}`;
}

function makeMissingInfoAnswer(rows = [], podcast = {}) {
  const podcastName = findAnswerByTopic(rows, "nama siniar") || podcast.title || podcast.name || "siniar ini";
  const episodeTitle = findAnswerByTopic(rows, "judul");
  const summary = findAnswerByTopic(rows, "ringkasan isi siniar") || findAnswerByTopic(rows, "deskripsi episode");
  const shortSummary = summarizeForFallback(summary);

  return [
    `Maaf, informasi itu belum tersedia di data spreadsheet ${podcastName}.`,
    episodeTitle ? `Untuk konteks, episode ini berjudul "${episodeTitle}".` : "",
    shortSummary ? `Secara umum, episode ini membahas ${shortSummary}` : "",
    "Silakan ajukan pertanyaan lain tentang data episode yang tersedia."
  ].filter(Boolean).join(" ");
}

function isMissingInfoAnswer(value) {
  const text = normalizeLooseText(value);
  return text.includes("informasi tersebut belum tersedia di data spreadsheet") ||
    text.includes("informasi itu belum tersedia di data spreadsheet");
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

async function askOpenAI(question, rows, podcast, draftAnswer) {
  const models = Array.from(new Set([MODEL, FALLBACK_OPENAI_MODEL].filter(Boolean)));
  let lastError;

  for (const model of models) {
    try {
      const text = await createOpenAIResponse(question, rows, podcast, model, draftAnswer);
      return { text, model };
    } catch (error) {
      lastError = error;
      console.error(`OpenAI model failed (${model}):`, error);
    }
  }

  throw lastError;
}

async function createOpenAIResponse(question, rows, podcast, model, draftAnswer) {
  const context = rows.map((row, index) => {
    return [
      `Data ${index + 1}:`,
      `Podcast: ${row.podcast_id || podcast.id}`,
      `Episode: ${row.episode_id || ""}`,
      `Judul episode: ${row.episode_title || ""}`,
      `Topik: ${row.topic || ""}`,
      `Pertanyaan data: ${row.question || ""}`,
      `Jawaban data: ${row.answer || row.ringkasan || row.summary || row.content || ""}`,
      `Kata kunci: ${row.keywords || ""}`
    ].join("\n");
  }).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Anda adalah chatbot editorial Kompas.id untuk siniar.",
                "Tugas Anda hanya merapikan draf jawaban yang sudah dipilih dari spreadsheet.",
                "Jangan membuat jawaban baru di luar draf dan konteks spreadsheet.",
                `Jika draf atau konteks tidak menjawab pertanyaan pengguna, jawab persis: ${MISSING_INFO_MESSAGE}`,
                "Jangan mencari informasi di internet.",
                "Jangan mengarang nama, tanggal, angka, kutipan, atau kesimpulan.",
                "Jangan menambahkan interpretasi seperti penyebab, dampak, atau opini jika tidak tertulis jelas di data.",
                "Jika pertanyaan meminta hal spesifik yang tidak disebut di data, katakan informasi tersebut belum tersedia.",
                "Gunakan karakter pembawa berita televisi: sangat sopan, ramah, informatif, tenang, dan to the point.",
                "Gunakan kalimat pendek dan rapi. Hindari gaya terlalu akrab, bercanda, atau bertele-tele.",
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
                `Konteks spreadsheet:\n${context}`,
                `Pertanyaan pengguna:\n${question}`,
                "Rumuskan ulang draf secara natural dan ringkas. Jangan tambahkan fakta baru."
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
  return text || MISSING_INFO_MESSAGE;
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n")
    .trim();
}
