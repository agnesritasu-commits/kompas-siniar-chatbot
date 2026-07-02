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
assert.match(greetingRes.body.answer, /berdasarkan data spreadsheet/);

const helpRes = createRes();
await handler(createReq({ question: "Kamu bisa apa?" }), helpRes);
assert.equal(helpRes.statusCode, 200);
assert.equal(helpRes.body.mode, "utility");
assert.match(helpRes.body.answer, /Contoh/);

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
assert.equal(missingRes.body.answer, "Informasi tersebut belum tersedia di data spreadsheet.");

globalThis.fetch = async () => new Response([
  "kunci,Bahasa Indonesia",
  "nomor_video,video_1",
  "judul,Chatib Basri: Piala Dunia 2026 dan Catenaccio Ekonomi Indonesia",
  "link_video,https://www.kompas.id/artikel/contoh",
  "nama_narasumber,Muhammad Chatib Basri",
  "profil_narasumber,Ekonom Senior",
  "ringkasan_isi_siniar,Chatib Basri membahas ekonomi Indonesia dengan metafora sepak bola.",
  "apa_itu_catenaccio,Catenaccio adalah taktik sepak bola Italia yang mengutamakan pertahanan terorganisasi.",
  "kata_kunci,\"ekonomi\nchatib basri\nsepak bola\nindonesia\""
].join("\n"));

const keyValueRes = createRes();
await handler(createReq({ question: "Siapa narasumbernya?", podcastId: "kompas-siniar" }), keyValueRes);
assert.equal(keyValueRes.statusCode, 200);
assert.match(keyValueRes.body.answer, /Muhammad Chatib Basri/);

const catenaccioRes = createRes();
await handler(createReq({ question: "Apa itu catenaccio?", podcastId: "kompas-siniar" }), catenaccioRes);
assert.equal(catenaccioRes.statusCode, 200);
assert.match(catenaccioRes.body.answer, /taktik sepak bola Italia/);
assert.doesNotMatch(catenaccioRes.body.answer, /https:\/\/www\.kompas\.id/);

globalThis.fetch = originalFetch;

console.log("Smoke tests passed.");
