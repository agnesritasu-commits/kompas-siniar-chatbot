const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const messages = document.querySelector("#messages");
const statusEl = document.querySelector("#status");
const sendButton = document.querySelector("#send-button");
const voiceButton = document.querySelector("#voice-button");
const chatTitle = document.querySelector("#chat-title");
const chatDeck = document.querySelector("#chat-deck");

const params = new URLSearchParams(window.location.search);
const podcastId = params.get("podcast") || "kompas-professional-mining";
const episodeId = params.get("episode") || "";
const podcastNames = {
  "bongkar-data": "Bongkar Data",
  "kompas-professional-mining": "Kompas Professional Mining",
  "kompas-siniar": "Kompas Siniar"
};
const episodeTitles = {
  "bongkar-data": "Kurs Dolar AS Tidak Pengaruhi Masyarakat Desa, Fakta atau Mitos?",
  "kompas-professional-mining": "Mengurai Sengkarut Tata Kelola Batubara di Balik Insiden Byarpet Listrik",
  "kompas-siniar": "Chatib Basri: Piala Dunia 2026 dan Catenaccio Ekonomi Indonesia"
};
const podcastSpeechTexts = {
  "bongkar-data": "Bongkar Data",
  "kompas-professional-mining": "Kompas Profesional Mining",
  "kompas-siniar": "Kompas Siniar"
};
const episodeSpeechTexts = {
  "bongkar-data": "Kurs Dolar Amerika Serikat Tidak Pengaruhi Masyarakat Desa, Fakta atau Mitos?",
  "kompas-professional-mining": "Mengurai Sengkarut Tata Kelola Batu Bara di Balik Insiden Byarpet Listrik",
  "kompas-siniar": "Chatib Basri: Piala Dunia dua ribu dua puluh enam dan Catenaccio Ekonomi Indonesia"
};

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\s().-]?){8,}\d/;
const privacyWarning = "Jangan kirim data pribadi seperti email, nomor telepon, alamat rumah, atau informasi sensitif.";
const conversationHistory = [];
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecognizeSpeech = Boolean(SpeechRecognition);
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let recognition = null;
let isListening = false;
let speechVoices = [];
let activeSpeechButton = null;

setPodcastTitle();
setupSpeechVoices();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  await submitQuestion(question);
});

input.addEventListener("input", resizeInput);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

setupVoiceInput();

function setPodcastTitle() {
  if (!chatTitle) return;
  const podcastName = podcastNames[podcastId] || formatPodcastName(podcastId);
  const episodeTitle = episodeTitles[podcastId] || "ini";
  chatTitle.textContent = `Kompas Siniar "${podcastName}"`;
  if (chatDeck) {
    chatDeck.textContent = `Tanya episode "${episodeTitle}"`;
  }
  document.title = `${podcastName} Chatbot`;
}

function formatPodcastName(value) {
  return String(value || "siniar")
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function submitQuestion(question) {
  const answerLanguage = detectQuestionLanguage(question);

  if (containsSensitiveData(question)) {
    setStatus(privacyWarning, true);
    input.focus();
    return;
  }

  appendMessage(question, "user");
  input.value = "";
  resizeInput();
  setLoading(true);
  const typing = appendTyping();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question,
        podcastId,
        episodeId,
        history: conversationHistory.slice(-6)
      })
    });

    const data = await response.json();
    typing.remove();

    if (!response.ok) {
      throw new Error(data.error || "Pertanyaan belum bisa diproses.");
    }

    appendMessage(data.answer || "Informasi tersebut belum tersedia di data episode ini.", "bot", data.sources || [], answerLanguage);
    rememberTurn("user", question);
    rememberTurn("assistant", data.answer || "", data.sources || []);
    setStatus(data.mode === "fallback" ? "Jawaban disusun dari data episode yang tersedia." : "");
  } catch (error) {
    typing.remove();
    appendMessage("Maaf, chatbot belum bisa menjawab saat ini. Coba lagi beberapa saat lagi.", "bot", [], "id");
    setStatus(error.message, true);
  } finally {
    setLoading(false);
    input.focus();
  }
}

function containsSensitiveData(value) {
  return emailPattern.test(value) || phonePattern.test(value);
}

function rememberTurn(role, content, sources = []) {
  if (!content) return;
  conversationHistory.push({
    role,
    content: String(content).slice(0, 700),
    sources: sources.slice(0, 3)
  });
  if (conversationHistory.length > 8) {
    conversationHistory.splice(0, conversationHistory.length - 8);
  }
}

function appendMessage(text, type, sources = [], language = "id") {
  const article = document.createElement("article");
  article.className = `message message--${type}`;

  if (type === "bot") {
    article.append(createBotAvatar());
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  if (type === "bot") {
    const audioTools = createMessageAudioTools(text, language);
    if (audioTools) {
      bubble.append(audioTools);
    }

    const sourceLinks = getSourceLinks(sources);
    if (sourceLinks.length) {
      bubble.append(createSourceLinks(sourceLinks));
    }
  }

  article.append(bubble);
  messages.append(article);
  scrollToLatest();
  return article;
}

function getSourceLinks(sources = []) {
  const seen = new Set();
  return sources
    .map((source) => ({
      url: String(source.sourceUrl || "").trim(),
      title: String(source.episodeTitle || "").trim()
    }))
    .filter((source) => {
      if (!source.url || seen.has(source.url)) return false;
      try {
        const url = new URL(source.url);
        if (!["http:", "https:"].includes(url.protocol)) return false;
      } catch {
        return false;
      }
      seen.add(source.url);
      return true;
    })
    .slice(0, 1);
}

function createSourceLinks(sources) {
  const wrapper = document.createElement("div");
  wrapper.className = "source-links";

  sources.forEach((source) => {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Tonton Episode Kali Ini";
    link.setAttribute("aria-label", source.title ? `Tonton episode kali ini: ${source.title}` : "Tonton Episode Kali Ini");
    wrapper.append(link);
  });

  return wrapper;
}

function createMessageAudioTools(text, language = "id") {
  if (!canSpeak) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "message-tools";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "audio-button";
  button.setAttribute("aria-label", "Dengarkan jawaban");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Zm12.4 7.4a1 1 0 0 1-.7-1.7 3.8 3.8 0 0 0 0-5.4 1 1 0 1 1 1.4-1.4 5.8 5.8 0 0 1 0 8.2 1 1 0 0 1-.7.3Zm2.8 2.8a1 1 0 0 1-.7-1.7 7.8 7.8 0 0 0 0-11 1 1 0 1 1 1.4-1.4 9.8 9.8 0 0 1 0 13.8 1 1 0 0 1-.7.3Z"></path>
    </svg>
  `;

  button.addEventListener("click", () => {
    speakText(text, button, language);
  });

  wrapper.append(button);
  return wrapper;
}

function speakText(text, button, language = "id") {
  const cleanText = normalizeSpeechText(text);
  const chunks = buildSpeechChunks(cleanText, language);
  if (!chunks.length || !canSpeak) return;

  if (button.classList.contains("audio-button--active")) {
    stopSpeaking();
    return;
  }

  stopSpeaking();
  activeSpeechButton = button;
  window.speechSynthesis.cancel();

  button.classList.add("audio-button--active");
  button.setAttribute("aria-label", "Hentikan suara");

  speakSpeechChunk(chunks, language, button);
}

function speakSpeechChunk(chunks, language, button) {
  if (!chunks.length || activeSpeechButton !== button) {
    resetAudioButton(button);
    return;
  }

  const chunk = chunks.shift();
  const chunkLanguage = chunk.language || language;
  const locale = speechLocaleForLanguage(chunkLanguage);
  const utterance = new SpeechSynthesisUtterance(chunk.text);
  utterance.lang = locale;
  utterance.voice = selectSpeechVoice(locale);
  utterance.rate = chunkLanguage === "en" ? 0.92 : 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onend = () => {
    window.setTimeout(() => speakSpeechChunk(chunks, language, button), 80);
  };
  utterance.onerror = () => resetAudioButton(button);
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  window.speechSynthesis.cancel();
  if (activeSpeechButton) {
    resetAudioButton(activeSpeechButton);
  }
  activeSpeechButton = null;
}

function resetAudioButton(button) {
  button.classList.remove("audio-button--active");
  button.setAttribute("aria-label", "Dengarkan jawaban");
  if (activeSpeechButton === button) {
    activeSpeechButton = null;
  }
}

function detectQuestionLanguage(text) {
  const normalized = String(text || "").toLowerCase();
  const englishScore = countLanguageMatches(normalized, [
    "hello", "hi", "thanks", "thank you", "what", "who", "why", "when", "where", "how",
    "does", "do", "did", "is", "are", "can", "could", "please", "tell", "explain",
    "summarize", "summary", "speaker", "guest", "topic", "about", "episode", "podcast"
  ]);
  const indonesianScore = countLanguageMatches(normalized, [
    "halo", "hai", "terima kasih", "makasih", "apa", "siapa", "kenapa", "mengapa",
    "bagaimana", "gimana", "tolong", "jelaskan", "ringkas", "ringkasan", "narasumber",
    "pembicara", "bahas", "dibahas", "siniar", "episode"
  ]);
  return englishScore > indonesianScore ? "en" : "id";
}

function countLanguageMatches(text, words) {
  return words.filter((word) => text.includes(word)).length;
}

function speechLocaleForLanguage(language) {
  return language === "en" ? "en-US" : "id-ID";
}

function buildSpeechChunks(text, language = "id") {
  const baseChunks = splitTextForSpeech(text).map((chunk) => ({
    text: chunk,
    language
  }));

  if (language !== "en") return baseChunks;

  const indonesianTerms = getIndonesianSpeechTerms();
  return baseChunks
    .flatMap((chunk) => splitChunkByIndonesianTerms(chunk.text, indonesianTerms))
    .filter((chunk) => chunk.text);
}

function getIndonesianSpeechTerms() {
  const terms = [
    {
      matchText: "Kompas Siniar",
      speechText: "Kompas Siniar"
    },
    ...Object.keys(podcastNames).map((id) => ({
      matchText: podcastNames[id],
      speechText: podcastSpeechTexts[id] || podcastNames[id]
    })),
    ...Object.keys(episodeTitles).map((id) => ({
      matchText: episodeTitles[id],
      speechText: episodeSpeechTexts[id] || episodeTitles[id]
    }))
  ];

  return terms
    .map((term) => ({
      matchText: String(term.matchText || "").trim(),
      speechText: String(term.speechText || term.matchText || "").trim()
    }))
    .filter((term) => term.matchText.length > 2)
    .sort((a, b) => b.matchText.length - a.matchText.length);
}

function splitChunkByIndonesianTerms(text, terms) {
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findNextTermMatch(text, terms, cursor);

    if (!match) {
      chunks.push({
        text: text.slice(cursor).trim(),
        language: "en"
      });
      break;
    }

    if (match.index > cursor) {
      chunks.push({
        text: text.slice(cursor, match.index).trim(),
        language: "en"
      });
    }

    chunks.push({
      text: match.speechText,
      language: "id"
    });
    cursor = match.index + match.matchText.length;
  }

  return chunks.filter((chunk) => chunk.text);
}

function findNextTermMatch(text, terms, startIndex) {
  const lowerText = text.toLowerCase();
  let bestMatch = null;

  for (const term of terms) {
    const index = lowerText.indexOf(term.matchText.toLowerCase(), startIndex);
    if (index === -1) continue;

    if (!bestMatch ||
      index < bestMatch.index ||
      (index === bestMatch.index && term.matchText.length > bestMatch.matchText.length)) {
      bestMatch = {
        index,
        matchText: term.matchText,
        speechText: term.speechText
      };
    }
  }

  return bestMatch;
}

function setupSpeechVoices() {
  if (!canSpeak) return;
  speechVoices = window.speechSynthesis.getVoices();
  const updateVoices = () => {
    speechVoices = window.speechSynthesis.getVoices();
  };

  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
  } else {
    window.speechSynthesis.onvoiceschanged = updateVoices;
  }
}

function selectSpeechVoice(locale) {
  const voices = speechVoices.length ? speechVoices : window.speechSynthesis.getVoices();
  const language = locale.split("-")[0].toLowerCase();
  const matchingVoices = voices.filter((voice) => {
    const voiceLang = String(voice.lang || "").toLowerCase();
    return voiceLang === locale.toLowerCase() || voiceLang.startsWith(`${language}-`);
  });

  if (!matchingVoices.length) return null;

  return matchingVoices
    .map((voice) => ({
      voice,
      score: scoreSpeechVoice(voice, locale)
    }))
    .sort((a, b) => b.score - a.score)[0].voice;
}

function scoreSpeechVoice(voice, locale) {
  const name = String(voice.name || "").toLowerCase();
  const lang = String(voice.lang || "").toLowerCase();
  const expected = locale.toLowerCase();
  let score = 0;

  if (lang === expected) score += 80;
  if (lang.startsWith(expected.split("-")[0])) score += 40;
  if (voice.localService) score += 8;
  if (/\bgoogle\b|\bmicrosoft\b|\bsamantha\b|\balex\b|\bdamayanti\b|\bgadis\b/u.test(name)) score += 25;
  if (/\bindonesia\b|\bbahasa\b|\bid-id\b/u.test(name) && expected === "id-id") score += 35;
  if (/\benglish\b|\bus\b|\bunited states\b|\ben-us\b/u.test(name) && expected === "en-us") score += 35;

  return score;
}

function normalizeSpeechText(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/^\s*[-•]\s*/gmu, "")
    .replace(/\s*[-•]\s+/gu, ". ")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitTextForSpeech(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  for (const sentence of sentences.length ? sentences : [text]) {
    if ((current + " " + sentence).trim().length <= 180) {
      current = `${current} ${sentence}`.trim();
      continue;
    }

    if (current) chunks.push(current);
    if (sentence.length <= 180) {
      current = sentence;
    } else {
      chunks.push(...sentence.match(/.{1,180}(?:\s|$)/gu).map((part) => part.trim()).filter(Boolean));
      current = "";
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function setupVoiceInput() {
  if (!voiceButton) return;

  if (!canRecognizeSpeech) {
    voiceButton.disabled = true;
    voiceButton.title = "Input suara belum didukung browser ini.";
    voiceButton.setAttribute("aria-label", "Input suara belum didukung browser ini");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "id-ID";

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();

    if (transcript) {
      input.value = transcript;
      resizeInput();
    }

    const lastResult = event.results[event.results.length - 1];
    if (lastResult?.isFinal && input.value.trim()) {
      form.requestSubmit();
    }
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    voiceButton.classList.remove("voice-button--listening");
    voiceButton.setAttribute("aria-label", "Ajukan pertanyaan dengan suara");
    if (!statusEl.classList.contains("status--error")) {
      setStatus("");
    }
  });

  recognition.addEventListener("error", () => {
    isListening = false;
    voiceButton.classList.remove("voice-button--listening");
    setStatus("Suara belum terbaca. Coba ulangi atau ketik pertanyaan.", true);
  });

  voiceButton.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
      return;
    }

    setStatus("Silakan bicara. Pertanyaan akan muncul di kolom teks.");
    isListening = true;
    voiceButton.classList.add("voice-button--listening");
    voiceButton.setAttribute("aria-label", "Hentikan rekaman suara");
    recognition.lang = getRecognitionLanguage();
    recognition.start();
  });
}

function getRecognitionLanguage() {
  const pageLanguage = document.documentElement.lang || navigator.language || "id-ID";
  return pageLanguage.toLowerCase().startsWith("en") ? "en-US" : "id-ID";
}

function appendTyping() {
  const article = document.createElement("article");
  article.className = "message message--bot typing";
  article.append(createBotAvatar());
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", "Sedang menulis");
  bubble.innerHTML = `
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
  `;
  article.append(bubble);
  messages.append(article);
  scrollToLatest();
  return article;
}

function createBotAvatar() {
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");

  const image = document.createElement("img");
  image.src = "/assets/kompas-mark.jpeg";
  image.alt = "";
  avatar.append(image);

  return avatar;
}

function resizeInput() {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight / rootFontSize}rem`;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  input.disabled = isLoading;
  if (voiceButton && canRecognizeSpeech) {
    voiceButton.disabled = isLoading;
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
}

function scrollToLatest() {
  messages.scrollTop = messages.scrollHeight;
}
