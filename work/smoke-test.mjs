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

const englishGreetingRes = createRes();
await handler(createReq({ question: "Hello" }), englishGreetingRes);
assert.equal(englishGreetingRes.statusCode, 200);
assert.equal(englishGreetingRes.body.mode, "utility");
assert.match(englishGreetingRes.body.answer, /Welcome/);
assert.doesNotMatch(englishGreetingRes.body.answer, /Selamat datang/);

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
assert.match(identityRes.body.answer, /asisten percakapan/);
assert.match(identityRes.body.answer, /mudah dipahami/);

const looseIdentityRes = createRes();
await handler(createReq({ question: "Dia apa?" }), looseIdentityRes);
assert.equal(looseIdentityRes.statusCode, 200);
assert.equal(looseIdentityRes.body.mode, "utility");
assert.match(looseIdentityRes.body.answer, /asisten percakapan/);

const directIdentityRes = createRes();
await handler(createReq({ question: "kamu apa" }), directIdentityRes);
assert.equal(directIdentityRes.statusCode, 200);
assert.equal(directIdentityRes.body.mode, "utility");
assert.match(directIdentityRes.body.answer, /asisten percakapan/);
assert.doesNotMatch(directIdentityRes.body.answer, /belum tersedia/);

const reversedIdentityRes = createRes();
await handler(createReq({ question: "apa kamu" }), reversedIdentityRes);
assert.equal(reversedIdentityRes.statusCode, 200);
assert.equal(reversedIdentityRes.body.mode, "utility");
assert.match(reversedIdentityRes.body.answer, /asisten percakapan/);
assert.doesNotMatch(reversedIdentityRes.body.answer, /belum tersedia/);

const helpRes = createRes();
await handler(createReq({ question: "Kamu bisa apa?" }), helpRes);
assert.equal(helpRes.statusCode, 200);
assert.equal(helpRes.body.mode, "utility");
assert.match(helpRes.body.answer, /Saya dapat membantu/);

const capabilityRes = createRes();
await handler(createReq({ question: "Apa kemampuannya?" }), capabilityRes);
assert.equal(capabilityRes.statusCode, 200);
assert.equal(capabilityRes.body.mode, "utility");
assert.match(capabilityRes.body.answer, /ringkasan/i);

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
assert.match(missingRes.body.answer, /belum tersedia di data episode/);
assert.doesNotMatch(missingRes.body.answer, /spreadsheet/);

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
  "deskripsi_episode,Tamu Kita kali ini hadir saat Piala Dunia 2026 bergulir sehingga sepak bola menjadi pintu masuk pembahasan ekonomi Indonesia.",
  "kata_kunci,\"ekonomi\nchatib basri\nsepak bola\nindonesia\""
].join("\n"));

const keyValueRes = createRes();
await handler(createReq({ question: "Siapa narasumbernya?", podcastId: "kompas-siniar" }), keyValueRes);
assert.equal(keyValueRes.statusCode, 200);
assert.match(keyValueRes.body.answer, /Muhammad Chatib Basri/);

const hasSpeakerRes = createRes();
await handler(createReq({ question: "ada narasumber", podcastId: "kompas-siniar" }), hasSpeakerRes);
assert.equal(hasSpeakerRes.statusCode, 200);
assert.match(hasSpeakerRes.body.answer, /^Ada\. Pembicara atau narasumber episode ini adalah Muhammad Chatib Basri\./);

const speakerSynonymRes = createRes();
await handler(createReq({ question: "siapa pembicara episode ini?", podcastId: "kompas-siniar" }), speakerSynonymRes);
assert.equal(speakerSynonymRes.statusCode, 200);
assert.match(speakerSynonymRes.body.answer, /Muhammad Chatib Basri/);
assert.doesNotMatch(speakerSynonymRes.body.answer, /belum tersedia/);

const hasHostRes = createRes();
await handler(createReq({ question: "ada host?", podcastId: "kompas-siniar" }), hasHostRes);
assert.equal(hasHostRes.statusCode, 200);
assert.match(hasHostRes.body.answer, /^Ada\. Host episode ini adalah FX Agung Timbul Laksana\./);

const contextRes = createRes();
await handler(createReq({ question: "apa konteks episode ini?", podcastId: "kompas-siniar" }), contextRes);
assert.equal(contextRes.statusCode, 200);
assert.match(contextRes.body.answer, /Piala Dunia 2026/);
assert.match(contextRes.body.answer, /pintu masuk pembahasan ekonomi Indonesia/);
assert.doesNotMatch(contextRes.body.answer, /^Siniar: .*Episode kali ini berjudul/);

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

const audioMisspelledChatibRes = createRes();
await handler(createReq({ question: "Siapa Catib?", podcastId: "kompas-siniar" }), audioMisspelledChatibRes);
assert.equal(audioMisspelledChatibRes.statusCode, 200);
assert.match(audioMisspelledChatibRes.body.answer, /Muhammad Chatib Basri/);
assert.match(audioMisspelledChatibRes.body.answer, /Ekonom Senior/);
assert.doesNotMatch(audioMisspelledChatibRes.body.answer, /^Muhammad Chatib Basri\.?$/);

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
assert.match(weakMatchRes.body.answer, /belum tersedia di data episode/);
assert.doesNotMatch(weakMatchRes.body.answer, /spreadsheet/);
assert.match(weakMatchRes.body.answer, /Kompas Siniar/);
assert.match(weakMatchRes.body.answer, /episode ini berjudul/);
assert.match(weakMatchRes.body.answer, /membahas/);

process.env.OPENAI_API_KEY = "test-key";
let openAiRequestBody = "";
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("api.openai.com")) {
    openAiRequestBody = String(options.body || "");
    const answersInEnglish = openAiRequestBody.includes("Bahasa jawaban: English");
    return new Response(JSON.stringify({
      output_text: answersInEnglish
        ? "That information is not available for this episode."
        : "Informasi tersebut belum tersedia di data spreadsheet."
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
    "ringkasan_isi_siniar,Chatib Basri membahas ekonomi Indonesia dengan metafora sepak bola.",
    "isi_lengkap_siniar_sampai_menit_6,Transkrip lengkap: Chatib mengatakan Indonesia perlu berani keluar dari pola ekonomi defensif."
  ].join("\n"));
};

const openAiMissingRes = createRes();
await handler(createReq({ question: "Apa alasan pemilihan narasumber?", podcastId: "kompas-siniar" }), openAiMissingRes);
assert.equal(openAiMissingRes.statusCode, 200);
assert.equal(openAiMissingRes.body.mode, "openai");
assert.equal(openAiMissingRes.body.model, "gpt-5.4-mini");
assert.match(openAiMissingRes.body.answer, /Kompas Siniar/);
assert.match(openAiMissingRes.body.answer, /episode ini berjudul/);
assert.deepEqual(openAiMissingRes.body.sources, []);
assert.match(openAiRequestBody, /Transkrip lengkap/);
assert.match(openAiRequestBody, /ekonomi defensif/);
assert.match(openAiRequestBody, /"model":"gpt-5\.4-mini"/);

const englishOpenAiRes = createRes();
await handler(createReq({ question: "What is the speaker's background?", podcastId: "kompas-siniar" }), englishOpenAiRes);
assert.equal(englishOpenAiRes.statusCode, 200);
assert.equal(englishOpenAiRes.body.mode, "openai");
assert.equal(englishOpenAiRes.body.model, "gpt-5.4-mini");
assert.match(englishOpenAiRes.body.answer, /Sorry, that information is not available/);
assert.doesNotMatch(englishOpenAiRes.body.answer, /Maaf|belum tersedia/);
assert.match(openAiRequestBody, /Bahasa jawaban: English/);
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
  "apa_itu_kompas_professional_mining,Kompas Professional Mining adalah bagian dari harian Kompas yang fokus mengulas isu pertambangan.",
  "ringkasan_dan_time_stamp,Dijelaskan mekanisme Domestic Market Obligation atau DMO. Perusahaan tambang wajib memasok kebutuhan domestik dan dapat terkena sanksi jika tidak memenuhi kewajiban tersebut. HOP adalah Hari Operasi Pembangkit yang menunjukkan umur stok batu bara di PLTU. PLTU adalah pembangkit listrik tenaga uap. Persoalan data muncul karena stok batu bara belum termonitor secara terintegrasi."
].join("\n"));

const newPodcastSpeakerRes = createRes();
await handler(createReq({ question: "ada narasumber", podcastId: "kompas-professional-mining" }), newPodcastSpeakerRes);
assert.equal(newPodcastSpeakerRes.statusCode, 200);
assert.match(newPodcastSpeakerRes.body.answer, /Ardhi Ishak/);

const newPodcastSpeakerSynonymRes = createRes();
await handler(createReq({ question: "ada pembicara?", podcastId: "kompas-professional-mining" }), newPodcastSpeakerSynonymRes);
assert.equal(newPodcastSpeakerSynonymRes.statusCode, 200);
assert.match(newPodcastSpeakerSynonymRes.body.answer, /Ardhi Ishak/);
assert.doesNotMatch(newPodcastSpeakerSynonymRes.body.answer, /belum tersedia/);

const audioMisspelledArdhiRes = createRes();
await handler(createReq({ question: "siapa Ardi Isak?", podcastId: "kompas-professional-mining" }), audioMisspelledArdhiRes);
assert.equal(audioMisspelledArdhiRes.statusCode, 200);
assert.match(audioMisspelledArdhiRes.body.answer, /Ardhi Ishak/);
assert.doesNotMatch(audioMisspelledArdhiRes.body.answer, /belum tersedia/);

const newPodcastHostRes = createRes();
await handler(createReq({ question: "ada host?", podcastId: "kompas-professional-mining" }), newPodcastHostRes);
assert.equal(newPodcastHostRes.statusCode, 200);
assert.match(newPodcastHostRes.body.answer, /Aris Prasetyo/);

const newPodcastEpisodeRes = createRes();
await handler(createReq({ question: "episode apa", podcastId: "kompas-professional-mining" }), newPodcastEpisodeRes);
assert.equal(newPodcastEpisodeRes.statusCode, 200);
assert.match(newPodcastEpisodeRes.body.answer, /Siniar: Kompas Professional Mining/);
assert.match(newPodcastEpisodeRes.body.answer, /Episode kali ini berjudul/);
assert.match(newPodcastEpisodeRes.body.answer, /Mengurai Sengkarut Tata Kelola Batubara/);
assert.doesNotMatch(newPodcastEpisodeRes.body.answer, /belum tersedia/);

const newPodcastInterestingRes = createRes();
await handler(createReq({ question: "episode ini menarik tidak", podcastId: "kompas-professional-mining" }), newPodcastInterestingRes);
assert.equal(newPodcastInterestingRes.statusCode, 200);
assert.match(newPodcastInterestingRes.body.answer, /Siniar ini penting/);
assert.doesNotMatch(newPodcastInterestingRes.body.answer, /belum tersedia/);

const newPodcastContentRes = createRes();
await handler(createReq({ question: "apa yang disampaikan", podcastId: "kompas-professional-mining" }), newPodcastContentRes);
assert.equal(newPodcastContentRes.statusCode, 200);
assert.match(newPodcastContentRes.body.answer, /Krisis pasokan batu bara/);
assert.doesNotMatch(newPodcastContentRes.body.answer, /belum tersedia/);

const newPodcastSpeakerStatementRes = createRes();
await handler(createReq({ question: "apa yang dibilang narasumber", podcastId: "kompas-professional-mining" }), newPodcastSpeakerStatementRes);
assert.equal(newPodcastSpeakerStatementRes.statusCode, 200);
assert.match(newPodcastSpeakerStatementRes.body.answer, /Ardhi Ishak/);
assert.match(newPodcastSpeakerStatementRes.body.answer, /Krisis pasokan batu bara/);
assert.doesNotMatch(newPodcastSpeakerStatementRes.body.answer, /belum tersedia/);

const naturalContentRes = createRes();
await handler(createReq({ question: "ini ngomongin apa sih?", podcastId: "kompas-professional-mining" }), naturalContentRes);
assert.equal(naturalContentRes.statusCode, 200);
assert.match(naturalContentRes.body.answer, /Krisis pasokan batu bara/);
assert.doesNotMatch(naturalContentRes.body.answer, /belum tersedia/);

const naturalProblemRes = createRes();
await handler(createReq({ question: "problemnya apa?", podcastId: "kompas-professional-mining" }), naturalProblemRes);
assert.equal(naturalProblemRes.statusCode, 200);
assert.match(naturalProblemRes.body.answer, /tata kelola|koordinasi data|Krisis pasokan batu bara/);
assert.doesNotMatch(naturalProblemRes.body.answer, /belum tersedia/);

const naturalSpeakerRes = createRes();
await handler(createReq({ question: "pembicaranya bilang apa?", podcastId: "kompas-professional-mining" }), naturalSpeakerRes);
assert.equal(naturalSpeakerRes.statusCode, 200);
assert.match(naturalSpeakerRes.body.answer, /Ardhi Ishak|Krisis pasokan batu bara/);
assert.doesNotMatch(naturalSpeakerRes.body.answer, /belum tersedia/);

const newPodcastTopicRes = createRes();
await handler(createReq({ question: "pokok bahasan", podcastId: "kompas-professional-mining" }), newPodcastTopicRes);
assert.equal(newPodcastTopicRes.statusCode, 200);
assert.match(newPodcastTopicRes.body.answer, /Krisis pasokan batu bara/);
assert.doesNotMatch(newPodcastTopicRes.body.answer, /belum tersedia/);

const newPodcastTermRes = createRes();
await handler(createReq({ question: "apa itu DMO", podcastId: "kompas-professional-mining" }), newPodcastTermRes);
assert.equal(newPodcastTermRes.statusCode, 200);
assert.match(newPodcastTermRes.body.answer, /Domestic Market Obligation|DMO/);
assert.doesNotMatch(newPodcastTermRes.body.answer, /belum tersedia/);

const newPodcastHopRes = createRes();
await handler(createReq({ question: "HOP", podcastId: "kompas-professional-mining" }), newPodcastHopRes);
assert.equal(newPodcastHopRes.statusCode, 200);
assert.match(newPodcastHopRes.body.answer, /Hari Operasi Pembangkit|HOP/);
assert.doesNotMatch(newPodcastHopRes.body.answer, /belum tersedia/);

const newPodcastPltuRes = createRes();
await handler(createReq({ question: "apa itu PLTU", podcastId: "kompas-professional-mining" }), newPodcastPltuRes);
assert.equal(newPodcastPltuRes.statusCode, 200);
assert.match(newPodcastPltuRes.body.answer, /pembangkit listrik tenaga uap|PLTU/i);
assert.doesNotMatch(newPodcastPltuRes.body.answer, /belum tersedia/);

const newPodcastDataRes = createRes();
await handler(createReq({ question: "data stok", podcastId: "kompas-professional-mining" }), newPodcastDataRes);
assert.equal(newPodcastDataRes.statusCode, 200);
assert.match(newPodcastDataRes.body.answer, /terintegrasi|stok batu bara/);
assert.doesNotMatch(newPodcastDataRes.body.answer, /belum tersedia/);

const newPodcastDefinitionRes = createRes();
await handler(createReq({ question: "Apa itu Kompas Professional Mining?", podcastId: "kompas-professional-mining" }), newPodcastDefinitionRes);
assert.equal(newPodcastDefinitionRes.statusCode, 200);
assert.match(newPodcastDefinitionRes.body.answer, /fokus mengulas isu pertambangan/);

globalThis.fetch = async () => new Response([
  "kunci,Bahasa Indonesia",
  "nomor_video,video_3",
  "judul,Kurs Dolar AS Tidak Pengaruhi Masyarakat Desa Fakta atau Mitos?",
  "link_video,https://www.kompas.id/artikel/kurs-dolar-as-tidak-pengaruhi-masyarakat-desa-fakta-atau-mitos",
  "nama_host,Agustina Purwanti",
  "profil_host,Agustina Purwanti adalah peneliti Litbang harian Kompas.",
  "nama_narasumber_1,Karina Isna Irawan",
  "profil_narasumber_1,Karina adalah peneliti Litbang harian Kompas yang banyak meneliti isu ekonomi.",
  "nama_narasumber_2,Susy Sartika Rumbo",
  "profil_narasumber_2,Susy adalah peneliti Litbang harian Kompas yang banyak meneliti soal ekonomi.",
  "ringkasan_isi_siniar,Siniar ini ditayangkan saat nilai tukar rupiah melemah atas dolar AS. Dampak pelemahan rupiah ini menyebar hingga masyarakat di pedesaan.",
  "kenapa_siniar_ini_penting,Pembahasan ini menyajikan data dan analisis Litbang Kompas atas isu aktual.",
  "nama_siniar,Bongkar Data",
  "deskripsi_siniar,Bongkar Data adalah siniar Harian Kompas yang menyajikan data serta analisis Litbang Kompas.",
  "transkrip_siniar,Kurs dolar AS memengaruhi harga barang impor dan tekanan biaya. Dampaknya dapat terasa hingga desa melalui harga kebutuhan dan daya beli masyarakat."
].join("\n"));

const bongkarSpeakerRes = createRes();
await handler(createReq({ question: "siapa pembicaranya?", podcastId: "bongkar-data" }), bongkarSpeakerRes);
assert.equal(bongkarSpeakerRes.statusCode, 200);
assert.match(bongkarSpeakerRes.body.answer, /Karina Isna Irawan/);
assert.match(bongkarSpeakerRes.body.answer, /Susy Sartika Rumbo/);
assert.doesNotMatch(bongkarSpeakerRes.body.answer, /belum tersedia/);

const audioMisspelledSusyRes = createRes();
await handler(createReq({ question: "siapa Susi Rambo?", podcastId: "bongkar-data" }), audioMisspelledSusyRes);
assert.equal(audioMisspelledSusyRes.statusCode, 200);
assert.match(audioMisspelledSusyRes.body.answer, /Susy Sartika Rumbo/);
assert.doesNotMatch(audioMisspelledSusyRes.body.answer, /belum tersedia/);

const bongkarContentRes = createRes();
await handler(createReq({ question: "ngomongin apa sih?", podcastId: "bongkar-data" }), bongkarContentRes);
assert.equal(bongkarContentRes.statusCode, 200);
assert.match(bongkarContentRes.body.answer, /rupiah|dolar AS|pedesaan/);
assert.doesNotMatch(bongkarContentRes.body.answer, /belum tersedia/);

const bongkarTermRes = createRes();
await handler(createReq({ question: "kurs dolar ngaruh ke desa?", podcastId: "bongkar-data" }), bongkarTermRes);
assert.equal(bongkarTermRes.statusCode, 200);
assert.match(bongkarTermRes.body.answer, /desa|harga|daya beli|rupiah|dolar/);
assert.doesNotMatch(bongkarTermRes.body.answer, /belum tersedia/);

globalThis.fetch = originalFetch;

console.log("Smoke tests passed.");
