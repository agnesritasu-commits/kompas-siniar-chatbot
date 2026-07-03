const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const messages = document.querySelector("#messages");
const statusEl = document.querySelector("#status");
const sendButton = document.querySelector("#send-button");

const params = new URLSearchParams(window.location.search);
const podcastId = params.get("podcast") || "kompas-siniar";
const episodeId = params.get("episode") || "";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\s().-]?){8,}\d/;
const privacyWarning = "Jangan kirim data pribadi seperti email, nomor telepon, alamat rumah, atau informasi sensitif.";
const conversationHistory = [];

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;

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

    appendMessage(data.answer || "Informasi tersebut belum tersedia di data spreadsheet.", "bot", data.sources || []);
    rememberTurn("user", question);
    rememberTurn("assistant", data.answer || "", data.sources || []);
    setStatus(data.mode === "fallback" ? "Jawaban memakai pencocokan kata kunci dari spreadsheet." : "");
  } catch (error) {
    typing.remove();
    appendMessage("Maaf, chatbot belum bisa menjawab saat ini. Coba lagi beberapa saat lagi.", "bot");
    setStatus(error.message, true);
  } finally {
    setLoading(false);
    input.focus();
  }
});

input.addEventListener("input", resizeInput);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

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
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "K";
    article.append(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  if (type === "bot") {
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
    link.textContent = "Baca episode";
    link.setAttribute("aria-label", source.title ? `Baca episode: ${source.title}` : "Baca episode");
    wrapper.append(link);
  });

  return wrapper;
}

function appendTyping() {
  const article = document.createElement("article");
  article.className = "message message--bot typing";
  article.innerHTML = `
    <div class="avatar" aria-hidden="true">K</div>
    <div class="bubble" aria-label="Sedang menulis">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  messages.append(article);
  scrollToLatest();
  return article;
}

function resizeInput() {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight / rootFontSize}rem`;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  input.disabled = isLoading;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
}

function scrollToLatest() {
  messages.scrollTop = messages.scrollHeight;
}
