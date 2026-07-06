import assert from "node:assert/strict";
import handler from "../api/chat.js";

const originalFetch = globalThis.fetch;

function createReq(body) {
  return {
    method: "POST",
    headers: {},
    body
  };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    }
  };
}

const sensitiveRes = createRes();
await handler(createReq({ question: "Email saya test@example.com" }), sensitiveRes);
assert.equal(sensitiveRes.statusCode, 400);

const greetingRes = createRes();
await handler(createReq({ question: "Halo" }), greetingRes);
assert.equal(greetingRes.statusCode, 200);
assert.equal(greetingRes.body.mode, "utility");
assert.match(greetingRes.body.answer, /Selamat datang/);
assert.match(greetingRes.body.answer, /ringkas/);

const wellbeingRes = createRes();
await handler(createReq({ question: "Apa kabar?" }), wellbeingRes);
assert.equal(wellbeingRes.statusCode, 200);
assert.equal(wellbeingRes.body.mode, "utility");
assert.match(wellbeingRes.body.answer, /Terima kasih/);

const mixedGreetingRes = createRes();
await handler(createReq({ question: "Halo apa kabar?" }), mixedGreetingRes);
assert.equal(mixedGreetingRes.statusCode, 200);
assert.equal(mixedGreetingRes.body.mode, "utility");
assert.match(mixedGreetingRes.body.answer, /singkat, sopan, dan informatif/);

const identityRes = createRes();
await handler(createReq({ question: "Kamu siapa?" }), identityRes);
assert.equal(identityRes.statusCode, 200);
assert.equal(identityRes.body.mode, "utility");
assert.match(identityRes.body.answer, /chatbot Kompas Siniar/);
assert.match(identityRes.body.answer, /informatif/);

const helpRes = createRes();
await handler(createReq({ question: "Kamu bisa apa?" }), helpRes);
assert.equal(helpRes.statusCode, 200);
assert.equal(helpRes.body.mode, "utility");
assert.match(helpRes.body.answer, /Contohnya/);

globalThis.fetch = async () => new Response([
  "podcast_id,episode_id,episode_title,topic,question,answer,keywords,source_url",
  "kompas-siniar,utama,Episode Uji,narasumber,Siapa narasumber?,Narasumbernya adalah Redaksi Kompas.,narasumber;tamu,https://www.kompas.id/",
  "kompas-siniar,utama,Episode Uji,tema,Apa tema?,Tema episode adalah literasi publik.,tema;topik,https://www.kompas.id/"
].join("\n"));

const fallbackRes = createRes();
await handler(createReq({ question: "Siapa narasumber episode ini?", podcastId: "kompas-siniar" }), fallbackRes);
assert.equal(fallbackRes.statusCode, 200);
assert.equal(fallbackRes.body.mode, "fallback");
assert.match(fallbackRes.body.answer, /Redaksi Kompas/);

const missingRes = createRes();
await handler(createReq({ question: "Berapa harga tiket konser?", podcastId: "kompas-siniar" }), missingRes);
assert.equal(missingRes.statusCode, 200);
assert.match(missingRes.body.answer, /belum tersedia di data spreadsheet/);

globalThis.fetch = async () => new Response([
  "kunci,Bahasa Indonesia",
  "nama_siniar,Kompas Siniar",
  "nomor_video,video_1",
  "judul,Chatib Basri: Piala Dunia 2026 dan Catenaccio Ekonomi Indonesia",
  "link_video,https://www.kompas.id/artikel/contoh",
  "nama_narasumber,Muhammad Chatib Basri",
  "profil_narasumber,Ekonom Senior",
  "nama_host,FX Agung Timbul Laksana",
  "profil_host,FX Agung Timbul Laksana adalah wartawan ekonomi Harian Kompas dan Kompas.id.",
  "ringkasan_isi_siniar,Chatib Basri membahas ekonomi Indonesia dengan metafora sepak bola.",
  "kenapa_siniar_ini_penting,Pembahasan ini menarik karena menjelaskan ekonomi Indonesia dengan gaya bertutur yang ringan.",
  "apa_itu_catenaccio,Catenaccio adalah taktik sepak bola Italia yang mengutamakan pertahanan terorganisasi.",
  "kata_kunci,\"ekonomi\nchatib basri\nsepak bola\nindonesia\""
].join("\n"));

const keyValueRes = createRes();
await handler(createReq({ question: "Siapa narasumbernya?", podcastId: "kompas-siniar" }), keyValueRes);
assert.equal(keyValueRes.statusCode, 200);
assert.match(keyValueRes.body.answer, /Muhammad Chatib Basri/);

const hasSpeakerRes = createRes();
await handler(createReq({ question: "ada narasumber", podcastId: "kompas-siniar" }), hasSpeakerRes);
assert.equal(hasSpeakerRes.statusCode, 200);
assert.match(hasSpeakerRes.body.answer, /^Ada\. Narasumber episode ini adalah Muhammad Chatib Basri\./);

const hasHostRes = createRes();
await handler(createReq({ question: "ada host?", podcastId: "kompas-siniar" }), hasHostRes);
assert.equal(hasHostRes.statusCode, 200);
assert.match(hasHostRes.body.answer, /^Ada\. Host episode ini adalah FX Agung Timbul Laksana\./);

const followUpRes = createRes();
await handler(createReq({
  question: "Siapa dia?",
  podcastId: "kompas-siniar",
  history: [
    {
      role: "user",
      content: "Siapa narasumbernya?"
    },
    {
      role: "assistant",
      content: keyValueRes.body.answer,
      sources: keyValueRes.body.sources
    }
  ]
}), followUpRes);
assert.equal(followUpRes.statusCode, 200);
assert.match(followUpRes.body.answer, /Muhammad Chatib Basri/);
assert.doesNotMatch(followUpRes.body.answer, /FX Agung/);

const summaryFollowUpRes = createRes();
await handler(createReq({
  question: "Siapa dia?",
  podcastId: "kompas-siniar",
  history: [
    {
      role: "user",
      content: "Apa ringkasannya?"
    },
    {
      role: "assistant",
      content: "Chatib Basri membahas ekonomi Indonesia dengan metafora sepak bola.",
      sources: [{ topic: "ringkasan isi siniar" }]
    }
  ]
}), summaryFollowUpRes);
assert.equal(summaryFollowUpRes.statusCode, 200);
assert.match(summaryFollowUpRes.body.answer, /Muhammad Chatib Basri/);
assert.match(summaryFollowUpRes.body.answer, /Ekonom Senior/);
assert.doesNotMatch(summaryFollowUpRes.body.answer, /FX Agung/);

const hostFollowUpRes = createRes();
await handler(createReq({
  question: "Siapa dia?",
  podcastId: "kompas-siniar",
  history: [
    {
      role: "user",
      content: "Ada host?"
    },
    {
      role: "assistant",
      content: 'Ada. Host episode ini adalah FX Agung "Timbul" Laksana.',
      sources: [
        { topic: "nama host" },
        { topic: "profil host" },
        { topic: "profil narasumber" }
      ]
    }
  ]
}), hostFollowUpRes);
assert.equal(hostFollowUpRes.statusCode, 200);
assert.match(hostFollowUpRes.body.answer, /FX Agung/);
assert.match(hostFollowUpRes.body.answer, /wartawan ekonomi/);
assert.doesNotMatch(hostFollowUpRes.body.answer, /Muhammad Chatib Basri adalah ekonom senior/);

const directChatibRes = createRes();
await handler(createReq({ question: "Siapa Chatib?", podcastId: "kompas-siniar" }), directChatibRes);
assert.equal(directChatibRes.statusCode, 200);
assert.match(directChatibRes.body.answer, /Muhammad Chatib Basri/);
assert.match(directChatibRes.body.answer, /Ekonom Senior/);
assert.doesNotMatch(directChatibRes.body.answer, /^Muhammad Chatib Basri\.?$/);

const catenaccioRes = createRes();
await handler(createReq({ question: "Apa itu catenaccio?", podcastId: "kompas-siniar" }), catenaccioRes);
assert.equal(catenaccioRes.statusCode, 200);
assert.match(catenaccioRes.body.answer, /taktik sepak bola Italia/);
assert.doesNotMatch(catenaccioRes.body.answer, /https:\/\/www\.kompas\.id/);

const interestingRes = createRes();
await handler(createReq({ question: "Menurut kamu episode ini menarik tidak?", podcastId: "kompas-siniar" }), interestingRes);
assert.equal(interestingRes.statusCode, 200);
assert.match(interestingRes.body.answer, /menarik/);
assert.doesNotMatch(interestingRes.body.answer, /Piala Dunia 2026 bergulir/);

const hostContentRes = createRes();
await handler(createReq({ question: "Apa yang diomongkan FX Laksana?", podcastId: "kompas-siniar" }), hostContentRes);
assert.equal(hostContentRes.statusCode, 200);
assert.match(hostContentRes.body.answer, /membahas ekonomi Indonesia/);
assert.doesNotMatch(hostContentRes.body.answer, /^FX Agung Timbul Laksana$/);

const weakMatchRes = createRes();
await handler(createReq({ question: "Apa pendapat Chatib tentang makan siang gratis?", podcastId: "kompas-siniar" }), weakMatchRes);
assert.equal(weakMatchRes.statusCode, 200);
assert.match(weakMatchRes.body.answer, /belum tersedia di data spreadsheet/);
assert.match(weakMatchRes.body.answer, /Kompas Siniar/);
assert.match(weakMatchRes.body.answer, /episode ini berjudul/);
assert.match(weakMatchRes.body.answer, /membahas/);

process.env.OPENAI_API_KEY = "test-key";
globalThis.fetch = async (url) => {
  if (String(url).includes("api.openai.com")) {
    return new Response(JSON.stringify({
      output_text: "Informasi tersebut belum tersedia di data spreadsheet."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response([
    "kunci,Bahasa Indonesia",
    "nama_siniar,Kompas Siniar",
    "nomor_video,video_1",
    "judul,Chatib Basri: Piala Dunia 2026 dan Catenaccio Ekonomi Indonesia",
    "link_video,https://www.kompas.id/artikel/contoh",
    "nama_narasumber,Muhammad Chatib Basri",
    "profil_narasumber,Ekonom Senior",
    "alasan_pemilihan_narasumber,Chatib dipilih karena ekonom senior dan penggemar sepak bola.",
    "nama_host,FX Agung Timbul Laksana",
    "profil_host,FX Agung Timbul Laksana adalah wartawan ekonomi Harian Kompas dan Kompas.id.",
    "ringkasan_isi_siniar,Chatib Basri membahas ekonomi Indonesia dengan metafora sepak bola."
  ].join("\n"));
};

const openAiMissingRes = createRes();
await handler(createReq({ question: "Apa alasan pemilihan narasumber?", podcastId: "kompas-siniar" }), openAiMissingRes);
assert.equal(openAiMissingRes.statusCode, 200);
assert.equal(openAiMissingRes.body.mode, "openai");
assert.match(openAiMissingRes.body.answer, /Kompas Siniar/);
assert.match(openAiMissingRes.body.answer, /episode ini berjudul/);
assert.deepEqual(openAiMissingRes.body.sources, []);
delete process.env.OPENAI_API_KEY;

globalThis.fetch = async () => new Response([
  "kunci,Bahasa Indonesia",
  "nomor_video,video_2",
  "judul,Mengurai Sengkarut Tata Kelola Batubara di Balik Insiden Byarpet Listrik",
  "link_video,https://www.kompas.id/artikel/mengurai-sengkarut-pasokan-batubara-di-balik-insiden-byarpet-listrik",
  "nama_host,Aris Prasetyo",
  "profil_host,Wartawan harian Kompas/Kompas.id yang banyak meliput isu pertambangan dan energi di Indonesia.",
  "nama_narasumber,Ardhi Ishak",
  "profil_narasumber,Ketua Bidang Hubungan Industri dan Asosiasi Industri Perhimpunan Ahli Pertambangan Indonesia",
  "ringkasan_isi_siniar,Krisis pasokan batu bara untuk PLTU bukan disebabkan minimnya cadangan nasional, melainkan persoalan tata kelola dan koordinasi data.",
  "kenapa_siniar_ini_penting,Siniar ini penting karena menjelaskan spekulasi pemadaman listrik dan persoalan pasokan batu bara.",
  "nama_siniar,Kompas Professional Mining",
  "apa_itu_kompas_professional_mining,Kompas Professional Mining adalah bagian dari harian Kompas yang fokus mengulas isu pertambangan."
].join("\n"));

const newPodcastSpeakerRes = createRes();
await handler(createReq({ question: "ada narasumber", podcastId: "kompas-professional-mining" }), newPodcastSpeakerRes);
assert.equal(newPodcastSpeakerRes.statusCode, 200);
assert.match(newPodcastSpeakerRes.body.answer, /Ardhi Ishak/);

const newPodcastHostRes = createRes();
await handler(createReq({ question: "ada host?", podcastId: "kompas-professional-mining" }), newPodcastHostRes);
assert.equal(newPodcastHostRes.statusCode, 200);
assert.match(newPodcastHostRes.body.answer, /Aris Prasetyo/);

const newPodcastEpisodeRes = createRes();
await handler(createReq({ question: "episode apa", podcastId: "kompas-professional-mining" }), newPodcastEpisodeRes);
assert.equal(newPodcastEpisodeRes.statusCode, 200);
assert.match(newPodcastEpisodeRes.body.answer, /Episode Kompas Professional Mining kali ini berjudul/);
assert.match(newPodcastEpisodeRes.body.answer, /Mengurai Sengkarut Tata Kelola Batubara/);
assert.doesNotMatch(newPodcastEpisodeRes.body.answer, /belum tersedia/);

const newPodcastInterestingRes = createRes();
await handler(createReq({ question: "episode ini menarik tidak", podcastId: "kompas-professional-mining" }), newPodcastInterestingRes);
assert.equal(newPodcastInterestingRes.statusCode, 200);
assert.match(newPodcastInterestingRes.body.answer, /Siniar ini penting/);
assert.doesNotMatch(newPodcastInterestingRes.body.answer, /belum tersedia/);

const newPodcastDefinitionRes = createRes();
await handler(createReq({ question: "Apa itu Kompas Professional Mining?", podcastId: "kompas-professional-mining" }), newPodcastDefinitionRes);
assert.equal(newPodcastDefinitionRes.statusCode, 200);
assert.match(newPodcastDefinitionRes.body.answer, /fokus mengulas isu pertambangan/);

globalThis.fetch = originalFetch;

console.log("Smoke tests passed.");
