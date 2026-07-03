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

globalThis.fetch = originalFetch;

console.log("Smoke tests passed.");
