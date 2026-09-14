# AI Pipeline Job Processing API

API pemrosesan AI asinkron berbasis TypeScript. Client mengirim materi belajar melalui HTTP, API menyimpan job secara persisten, BullMQ menjadwalkan pekerjaan, lalu background worker menjalankan pipeline AI dan menyimpan hasil beserta catatan setiap tahap pemrosesan.

> Status project: **infrastructure and persistence foundation**. Hono, PostgreSQL, Redis, BullMQ, Prisma, the initial schema, and an infrastructure smoke worker are available. Job HTTP endpoints and the real AI pipeline remain the next implementation phases from the project plan.

## Tujuan

Project ini dirancang untuk mendemonstrasikan pemisahan tanggung jawab dalam sistem AI asinkron:

- **Hono API** menerima dan memvalidasi request tanpa menunggu proses AI selesai.
- **PostgreSQL** menjadi source of truth untuk input, status, hasil akhir, dan riwayat pipeline.
- **BullMQ + Redis** mengatur antrean, retry, dan distribusi pekerjaan.
- **Background worker** mengambil job dan menjalankan pipeline di proses terpisah.
- **Anvia SDK** menjalankan pipeline menggunakan model AI nyata melalui provider OpenAI-compatible.
- **Prisma** menyediakan akses data bertipe ke PostgreSQL.

Prinsip utamanya:

> BullMQ mengatur kapan pekerjaan dijalankan, sedangkan PostgreSQL menyimpan state dan hasil yang harus bertahan lama.

Redis bukan penyimpanan permanen untuk hasil bisnis.

## Gambaran Besar Arsitektur

```text
Client
  |
  | POST /jobs
  v
Hono API
  |-- validasi input
  |-- simpan Job (PENDING)
  |-- enqueue { jobId }
  v
PostgreSQL <------> BullMQ / Redis
                         |
                         v
                  Background Worker
                         |
                         |-- ambil input dari PostgreSQL
                         |-- ubah status menjadi PROCESSING
                         |-- jalankan sequential AI pipeline
                         |-- simpan setiap JobStep
                         |-- simpan hasil akhir
                         v
                    PostgreSQL
                         |
                         |-- Job = COMPLETED / FAILED
                         |-- result / error tersimpan
                         v
              GET /jobs dan GET /jobs/:id
```

### Batas tanggung jawab

| Komponen | Tanggung jawab |
| --- | --- |
| Hono API | HTTP routing, validasi request, membuat job, dan membaca status/result |
| PostgreSQL | Durable state, input asli, hasil akhir, error, dan pipeline step logs |
| BullMQ | Penjadwalan job, retry, dan backoff |
| Redis | Backend antrean BullMQ, bukan database hasil akhir |
| Worker | Mengambil job dan mengoordinasikan eksekusi pipeline |
| AI pipeline | Mentransformasikan input melalui tahap-tahap yang terdefinisi |
| Anvia SDK/provider | Menjalankan model call dan menghasilkan structured output |
| Prisma | Akses dan migrasi database PostgreSQL |

Queue hanya membawa payload kecil:

```json
{
  "jobId": "database-job-id"
}
```

Input lengkap dibaca ulang dari PostgreSQL agar retry selalu menggunakan data canonical dan tidak menduplikasi payload besar di Redis.

## Pipeline AI

Use case utama adalah **Study Guide Generator** dengan pola sequential pipeline / prompt chaining:

```text
Topic + Content
      |
      v
Analyze Material
      |
      v
Extract Key Concepts
      |
      v
Generate Study Guide
      |
      v
Final Result
```

Setiap tahap akan dicatat sebagai `JobStep`, termasuk:

- nama dan urutan tahap;
- status eksekusi;
- input/output yang sudah disanitasi;
- waktu mulai dan selesai;
- durasi pemrosesan;
- error jika tahap gagal.

Hasil akhirnya disimpan di `Job.result`, terpisah dari log observability di `JobStep`.

## Lifecycle Job

```text
PENDING -> QUEUED -> PROCESSING -> COMPLETED
                              \-> FAILED
```

- `PENDING`: record database sudah dibuat, tetapi enqueue belum selesai.
- `QUEUED`: job berhasil masuk ke BullMQ.
- `PROCESSING`: worker sedang menjalankan pipeline.
- `COMPLETED`: hasil akhir sudah tersimpan di PostgreSQL.
- `FAILED`: enqueue atau eksekusi pipeline gagal dan error telah disimpan.

## Target API

Endpoint berikut adalah kontrak target dan **belum tersedia pada bootstrap saat ini**.

| Method | Endpoint | Fungsi | Respons utama |
| --- | --- | --- | --- |
| `POST` | `/jobs` | Validasi input, simpan job, lalu enqueue | `202 Accepted` |
| `GET` | `/jobs` | Daftar status dan hasil semua job | `200 OK` |
| `GET` | `/jobs/:id` | Detail satu job beserta hasil dan step | `200 OK` / `404 Not Found` |

Contoh request pembuatan job:

```json
{
  "topic": "Model Context Protocol",
  "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources..."
}
```

Contoh respons awal:

```json
{
  "id": "job-uuid",
  "status": "QUEUED"
}
```

## Teknologi

### Sudah terpasang

- TypeScript
- Hono
- `@hono/node-server`
- Prisma 7 + PostgreSQL adapter
- BullMQ + ioredis
- Zod
- Vitest
- tsx
- pnpm

### Direncanakan

- Anvia SDK dan model AI nyata melalui API OpenAI-compatible
- Docker Compose / Podman Compose untuk PostgreSQL dan Redis

## Prasyarat

Untuk menjalankan bootstrap saat ini:

- Node.js 20 atau lebih baru direkomendasikan;
- pnpm;
- Git.

Untuk target implementasi lengkap nantinya juga diperlukan:

- Docker dengan Docker Compose;
- credential provider AI yang kompatibel dengan OpenAI API.

## Instalasi

Dari root project:

```bash
pnpm install
```

Jika pnpm belum tersedia tetapi Corepack sudah terpasang bersama Node.js:

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

## Konfigurasi Environment

Salin template environment:

```bash
cp .env.example .env
```

Isi konfigurasi provider AI:

```env
LLM_MODEL=
OPENAI_API_KEY=
OPENAI_API_BASE_URL=
```

Keterangan:

- `LLM_MODEL`: nama model yang tersedia pada akun/provider.
- `OPENAI_API_KEY`: credential provider; jangan commit file `.env`.
- `OPENAI_API_BASE_URL`: base URL endpoint OpenAI-compatible.

`src/server.ts` and `src/worker.ts` read the runtime settings through the validated environment parser. The AI variables remain optional until the AI integration phase.

## Menjalankan Project Saat Ini

Start the local infrastructure before running the API or worker:

```bash
podman compose up -d
# or: docker compose up -d
```

Apply the Prisma schema:

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

### Development mode

```bash
pnpm dev
```

Server berjalan di:

```text
http://localhost:3000
```

Verifikasi:

```bash
curl http://localhost:3000/
```

Output saat ini:

```text
Hello Hono!
```

### Production-style build

Build TypeScript:

```bash
pnpm build
```

Jalankan output JavaScript:

```bash
pnpm start
```

Lalu buka atau panggil:

```bash
curl http://localhost:3000/
```

## Cara Menjalankan Target Sistem Lengkap

Bagian ini menggambarkan workflow akhir setelah fase infrastructure, API job, worker, database, dan AI integration selesai. Command tersebut belum seluruhnya tersedia di `package.json` saat ini.

1. Jalankan PostgreSQL dan Redis:

   ```bash
   docker compose up -d
   ```

2. Generate Prisma Client dan jalankan migration:

   ```bash
   pnpm prisma:generate
   pnpm prisma:migrate
   ```

3. Jalankan API:

   ```bash
   pnpm dev:api
   ```

4. Di terminal terpisah, jalankan worker:

   ```bash
   pnpm dev:worker
   ```

5. Buat job:

   ```bash
   curl -X POST http://localhost:3000/jobs \
     -H 'Content-Type: application/json' \
     -d '{
       "topic": "Model Context Protocol",
       "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources. It defines consistent boundaries between AI applications, tools, and external data."
     }'
   ```

6. Gunakan `id` dari respons untuk memeriksa proses dan hasil:

   ```bash
   curl http://localhost:3000/jobs/<job-id>
   ```

## Target Struktur Project

```text
src/
├── app.ts
├── server.ts
├── worker.ts
├── config/
│   ├── env.ts
│   ├── prisma.ts
│   └── redis.ts
├── modules/jobs/
│   ├── job.route.ts
│   ├── job.schema.ts
│   ├── job.service.ts
│   ├── job.repository.ts
│   └── job.types.ts
├── queue/
│   ├── job.queue.ts
│   └── job.worker.ts
├── pipeline/
│   ├── study-guide.pipeline.ts
│   ├── execute-step.ts
│   └── steps/
│       ├── analyze-material.step.ts
│       ├── extract-concepts.step.ts
│       └── generate-study-guide.step.ts
├── ai/
│   ├── client.ts
│   ├── prompts.ts
│   └── schemas.ts
└── shared/

prisma/
├── schema.prisma
└── migrations/
```

## Roadmap Implementasi

1. Bootstrap Hono dan health endpoint.
2. PostgreSQL, Redis, Prisma, dan BullMQ.
3. Schema `Job` dan `JobStep` beserta migration.
4. `POST /jobs` dan enqueue flow.
5. Background worker dengan processor deterministik sementara.
6. Integrasi model AI nyata dan structured output.
7. Persistensi serta sanitasi pipeline step logs.
8. `GET /jobs` dan `GET /jobs/:id`.
9. Failure handling, retry, dan idempotency.
10. Unit, integration, end-to-end, dan restart-persistence test.

Rencana detail, acceptance criteria, kontrak data, serta strategi pengujian tersedia pada dokumen project plan di folder `docs` selama pengembangan lokal.

## Status Implementasi

| Area | Status |
| --- | --- |
| Hono bootstrap server | Tersedia |
| Root endpoint `GET /` | Tersedia |
| Health endpoint `GET /health` | Tersedia |
| PostgreSQL / Prisma | Tersedia: schema, migration, client factory |
| Redis / BullMQ | Tersedia: queue configuration and retry defaults |
| Background worker | Tersedia: infrastructure smoke processor |
| Job API | Belum diimplementasikan |
| Sequential AI pipeline | Belum diimplementasikan |
| Job dan step persistence | Tersedia: Prisma schema and migration |
| Automated tests | Tersedia: unit tests; infrastructure smoke-verified locally |

Status ini sengaja membedakan dokumentasi arsitektur target dari fitur yang benar-benar sudah dapat dijalankan.
