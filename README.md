# AI Pipeline Agent

Pipeline Agent asinkron berbasis TypeScript. Client dapat mengirim input melalui HTTP atau CLI; Pipeline Agent meneruskan command secara internal ke JobService untuk pencatatan durable dan enqueue BullMQ, lalu background worker menjalankan pipeline AI.

> Status project: **Pipeline Agent submission foundation**. Hono `POST /job`, CLI submission, PostgreSQL, Redis, BullMQ, Prisma, dan initial schema tersedia. Job query endpoints, worker persistence, dan real AI pipeline masih menjadi fase berikutnya.

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
Client / CLI
  |
  | HTTP POST /job atau CLI command
  v
Pipeline Agent
  |-- validasi input
  |-- panggil internal JobService
  v
JobService
  |-- simpan Job (PENDING) ke PostgreSQL
  |-- enqueue { jobId } ke BullMQ / Redis
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
| Pipeline Agent | HTTP/CLI input, validasi request, dan orchestration submission |
| JobService | Internal persistence job dan enqueue BullMQ; tidak menjadi public input API |
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

## Target Pipeline Agent Interfaces

`POST /job` sudah tersedia sebagai public Pipeline Agent boundary. Endpoint query job masih menjadi fase berikutnya.

| Method | Endpoint | Fungsi | Respons utama |
| --- | --- | --- | --- |
| `POST` | `/job` | Pipeline Agent menerima input lalu mendelegasikan ke internal JobService | `202 Accepted` |
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

Emit the Prisma 8 contract and verify the existing database:

```bash
pnpm prisma:contract:emit
pnpm prisma:db:verify
```

The existing database was adopted with Prisma 8's contract marker. Do not run
`db sign` on every startup; use it only when intentionally adopting a schema
that has already been verified outside Prisma 8. For a contract change, plan
and apply a reviewed migration:

```bash
pnpm prisma:migration:plan -- --name add_feature
pnpm prisma:db:migrate
```

### Workflow Contract Prisma 8 dan lifecycle hook

Source of truth untuk contract aktif adalah `prisma/schema.prisma`. Artifact
runtime berikutnya dibuat di `generated/prisma/`, dan folder tersebut di-ignore
Git karena dapat dibuat ulang:

```text
prisma/schema.prisma              # source contract yang dikurasi
generated/prisma/contract.json    # artifact runtime
generated/prisma/contract.d.ts    # type declaration hasil generate
```

Gunakan command berikut sesuai arah datanya:

| Command | Alur | Kapan digunakan |
| --- | --- | --- |
| `pnpm run prisma:contract:infer` | database existing → `prisma/schema.prisma` | Bootstrap atau reverse-engineering database secara sengaja. Command ini dapat menulis ulang source contract, jadi bukan command rutin build. |
| `pnpm exec prisma contract format` | merapikan `prisma/schema.prisma` | Setelah mengedit Contract DSL Prisma 8. |
| `pnpm run prisma:contract:emit` | `prisma/schema.prisma` → `generated/prisma/*` | Menghasilkan artifact yang dipakai runtime, test, typecheck, dan build. |

Contoh bootstrap database existing:

```bash
pnpm run prisma:contract:infer
pnpm exec prisma contract format
pnpm run prisma:contract:emit
pnpm run prisma:db:verify
```

Untuk perubahan rutin pada contract:

```bash
# Edit prisma/schema.prisma terlebih dahulu.
pnpm exec prisma contract format
pnpm run prisma:contract:emit
pnpm run prisma:migration:plan -- --name add_feature
pnpm run prisma:db:migrate
```

`prebuild`, `pretypecheck`, dan `pretest` adalah lifecycle hook pnpm. Ketiganya
memanggil command emit yang sama, tetapi masing-masing hanya berjalan sebelum
target yang namanya sesuai:

```text
pnpm run build
└── prebuild → prisma:contract:emit → tsc

pnpm run typecheck
└── pretypecheck → prisma:contract:emit → tsc --noEmit

pnpm run test
└── pretest → prisma:contract:emit → vitest run
```

Hook tersebut tidak menjalankan `infer` dan tidak berjalan bertiga setiap kali.
Tujuannya agar `build`, `typecheck`, dan `test` tetap dapat dijalankan secara
mandiri meskipun folder `generated/` belum tersedia pada checkout atau CI baru.
Jangan memasukkan `prisma:contract:infer` ke lifecycle hook karena build akan
menjadi bergantung pada database dan dapat menimpa contract source yang sudah
dikurasi.

### Git policy untuk artifact Prisma

- `generated/` berisi hasil `prisma contract emit`, sehingga di-ignore dan
  dibuat ulang otomatis sebelum `test`, `typecheck`, dan `build`.
- `prisma/migrations/` berisi migration graph Prisma 8 (`baseline`, ref, dan
  metadata hash), sehingga harus tetap tracked sebagai source-of-truth
  deployment.
- `prisma/legacy/migrations/` adalah history migration SQL legacy dan juga
  harus tetap tracked.

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

```json
{"name":"AI Pipeline Job Processing API","status":"bootstrap"}
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

Bagian ini menggambarkan workflow pengembangan saat ini. `POST /job` dan CLI submission sudah tersedia; endpoint query dan worker persistence akan ditambahkan pada fase berikutnya.

1. Jalankan PostgreSQL dan Redis:

   ```bash
   docker compose up -d
   ```

2. Emit contract Prisma 8 dan cek status database:

   ```bash
   pnpm prisma:contract:emit
   pnpm prisma:db:verify
   ```

3. Jalankan API:

   ```bash
   pnpm dev:api
   ```

4. Di terminal terpisah, jalankan worker:

   ```bash
   pnpm dev:worker
   ```

5. Kirim input ke Pipeline Agent melalui HTTP:

   ```bash
   curl -X POST http://localhost:3000/job \
     -H 'Content-Type: application/json' \
     -d '{
       "topic": "Model Context Protocol",
       "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources. It defines consistent boundaries between AI applications, tools, and external data."
     }'
   ```

6. Alternatifnya, gunakan CLI dengan use case Pipeline Agent yang sama:

   ```bash
   pnpm pipeline -- --topic "Model Context Protocol" --content "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources. It defines consistent boundaries between AI applications, tools, and external data."
   ```

7. Gunakan `id` dari respons untuk memeriksa proses dan hasil:

   ```bash
   curl http://localhost:3000/jobs/<job-id>
   ```

## Target Struktur Project

```text
src/
├── app.ts
├── server.ts
├── worker.ts
├── cli/
│   ├── index.ts
│   └── args.ts
├── config/
│   ├── env.ts
│   ├── prisma.ts
│   └── redis.ts
├── modules/jobs/
│   ├── job.service.ts
│   ├── job.repository.ts
│   └── job.types.ts
├── modules/pipeline/
│   ├── pipeline.agent.ts
│   ├── pipeline.route.ts
│   └── pipeline.schema.ts
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
├── schema.prisma          # active Prisma 8 contract
├── migrations/             # active Prisma 8 migration graph
├── legacy/
│   ├── schema.prisma      # legacy Prisma 7 source
│   └── migrations/        # legacy migration history

generated/prisma/
├── contract.json
└── contract.d.ts
```

## Roadmap Implementasi

1. Bootstrap Hono dan health endpoint.
2. PostgreSQL, Redis, Prisma, dan BullMQ.
3. Schema `Job` dan `JobStep` beserta migration.
4. Pipeline Agent HTTP/CLI input dan internal JobService enqueue flow.
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
| PostgreSQL / Prisma 8 | Tersedia: contract, marker, runtime client factory |
| Redis / BullMQ | Tersedia: queue configuration and retry defaults |
| Background worker | Tersedia: infrastructure smoke processor |
| Pipeline Agent `POST /job` | Tersedia: validation, internal delegation, persistence, enqueue |
| Pipeline Agent CLI | Tersedia: flags/JSON input, shared use case, JSON output |
| Job API `GET /jobs*` | Belum diimplementasikan |
| Sequential AI pipeline | Belum diimplementasikan |
| Job dan step persistence | Tersedia: Prisma 8 contract and legacy migration history |
| Automated tests | Tersedia: unit tests; infrastructure smoke-verified locally |

Status ini sengaja membedakan dokumentasi arsitektur target dari fitur yang benar-benar sudah dapat dijalankan.
