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

globalThis.fetch = originalFetch;

console.log("Smoke tests passed.");
