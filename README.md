# Kompas Siniar Chatbot

Widget chatbot sederhana untuk embed iframe di halaman Kompas.id. Frontend memakai HTML, CSS, dan JavaScript; backend memakai Vercel Serverless Function yang membaca Google Spreadsheet publik dalam format CSV.

## Struktur Folder

```text
.
├── api/
│   └── chat.js
├── config/
│   └── podcasts.json
├── examples/
│   └── spreadsheet-format.csv
├── public/
│   ├── assets/
│   │   └── kompas-mark.jpeg
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── .env.example
├── package.json
├── vercel.json
└── README.md
```

## Format Spreadsheet

Buat Google Spreadsheet dengan baris header seperti contoh di `examples/spreadsheet-format.csv`.

Kolom yang disarankan:

```csv
podcast_id,episode_id,episode_title,topic,question,answer,keywords,source_url
kompas-siniar,utama,Contoh Episode,tema utama,Apa topik utama episode ini?,Topik utama episode ini adalah contoh isi yang berasal dari spreadsheet.,topik;tema;episode,https://www.kompas.id/
```

Catatan penting:

- Jangan memasukkan data rahasia atau data pribadi ke spreadsheet karena CSV dipublikasikan.
- Isi kolom `answer` dengan jawaban final yang boleh ditampilkan chatbot.
- Gunakan `keywords` untuk membantu fallback pencocokan kata kunci.
- Tambahkan `podcast_id` dan `episode_id` agar banyak siniar atau episode bisa memakai satu spreadsheet.

## Publikasikan Spreadsheet sebagai CSV

1. Buka Google Spreadsheet.
2. Pilih `File` -> `Share` -> `Publish to web`.
3. Publikasikan sheet yang dipakai.
4. Gunakan URL CSV seperti:

```text
https://docs.google.com/spreadsheets/d/e/SPREADSHEET_ID/pub?gid=0&single=true&output=csv
```

## Konfigurasi Siniar dan Episode

Edit `config/podcasts.json`.

```json
{
  "defaultPodcastId": "kompas-siniar",
  "podcasts": [
    {
      "id": "kompas-siniar",
      "name": "Kompas Siniar",
      "description": "Chatbot berbasis data spreadsheet publik.",
      "csvUrl": "https://docs.google.com/spreadsheets/d/e/SPREADSHEET_ID/pub?gid=0&single=true&output=csv",
      "episodes": [
        {
          "id": "utama",
          "title": "Semua episode",
          "sheet": "Sheet1"
        }
      ]
    }
  ]
}
```

Untuk menambah siniar, tambahkan objek baru ke `podcasts`. Untuk menambah episode, tambahkan baris di spreadsheet dengan `episode_id` berbeda dan tambahkan juga metadata episode di `episodes`.

## Environment Variable

Salin `.env.example` menjadi `.env.local` untuk pengembangan lokal atau isi di Vercel Project Settings.

```text
OPENAI_API_KEY=isi_api_key_openai
OPENAI_MODEL=gpt-5.4-mini
ALLOWED_ORIGINS=https://www.kompas.id,https://interaktif.kompas.id
```

`OPENAI_MODEL` bisa diganti tanpa mengubah kode. Backend hanya memanggil model ini. Jika `OPENAI_API_KEY` kosong atau OpenAI API/model tidak tersedia, backend memakai fallback pencocokan kata kunci dari spreadsheet.

## Jalankan Lokal

```bash
npm install
npm run dev
```

Buka:

```text
http://localhost:3000
```

Filter data berdasarkan episode:

```text
http://localhost:3000/?podcast=kompas-siniar&episode=utama
```

## Deploy ke Vercel

1. Buat repository GitHub dan push folder proyek ini.
2. Buka Vercel, pilih `Add New Project`.
3. Hubungkan repository GitHub.
4. Tambahkan environment variable `OPENAI_API_KEY`, `OPENAI_MODEL`, dan opsional `ALLOWED_ORIGINS`.
5. Deploy.

## Embed iframe di Kompas.id

Ganti domain dengan URL Vercel hasil deploy.

```html
<iframe
  src="https://nama-proyek.vercel.app/?podcast=kompas-siniar&episode=utama"
  title="Chatbot Kompas Siniar"
  style="width:100%;height:720px;border:0;display:block;"
  loading="lazy"
></iframe>
```

Untuk halaman dengan ruang vertikal lebih besar, tinggi iframe bisa dinaikkan, misalnya `900px`. Layout widget akan tetap mengisi tinggi iframe.

## Batasan Perilaku Chatbot

- Chatbot tidak mencari informasi di internet.
- Chatbot menjawab hanya dari data spreadsheet yang dipublikasikan.
- Jika informasi tidak ada, chatbot menjawab: `Informasi tersebut belum tersedia di data spreadsheet.`
- Pertanyaan yang berisi email atau nomor telepon ditolak sebelum dikirim ke OpenAI.
- Riwayat percakapan tidak disimpan di database.
