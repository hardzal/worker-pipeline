# AI Pipeline Agent

Pipeline Agent asinkron berbasis TypeScript. Client mengirim input melalui HTTP atau CLI, lalu worker memprosesnya menjadi study guide menggunakan pipeline AI tiga tahap.

## Fitur

- `POST /job` untuk membuat job secara asynchronous.
- CLI dengan use case yang sama seperti HTTP.
- PostgreSQL sebagai source of truth untuk job, status, hasil, error, dan step log.
- BullMQ + Redis untuk antrean, retry, dan backoff.
- Worker terpisah dengan pipeline berurutan:
  `Analyze Material` → `Extract Concepts` → `Generate Study Guide`.
- `GET /jobs` dan `GET /jobs/:id` untuk melihat status, hasil, dan step.
- Timeout AI, failure handling, retry exhaustion handling, dan idempotensi job selesai.

Redis hanya digunakan sebagai backend antrean. Data bisnis tetap disimpan di PostgreSQL.

## Arsitektur Singkat

```text
HTTP / CLI
    |
    v
Pipeline Agent
    |
    +--> PostgreSQL: simpan Job (PENDING)
    |
    +--> BullMQ / Redis: enqueue { jobId }
                              |
                              v
                         Background Worker
                              |
                              +--> baca input dari PostgreSQL
                              +--> jalankan tiga tahap AI
                              +--> simpan status, result, error, dan JobStep
```

Lifecycle job:

```text
PENDING -> QUEUED -> PROCESSING -> COMPLETED
                              \-> FAILED
```

## Prasyarat

- Node.js 20+
- pnpm
- Podman Compose atau Docker Compose
- PostgreSQL dan Redis lokal (dapat dijalankan melalui `docker-compose.yml`)
- Credential provider AI yang kompatibel dengan OpenAI API untuk menjalankan worker

## Setup

Install dependency dan salin konfigurasi environment:

```bash
pnpm install
cp .env.example .env
```

Sesuaikan `.env`, terutama koneksi database dan konfigurasi AI:

```env
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:55433/ai_pipeline
LLM_MODEL=<model-id>
OPENAI_API_KEY=<api-key>
OPENAI_API_BASE_URL=<openai-compatible-base-url>
```

Jalankan dependency:

```bash
podman compose up -d
# atau: docker compose up -d
```

Generate Prisma contract dan verifikasi database:

```bash
pnpm run prisma:contract:emit
pnpm run prisma:db:verify
```

## Menjalankan API dan Worker

Terminal pertama — API:

```bash
pnpm run dev:api
```

Alias yang tersedia:

```bash
pnpm run dev
```

Terminal kedua — worker:

```bash
pnpm run dev:worker
```

API berjalan di `http://localhost:3000` secara default. API dapat berjalan tanpa konfigurasi AI, tetapi worker akan gagal start jika `LLM_MODEL`, `OPENAI_API_KEY`, atau `OPENAI_API_BASE_URL` belum diisi.

## Menggunakan API

Cek health:

```bash
curl http://localhost:3000/health
```

Buat job:

```bash
curl -X POST http://localhost:3000/job \
  -H 'Content-Type: application/json' \
  -d '{
    "topic": "Model Context Protocol",
    "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources."
  }'
```

Respons awal:

```json
{
  "id": "job-uuid",
  "status": "QUEUED"
}
```

Gunakan `id` tersebut untuk memeriksa job:

```bash
curl http://localhost:3000/jobs
curl http://localhost:3000/jobs/<job-id>
```

Endpoint yang tersedia:

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| `GET` | `/` | Informasi dasar aplikasi |
| `GET` | `/health` | Health check |
| `POST` | `/job` | Membuat job; mengembalikan `202 Accepted` |
| `GET` | `/jobs` | Daftar job |
| `GET` | `/jobs/:id` | Detail job, result, dan step; `404` jika tidak ditemukan |

## Menggunakan CLI

CLI menggunakan Pipeline Agent yang sama dengan endpoint HTTP:

```bash
pnpm run pipeline -- \
  --topic "Model Context Protocol" \
  --content "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources."
```

Alternatif input JSON:

```bash
pnpm run pipeline -- \
  --json '{"topic":"Model Context Protocol","content":"MCP is an open protocol that standardizes how AI applications connect to external tools and data sources."}'
```

Output CLI berupa acknowledgement job, misalnya `{ "id": "...", "status": "QUEUED" }`. Result akhir dibaca melalui endpoint query.

## Prisma 8

Contract aktif berada di `prisma/schema.prisma`. Artifact runtime dibuat di `generated/prisma/` oleh command `prisma:contract:emit`; folder `generated/` dapat dibuat ulang dan di-ignore oleh Git.

Untuk perubahan contract rutin:

```bash
# Edit prisma/schema.prisma
pnpm exec prisma contract format
pnpm run prisma:contract:emit
pnpm run prisma:migration:plan -- --name add_feature
pnpm run prisma:db:migrate
```

`prisma:contract:infer` hanya digunakan untuk reverse-engineering database secara sengaja karena command tersebut dapat menulis ulang contract source. Jangan menjadikannya lifecycle hook rutin.

Migration graph aktif di `prisma/migrations/`, sedangkan history legacy berada di `prisma/legacy/migrations/`; keduanya harus tetap tracked.

## Testing dan Build

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

Restart-persistence integration test membutuhkan PostgreSQL yang sedang berjalan:

```bash
RUN_INTEGRATION_TESTS=1 pnpm exec vitest run tests/integration/restart-persistence.test.ts
```

Lifecycle hook pnpm akan menjalankan `prisma:contract:emit` otomatis sebelum `test`, `typecheck`, dan `build`.

## Struktur Utama

```text
src/
├── app.ts, server.ts, worker.ts
├── cli/                    # CLI submission
├── modules/jobs/           # service, repository, query, route
├── modules/pipeline/       # public Pipeline Agent dan route
├── pipeline/               # study-guide pipeline dan step logger
├── ai/                     # provider adapter, prompt, schema
├── queue/                  # BullMQ queue dan worker
└── config/                 # environment, Prisma, Redis

prisma/
├── schema.prisma           # active Prisma 8 contract
├── migrations/              # active migration graph
└── legacy/                  # legacy schema dan migration history
```
