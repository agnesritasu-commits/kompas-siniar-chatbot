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
        episodeId
      })
    });

    const data = await response.json();
    typing.remove();

    if (!response.ok) {
      throw new Error(data.error || "Pertanyaan belum bisa diproses.");
    }

    appendMessage(data.answer || "Informasi tersebut belum tersedia di data spreadsheet.", "bot");
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

function appendMessage(text, type) {
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
  article.append(bubble);
  messages.append(article);
  scrollToLatest();
  return article;
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
