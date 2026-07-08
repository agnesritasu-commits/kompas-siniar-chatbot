const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const messages = document.querySelector("#messages");
const statusEl = document.querySelector("#status");
const sendButton = document.querySelector("#send-button");
const voiceButton = document.querySelector("#voice-button");

const params = new URLSearchParams(window.location.search);
const podcastId = params.get("podcast") || "kompas-professional-mining";
const episodeId = params.get("episode") || "";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\s().-]?){8,}\d/;
const privacyWarning = "Jangan kirim data pribadi seperti email, nomor telepon, alamat rumah, atau informasi sensitif.";
const conversationHistory = [];
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecognizeSpeech = Boolean(SpeechRecognition);
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let recognition = null;
let isListening = false;

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

async function submitQuestion(question) {
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

    appendMessage(data.answer || "Informasi tersebut belum tersedia di data episode ini.", "bot", data.sources || []);
    rememberTurn("user", question);
    rememberTurn("assistant", data.answer || "", data.sources || []);
    setStatus(data.mode === "fallback" ? "Jawaban disusun dari data episode yang tersedia." : "");
  } catch (error) {
    typing.remove();
    appendMessage("Maaf, chatbot belum bisa menjawab saat ini. Coba lagi beberapa saat lagi.", "bot");
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

function appendMessage(text, type, sources = []) {
  const article = document.createElement("article");
  article.className = `message message--${type}`;

  if (type === "bot") {
    article.append(createBotAvatar());
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  if (type === "bot") {
    const audioTools = createMessageAudioTools(text);
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

function createMessageAudioTools(text) {
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
    speakText(text, button);
  });

  wrapper.append(button);
  return wrapper;
}

function speakText(text, button) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText || !canSpeak) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = detectSpeechLanguage(cleanText);
  utterance.rate = 0.96;
  utterance.pitch = 1;

  button.classList.add("audio-button--active");
  button.setAttribute("aria-label", "Hentikan suara");

  utterance.onend = () => resetAudioButton(button);
  utterance.onerror = () => resetAudioButton(button);

  window.speechSynthesis.speak(utterance);
}

function resetAudioButton(button) {
  button.classList.remove("audio-button--active");
  button.setAttribute("aria-label", "Dengarkan jawaban");
}

function detectSpeechLanguage(text) {
  const normalized = String(text || "").toLowerCase();
  const englishScore = ["the", "this", "episode", "speaker", "host", "sorry", "available", "please", "question"].filter((word) => normalized.includes(word)).length;
  const indonesianScore = ["ini", "episode", "siniar", "narasumber", "host", "maaf", "silakan", "pertanyaan"].filter((word) => normalized.includes(word)).length;
  return englishScore > indonesianScore ? "en-US" : "id-ID";
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
