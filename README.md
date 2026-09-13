# AI Pipeline Job Processing API — README V2

API pemrosesan AI asinkron berbasis TypeScript untuk menghasilkan Study Guide dari materi yang dikirim Client. API menerima submission secara idempotent, PostgreSQL menyimpan state durable, BullMQ menjadwalkan pekerjaan melalui Redis, dan background worker menjalankan sequential AI pipeline dengan checkpoint yang dapat dilanjutkan setelah retry atau restart.

> [!IMPORTANT]
> Repository ini masih berada pada fase **bootstrap**. Saat ini yang benar-benar tersedia hanya server Hono sederhana dengan `GET /` yang mengembalikan `Hello Hono!` pada port hard-coded `3000`. PostgreSQL, Prisma, Redis, BullMQ, Job API, worker, reconciler, AI pipeline, dan automated tests yang dijelaskan sebagai target di README ini belum diimplementasikan.

README V2 menjelaskan dua hal secara terpisah:

1. **Current bootstrap** — fitur dan command yang dapat dijalankan sekarang.
2. **Target MVP V2** — arsitektur dan kontrak yang akan dibangun berdasarkan Project Plan V2.

## Daftar Isi

- [Tujuan Project](#tujuan-project)
- [Status Implementasi](#status-implementasi)
- [Gambaran Besar Arsitektur](#gambaran-besar-arsitektur)
- [Prinsip Desain Utama](#prinsip-desain-utama)
- [Pipeline Study Guide](#pipeline-study-guide)
- [Lifecycle Job](#lifecycle-job)
- [Target API](#target-api)
- [Instalasi Bootstrap Saat Ini](#instalasi-bootstrap-saat-ini)
- [Menjalankan Bootstrap Saat Ini](#menjalankan-bootstrap-saat-ini)
- [Menjalankan Target MVP V2](#menjalankan-target-mvp-v2)
- [Konfigurasi Environment Target](#konfigurasi-environment-target)
- [Reliability Model](#reliability-model)
- [Persistensi dan Keamanan Data](#persistensi-dan-keamanan-data)
- [Strategi Testing](#strategi-testing)
- [Roadmap](#roadmap)
- [Dokumentasi Desain](#dokumentasi-desain)

## Tujuan Project

Project ini mendemonstrasikan cara membangun background AI pipeline yang tidak bergantung pada satu HTTP request panjang.

Client mengirim Requested Topic dan Source Material. API menyimpan Job secara durable sebelum mencoba menjadwalkannya. Worker kemudian menjalankan tiga stage AI secara berurutan dan menyimpan checkpoint setiap stage. Client dapat melakukan polling terhadap state serta mengambil hasil ketika Job selesai.

Target sistem harus:

- menerima submission secara idempotent;
- tetap memiliki Job walaupun Redis sedang tidak tersedia;
- memulihkan non-terminal Job ketika queue state hilang;
- menjalankan pipeline dengan guarantee at-least-once;
- melanjutkan retry dari checkpoint valid terakhir;
- mencegah stale worker menimpa state terbaru;
- menyimpan Study Guide, warning, dan failure secara aman;
- menyediakan polling API yang bounded;
- memakai model AI nyata pada live runtime;
- tetap dapat diuji secara deterministic tanpa model call berbayar.

### Batas MVP

MVP dirancang sebagai trusted single-tenant service untuk mesin atau jaringan internal.

Belum termasuk:

- authentication dan authorization publik;
- multi-tenancy atau Job ownership;
- public internet deployment;
- chunking/map-reduce untuk materi besar;
- attempt history;
- exactly-once model execution atau billing;
- cancellation;
- Server-Sent Events;
- evaluator/improve loop;
- automated LLM-as-judge;
- multiple Job kinds.

Jangan mengekspos target MVP langsung ke internet. Public deployment membutuhkan milestone keamanan terpisah untuk identity, authorization, rate limiting, abuse control, dan owner isolation.

## Status Implementasi

Status berikut menggambarkan repository saat README V2 dibuat, bukan target akhirnya.

| Area | Status sekarang | Target V2 |
| --- | --- | --- |
| TypeScript + Hono bootstrap | Tersedia | Dipertahankan |
| `GET /` | Tersedia | Dapat dipertahankan sebagai bootstrap/demo |
| Configurable host/port | Belum tersedia | `HOST=127.0.0.1`, `PORT=3000` |
| Liveness/readiness endpoints | Belum tersedia | `/health/live`, `/health/ready` |
| PostgreSQL + Prisma | Belum tersedia | Durable source of truth |
| Redis + BullMQ | Belum tersedia | Scheduler/execution queue |
| Idempotent Job API | Belum tersedia | Required `Idempotency-Key` |
| Background worker | Belum tersedia | Process terpisah dari API |
| Recoverable-job reconciler | Belum tersedia | Berjalan di worker process |
| Processing lease/fencing | Belum tersedia | Database-backed lease |
| Three-stage AI pipeline | Belum tersedia | Analyze → Extract → Generate |
| Checkpoint resume | Belum tersedia | Resume dari checkpoint valid |
| Real model integration | Belum tersedia | Anvia + OpenAI-compatible provider |
| Retention cleanup | Belum tersedia | Default 30 hari |
| Automated tests | Belum tersedia | Unit, integration, E2E, live smoke |
| Docker infrastructure | Belum tersedia | PostgreSQL + Redis dengan persistence |

`docker-compose.yml` masih kosong. Command Docker, Prisma, API V2, worker, cleanup, dan testing pada bagian target belum dapat dijalankan sampai milestone terkait selesai.

## Gambaran Besar Arsitektur

```text
Trusted Client
      |
      | POST /jobs
      | Idempotency-Key: <client-generated-key>
      v
+-------------------------+
| Hono API                |
| - validate request      |
| - persist Job=PENDING   |
| - attempt dispatch      |
+------------+------------+
             |
             v
+-------------------------+
| PostgreSQL              |
| Durable source of truth |
| - Job lifecycle         |
| - Source Material       |
| - checkpoints           |
| - Study Guide           |
| - warning/failure       |
+------------+------------+
             |
             | enqueue { jobId }
             v
+-------------------------+
| BullMQ + Redis          |
| Scheduling/execution    |
+------------+------------+
             |
             v
+-------------------------+
| Worker Process          |
| - reconciler            |
| - queue consumer        |
| - lease + heartbeat     |
| - checkpoint resume     |
+------------+------------+
             |
             v
+-------------------------+
| Sequential AI Pipeline  |
| Analyze -> Extract      |
|         -> Generate     |
+------------+------------+
             |
             | persist checkpoint/result
             v
+-------------------------+
| PostgreSQL              |
+------------+------------+
             |
             v
GET /jobs
GET /jobs/:id
```

### Tanggung jawab komponen

| Komponen | Tanggung jawab target |
| --- | --- |
| Hono API | HTTP parsing, validation, idempotent submission, immediate dispatch, polling API, dan health endpoints |
| PostgreSQL | Durable Job state, canonical input, checkpoint, result, warning, failure, lease, dan retention metadata |
| Prisma | Typed data access, transaction, constraint, index, dan migration PostgreSQL |
| BullMQ | Menjadwalkan delivery, delayed retry, backoff, dan distribusi kerja |
| Redis | Backend BullMQ; bukan permanent result database |
| Worker | Reconciliation, lease management, pipeline orchestration, retry classification, dan final persistence |
| Anvia/provider adapter | Real model calls dan structured model output |
| Cleanup command | Menghapus aggregate Terminal Job setelah retention window |

Queue hanya membawa payload kecil:

```json
{
  "jobId": "database-job-id"
}
```

Database `Job.id` juga menjadi BullMQ `jobId`. Source Material tidak disalin ke Redis dan tidak diduplikasi di setiap Job Step.

## Prinsip Desain Utama

### PostgreSQL adalah durable source of truth

API menerima ownership atas Job hanya setelah record PostgreSQL berhasil dibuat. Redis boleh kehilangan queue state karena active Job harus dapat direkonstruksi dari PostgreSQL.

Jika PostgreSQL tidak tersedia, submission ditolak dengan `503`. Jika PostgreSQL tersedia tetapi Redis tidak tersedia, Job tetap diterima sebagai `PENDING` dan dipulihkan oleh reconciler setelah Redis kembali sehat.

### BullMQ menjadwalkan pekerjaan

BullMQ menentukan kapan dan worker mana yang memproses Job, tetapi tidak menjadi sumber permanen untuk input atau hasil.

Dispatch retry dan processing retry memiliki budget terpisah:

- dispatch retry menangani kegagalan memasukkan Job ke queue;
- processing retry menangani kegagalan pipeline setelah worker mulai bekerja.

### At-least-once, bukan exactly-once

Checkpoint dan database write dirancang idempotent. Namun, model call dapat terulang jika worker mati setelah provider menerima request tetapi sebelum output tersimpan.

Target sistem tidak mengklaim:

- exactly-once model execution;
- exactly-once provider billing;
- attempt history;
- total active compute duration lintas retry.

### Checkpoint, bukan attempt log

Satu `JobStep` menyimpan checkpoint canonical terbaru untuk satu stage. Riwayat setiap attempt tidak disimpan pada MVP.

Saat retry, worker:

1. memvalidasi checkpoint terhadap pinned Pipeline Version;
2. menggunakan kembali completed checkpoint yang valid;
3. memulai dari stage pertama yang incomplete atau failed;
4. menjalankan ulang stage tersebut dan seluruh downstream stage.

### Pipeline Version, Model Assignment, dan Result Schema Version dipisahkan

Setiap Job mem-pin:

- `pipelineVersion`, misalnya `study-guide.pipeline.v1`;
- `modelId`, berasal dari `LLM_MODEL` saat Job dibuat;
- `resultSchemaVersion`, misalnya `study-guide.v1`.

Perubahan model default setelah submission tidak mengubah Model Assignment Job lama. Worker tidak melakukan silent model substitution.

API decoder harus membaca `resultSchemaVersion` yang tersimpan. Breaking change pada bentuk Study Guide menghasilkan Result Schema Version baru; persisted JSON lama tidak boleh diam-diam ditafsirkan menggunakan schema terbaru.

## Pipeline Study Guide

Use case utama adalah Study Guide Generator dengan pola sequential pipeline atau prompt chaining:

```text
Requested Topic + Source Material
                |
                v
       1. Analyze Material
                |
                v
      2. Extract Key Concepts
                |
                v
      3. Generate Study Guide
                |
                v
       Versioned Study Guide
```

### Stage 1 — Analyze Material

Menganalisis Source Material untuk menghasilkan:

- Detected Subject;
- Source Difficulty: `beginner`, `intermediate`, atau `advanced`;
- Source Language;
- kecocokan Requested Topic dengan Source Material;
- learning objectives;
- important sections;
- Quality Warnings.

Requested Topic hanya memberi konteks intent. Jika Requested Topic bertentangan dengan materi, pipeline mengikuti Detected Subject dan menambahkan `TOPIC_CONTENT_MISMATCH`.

Study Guide mengikuti Source Difficulty dan dominant Source Language yang diinfer. Materi multibahasa menghasilkan `MIXED_SOURCE_LANGUAGE`; materi yang tidak cukup kaya untuk hasil berguna dapat menghasilkan `LIMITED_SOURCE_MATERIAL`.

### Stage 2 — Extract Key Concepts

Mengekstrak konsep penting dalam bentuk canonical:

```json
{
  "name": "MCP Server",
  "definition": "A component that exposes capabilities.",
  "importance": "It connects AI applications to tools and data."
}
```

Field canonical adalah `name`, `definition`, dan `importance`. Field alternatif `description` tidak digunakan.

### Stage 3 — Generate Study Guide

Menghasilkan Study Guide tervalidasi:

```json
{
  "schemaVersion": "study-guide.v1",
  "title": "Model Context Protocol Study Guide",
  "summary": "...",
  "detectedSubject": "Model Context Protocol",
  "sourceDifficulty": "beginner",
  "sourceLanguage": "en",
  "keyConcepts": [],
  "questions": [],
  "limitations": [],
  "warnings": []
}
```

### Grounding policy

Source Material adalah satu-satunya sumber fakta. Model boleh meringkas, menyusun ulang, menjelaskan, dan membuat Q&A dari materi, tetapi tidak boleh memperkenalkan factual claim eksternal.

Grounding ditegakkan melalui prompt policy dan evaluasi manusia. Structured schema membuktikan bentuk data, bukan membuktikan bahwa output benar-benar grounded.

Empty `keyConcepts` atau `questions` tetap dapat menghasilkan `COMPLETED` selama schema valid, tetapi Job menerima Quality Warning seperti `NO_KEY_CONCEPTS` atau `NO_QUESTIONS`.

Minimum stable Quality Warning codes:

- `TOPIC_CONTENT_MISMATCH`;
- `MIXED_SOURCE_LANGUAGE`;
- `LIMITED_SOURCE_MATERIAL`;
- `NO_KEY_CONCEPTS`;
- `NO_QUESTIONS`.

## Lifecycle Job

```text
PENDING --dispatch--> QUEUED --lease acquired--> PROCESSING --success--> COMPLETED
   |                                                 |
   | dispatch expiry                                 | retryable failure
   v                                                 v
 FAILED                         PROCESSING <--due-- RETRYING
                                   |
                                   | non-retryable / attempts exhausted
                                   v
                                 FAILED
```

| Status | Arti |
| --- | --- |
| `PENDING` | Job sudah durable, tetapi dispatch ke BullMQ belum berhasil |
| `QUEUED` | BullMQ Job sudah dibuat dan menunggu worker |
| `PROCESSING` | Worker memiliki processing lease dan sedang menjalankan/resume pipeline |
| `RETRYING` | Latest processing attempt gagal secara transient dan retry masih dijadwalkan |
| `COMPLETED` | Seluruh stage selesai dan Study Guide lolos structured schema |
| `FAILED` | Terminal failure; tidak ada automatic processing retry tersisa |

`COMPLETED` tidak berarti human-approved atau quality-perfect. `FAILED` hanya digunakan untuk kegagalan final, bukan ketika retry masih tersedia.

Semua transition target menggunakan guarded update atau compare-and-set. Stale event menjadi no-op dan Terminal Job tidak boleh kembali ke state aktif.

## Target API

> [!WARNING]
> Endpoint di bagian ini adalah kontrak target V2 dan belum tersedia pada bootstrap sekarang. Endpoint yang tersedia saat ini hanya `GET /`.

### Ringkasan endpoint

| Method | Endpoint | Fungsi target |
| --- | --- | --- |
| `POST` | `/jobs` | Idempotent submission dan immediate dispatch attempt |
| `GET` | `/jobs` | Cursor-paginated Job Summary |
| `GET` | `/jobs/:id` | Lean Job Detail dengan optional projections |
| `GET` | `/health/live` | API process liveness |
| `GET` | `/health/ready` | Dependency-aware API readiness |

### Membuat Job

`POST /jobs` wajib membawa `Idempotency-Key`:

```bash
curl -X POST http://127.0.0.1:3000/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: study-guide-mcp-001' \
  -d '{
    "topic": "Model Context Protocol",
    "content": "MCP is an open protocol that standardizes how AI applications connect to tools and data sources. It defines consistent boundaries between AI applications, tools, and external data."
  }'
```

Validation target:

- `topic`: 3–200 karakter setelah trim;
- `content`: minimum 50 karakter setelah trim;
- maksimum `MAX_SOURCE_CHARS`, default target 20.000;
- unknown fields ditolak;
- idempotency key di-trim, non-empty, printable, dan maksimum 255 karakter;
- idempotency key tidak boleh mengandung credential atau data pribadi.

New Job dengan dispatch sukses:

```http
HTTP/1.1 202 Accepted
Location: /jobs/<id>
```

```json
{
  "id": "job-uuid",
  "status": "QUEUED"
}
```

Jika Redis unavailable tetapi Job sudah tersimpan:

```http
HTTP/1.1 202 Accepted
Location: /jobs/<id>
```

```json
{
  "id": "job-uuid",
  "status": "PENDING"
}
```

Idempotency outcomes:

| Kondisi | Respons target |
| --- | --- |
| Key baru + request valid | `202 Accepted` |
| Key sama + canonical payload sama | `200 OK` + `Idempotency-Replayed: true` + `Location` |
| Key sama + payload berbeda | `409 Conflict` |
| Missing key atau invalid input | `400 Bad Request` |
| Content terlalu besar | `413 Payload Too Large` |
| PostgreSQL tidak tersedia | `503 Service Unavailable` |

MVP tidak memiliki `POST /jobs/:id/retry`. Intent baru setelah final failure menggunakan idempotency key baru dan menghasilkan Job baru.

Replay mengembalikan current lean Job Detail dan `Location: /jobs/<id>`, bukan initial response lama yang mungkin sudah stale.

### Daftar Job

```bash
curl 'http://127.0.0.1:3000/jobs?limit=20&status=COMPLETED'
```

Pagination target:

- default `limit=20`;
- maksimum `limit=100`;
- stable order `createdAt DESC, id DESC`;
- optional exact status filter;
- opaque cursor untuk halaman berikutnya;
- invalid cursor atau invalid status menghasilkan `400`;
- tidak menjalankan unbounded total count secara default.

Response hanya berisi Job Summary:

```json
{
  "items": [
    {
      "id": "job-uuid",
      "status": "COMPLETED",
      "title": "Model Context Protocol Study Guide",
      "summary": "A concise persisted result summary.",
      "warningCodes": [],
      "createdAt": "2026-09-13T10:00:00.000Z",
      "terminalAt": "2026-09-13T10:01:10.000Z"
    }
  ],
  "nextCursor": null
}
```

Source Material, full Study Guide, dan Job Steps tidak dimuat oleh list endpoint.

### Detail dan polling Job

Lean detail:

```bash
JOB_ID='replace-with-job-id'
curl "http://127.0.0.1:3000/jobs/$JOB_ID"
```

Heavy fields harus diminta secara eksplisit:

```bash
JOB_ID='replace-with-job-id'
curl "http://127.0.0.1:3000/jobs/$JOB_ID?include=result,steps,source"
```

Allowed projections:

- `result`;
- `steps`;
- `source`.

Unknown `include` menghasilkan `400`. Job yang tidak ditemukan atau sudah dihapus oleh retention menghasilkan `404`.

Progress bersifat factual:

- jumlah completed checkpoint;
- total stage dari pinned Pipeline Version;
- current stage jika ada;
- next retry time jika ada.

MVP tidak memberikan percentage atau estimated completion time yang spekulatif.

Polling response memakai cache policy yang mencegah intermediary menyajikan Job state stale. ETag dapat ditambahkan kemudian, tetapi bukan requirement MVP.

### Health checks

Target API liveness:

```bash
curl http://127.0.0.1:3000/health/live
```

Liveness hanya membuktikan process/event loop hidup dan tidak memanggil dependency.

Target API readiness:

```bash
curl http://127.0.0.1:3000/health/ready
```

PostgreSQL wajib sehat. Redis boleh dilaporkan `degraded` tanpa membuat API unready karena API masih dapat menerima durable `PENDING` Job. Health check tidak menjalankan model generation call.

## Instalasi Bootstrap Saat Ini

### Prasyarat

Untuk current bootstrap:

- Node.js 20 atau lebih baru;
- pnpm;
- Git;
- Bash. Pada Windows, jalankan contoh command melalui Git Bash atau WSL.

Untuk target MVP V2 nantinya juga diperlukan:

- Docker dengan Docker Compose;
- PostgreSQL dan Redis, biasanya melalui Compose;
- credential provider OpenAI-compatible;
- model identifier yang tersedia pada account/provider.

Dependency current `@hono/node-server` memerlukan Node.js 20 atau lebih baru. Repository belum mendeklarasikan `engines`, `packageManager`, atau versi pnpm yang dipin. Pin tersebut perlu ditambahkan pada milestone bootstrap/configuration agar instalasi reproducible.

### Clone dan install dependency

Dari parent directory pilihan:

```bash
git clone <repository-url> api-nodejs
cd api-nodejs
pnpm install
```

Jika repository sudah tersedia secara lokal:

```bash
cd api-nodejs
pnpm install
```

Jika pnpm belum tersedia tetapi Corepack tersedia:

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

Dependency yang benar-benar tersedia sekarang:

- `hono`;
- `@hono/node-server`;
- `typescript`;
- `tsx`;
- `@types/node`.

BullMQ, Prisma, Redis client, Zod, Vitest, dan Anvia SDK belum ada di `package.json`. Exact Anvia npm package serta versinya harus diverifikasi terhadap dokumentasi resmi saat milestone real AI integration; README ini tidak mengarang nama package yang belum dipilih.

### Environment bootstrap

Salin template jika ingin menyiapkan konfigurasi AI untuk milestone berikutnya:

```bash
cp .env.example .env
```

Template saat ini hanya berisi:

```env
LLM_MODEL=
OPENAI_API_KEY=
OPENAI_API_BASE_URL=
```

Current `src/index.ts` belum membaca `.env` dan tidak menggunakan ketiga variable tersebut. Bootstrap server tetap dapat dijalankan tanpa mengisi credential AI.

Jangan commit `.env` atau membagikan API key melalui source code, log, request body, maupun command-line argument.

Current `.gitignore` melindungi `.env` dan `.env.production`, tetapi belum semua variasi nama `.env.*`. Sebelum menyimpan secret di nama file lain seperti `.env.local` atau backup file, pastikan file tersebut benar-benar di-ignore.

## Menjalankan Bootstrap Saat Ini

### Development mode

```bash
pnpm dev
```

Server berjalan pada port hard-coded `3000`:

```text
http://localhost:3000
```

Bootstrap belum menetapkan `hostname`; bergantung pada Node.js, listener dapat menerima koneksi dari interface selain loopback. Jalankan hanya pada mesin/jaringan tepercaya sampai target `HOST=127.0.0.1` diimplementasikan.

Buka terminal kedua untuk memverifikasi endpoint yang benar-benar tersedia:

```bash
curl http://localhost:3000/
```

Expected output:

```text
Hello Hono!
```

Hentikan development server dengan `Ctrl+C`.

### Production-style local run

Build TypeScript:

```bash
pnpm build
```

Jalankan output JavaScript:

```bash
pnpm start
```

Buka terminal kedua, lalu verifikasi:

```bash
curl http://localhost:3000/
```

Expected output:

```text
Hello Hono!
```

Hentikan server dengan `Ctrl+C`.

Current scripts yang tersedia:

| Command | Fungsi sekarang |
| --- | --- |
| `pnpm dev` | Menjalankan `tsx watch src/index.ts` |
| `pnpm build` | Menjalankan TypeScript compiler |
| `pnpm start` | Menjalankan `node dist/index.js` setelah build |

Belum ada script `test`, `typecheck`, `dev:api`, `dev:worker`, `cleanup`, atau Prisma pada current `package.json`.

## Menjalankan Target MVP V2

> [!CAUTION]
> Bagian ini adalah planned operational workflow. Command berikut belum seluruhnya tersedia dan tidak boleh dianggap runnable sampai milestone terkait selesai.

Setelah infrastructure, migration, API, worker, dan scripts diimplementasikan, local workflow yang dituju adalah:

### 1. Siapkan environment

```bash
cp .env.example .env
```

Isi database, Redis, model, base URL, dan credential pada `.env`. Jangan commit file tersebut.

### 2. Jalankan PostgreSQL dan Redis

```bash
docker compose up -d
```

Target Compose menggunakan:

- PostgreSQL named volume;
- Redis AOF dan named volume;
- healthcheck;
- host port yang bind ke `127.0.0.1`;
- readiness dependency, bukan hanya container status `started`.

### 3. Generate Prisma Client dan jalankan migration

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

### 4. Jalankan API

```bash
pnpm dev:api
```

### 5. Jalankan worker pada terminal terpisah

```bash
pnpm dev:worker
```

Worker process juga menjalankan recoverable-job reconciler. API dan worker tidak digabung dalam satu process.

### 6. Periksa health

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

### 7. Submit Job

```bash
curl -X POST http://127.0.0.1:3000/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: study-guide-mcp-001' \
  -d '{
    "topic": "Model Context Protocol",
    "content": "MCP is an open protocol that standardizes how AI applications connect to tools and data sources. It defines consistent boundaries between AI applications, tools, and external data."
  }'
```

### 8. Poll Job

```bash
JOB_ID='replace-with-job-id'
curl "http://127.0.0.1:3000/jobs/$JOB_ID"
```

Ambil result dan checkpoints setelah selesai:

```bash
curl "http://127.0.0.1:3000/jobs/$JOB_ID?include=result,steps"
```

### 9. Hentikan service

Hentikan API dan worker dengan `Ctrl+C`, lalu:

```bash
docker compose down
```

Named volumes dipertahankan oleh default `docker compose down`. Jangan gunakan `docker compose down -v` jika data local perlu dipertahankan.

## Konfigurasi Environment Target

Current `.env.example` belum memuat seluruh variable di bawah ini. Tabel ini adalah target V2 untuk milestone configuration/infrastructure.

| Variable | Default target | Dipakai oleh | Fungsi |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | API/worker/cleanup | Runtime mode |
| `HOST` | `127.0.0.1` | API | Default internal-only binding |
| `PORT` | `3000` | API | HTTP port |
| `DATABASE_URL` | — | API/worker/cleanup | PostgreSQL connection string |
| `REDIS_URL` | `redis://127.0.0.1:6379` | API/worker | BullMQ Redis connection |
| `LLM_MODEL` | — | API/worker | Model Assignment default yang dipin saat submission |
| `OPENAI_API_KEY` | — | Worker | Provider credential |
| `OPENAI_API_BASE_URL` | — | Worker | OpenAI-compatible base URL |
| `MAX_SOURCE_CHARS` | `20000` | API | Preflight Source Material limit |
| `WORKER_CONCURRENCY` | `1` | Worker | Jumlah concurrent Job |
| `AI_STEP_TIMEOUT_MS` | `120000` | Worker | Timeout per model-backed stage |
| `SHUTDOWN_GRACE_MS` | `30000` | API/worker | Graceful shutdown budget |
| `RECOVERY_SCAN_INTERVAL_MS` | `30000` | Worker | Interval recovery scan |
| `DISPATCH_MAX_AGE_MS` | `86400000` | API/worker | Maximum pending dispatch age, 24 jam |
| `PROCESSING_HEARTBEAT_MS` | `30000` | Worker | Lease heartbeat interval |
| `PROCESSING_LEASE_MS` | `300000` | Worker | Processing lease duration, 5 menit |
| `JOB_RETENTION_DAYS` | `30` | Cleanup | Terminal aggregate retention |

Process-specific rules:

- API wajib memiliki PostgreSQL, non-blank `LLM_MODEL`, serta default Pipeline Version dan Result Schema Version yang dapat di-resolve saat submission; Redis boleh degraded.
- Worker wajib memiliki PostgreSQL, Redis, provider credential/base URL, pinned model yang dapat digunakan, dan valid pipeline/model registry.
- Cleanup hanya memerlukan PostgreSQL dan retention policy.
- Blank optional values diperlakukan sebagai missing.
- Error configuration boleh menyebut nama variable, tetapi tidak boleh mencetak secret value.

Missing atau invalid required process configuration menggagalkan startup/readiness process tersebut; credential provider tetap menjadi kebutuhan worker dan tidak perlu dimiliki API.

## Reliability Model

### Immediate dispatch dan recovery

Setelah Job tersimpan sebagai `PENDING`, API langsung mencoba membuat BullMQ Job.

- sukses: guarded transition ke `QUEUED`;
- gagal: tetap `PENDING`, simpan safe dispatch error, dan kembalikan `202`;
- reconciler: mencoba ulang setelah Redis pulih;
- dispatch expiry: final `FAILED` dengan `QUEUE_DISPATCH_EXPIRED` setelah default 24 jam.

Reconciler berjalan saat worker startup dan secara periodik. Reconciler menangani:

- due `PENDING` Job;
- stale `QUEUED` ketika BullMQ Job hilang;
- `RETRYING` ketika delayed queue state hilang;
- stale `PROCESSING` ketika processing lease expired;
- tidak pernah mere-enqueue Terminal Job.

Recovery scan memakai bounded batches serta database claiming/locking agar beberapa worker tidak merekonsiliasi Job yang sama secara tidak aman. Dispatch retry memakai exponential backoff dengan delay maksimum lima menit; default dispatch deadline tetap 24 jam.

### Processing lease dan fencing

Sebelum memproses Job, worker memperoleh database lease dengan opaque `leaseOwner` dan `leaseExpiresAt`.

- worker memperpanjang lease melalui heartbeat;
- checkpoint/failure/completion write harus membawa current lease owner;
- stale worker kehilangan hak menulis setelah lease berpindah;
- kehilangan lease menghentikan write dan membatalkan pekerjaan sejauh adapter mendukung;
- BullMQ stalled detection tetap dipakai, tetapi tidak menggantikan database fencing.

Lease mengurangi race condition dan stale write, tetapi bukan exactly-once guarantee.

### Retry policy

Processing retry target:

- maksimum tiga total executions: satu initial execution dan paling banyak dua retries;
- exponential backoff 1s lalu 2s sebelum kedua retry tersebut;
- retry dari first non-completed checkpoint;
- `RETRYING` selama retry masih tersedia;
- `FAILED` hanya setelah non-retryable failure atau attempts exhausted.

Contoh retryable failure:

- network error;
- provider timeout;
- HTTP `429`;
- provider `5xx`;
- transient database/Redis error;
- invalid structured model output.

Contoh non-retryable failure:

- missing/invalid worker configuration;
- provider `401`/`403`;
- pinned model unavailable;
- provider context limit exceeded;
- pipeline invariant/schema incompatibility.

Local timeout tidak menjamin provider membatalkan request atau biaya.

Final stage checkpoint dan transition Job ke `COMPLETED` dilakukan secara transactional. Jika final checkpoint sudah tersimpan tetapi completion transition belum terjadi, retry memfinalisasi Job tanpa model call ulang.

Transient failure terlihat sebagai `lastError` saat `RETRYING` dan dibersihkan jika Job akhirnya `COMPLETED`. Stable Job Failure codes minimum adalah:

- `QUEUE_DISPATCH_EXPIRED`;
- `AI_RATE_LIMITED`;
- `AI_TIMEOUT`;
- `AI_PROVIDER_UNAVAILABLE`;
- `AI_AUTHENTICATION_FAILED`;
- `AI_MODEL_UNAVAILABLE`;
- `AI_CONTEXT_LIMIT_EXCEEDED`;
- `AI_INVALID_STRUCTURED_OUTPUT`;
- `DATABASE_UNAVAILABLE`;
- `JOB_LEASE_LOST`;
- `PIPELINE_INVARIANT_VIOLATION`.

### Graceful shutdown

Target shutdown API:

1. berhenti menerima connection baru;
2. selesaikan inflight request dalam grace period;
3. tutup server, Redis client, dan Prisma.

Target shutdown worker:

1. berhenti mengambil Job baru;
2. pertahankan heartbeat selama active work;
3. tunggu active work sampai grace period;
4. tutup BullMQ, Redis, dan Prisma;
5. setelah timeout, exit dan biarkan stalled/recovery path memulihkan Job.

## Persistensi dan Keamanan Data

### Data yang disimpan

PostgreSQL menjadi pemilik durable untuk:

- Submission Identity dan canonical request hash;
- Requested Topic dan Source Material;
- Job state serta timestamps;
- dispatch recovery metadata;
- processing lease;
- pinned pipeline/model/result schema identity;
- Job Step checkpoints;
- Study Guide;
- Quality Warnings;
- structured safe Job Failure.

Setiap Job Step menyimpan latest structured checkpoint, status dan timing terbaru, structured safe stage failure, actual pinned model, serta nullable provider request ID dan token usage jika provider menyediakannya. Job Step tidak menyimpan salinan Source Material atau attempt history.

### Data yang tidak boleh dipersistenkan pada Job/Job Step

- API key;
- authorization header;
- password/token;
- system prompt;
- raw provider transcript;
- raw provider error body;
- stack trace;
- SQL detail.

Job Failure yang boleh dibaca Client memakai stable code dan safe message:

```json
{
  "code": "AI_RATE_LIMITED",
  "message": "AI provider is temporarily unavailable",
  "failedStep": "generate-study-guide",
  "retryable": true
}
```

Raw diagnostic cause hanya boleh masuk restricted application logs setelah sanitization.

### Retention

Default target retention adalah 30 hari sejak Job menjadi `COMPLETED` atau final `FAILED`.

Cleanup menghapus satu aggregate secara utuh:

- Job;
- Source Material;
- Study Guide;
- warnings dan failures;
- Job Steps;
- Submission Identity dan request hash.

Active Job tidak boleh dihapus. Idempotency window sama dengan retention window; key lama dapat dipakai kembali setelah aggregate dihapus.

Queue cleanup policy terpisah dari database retention. Retention hanya boleh dinonaktifkan secara eksplisit untuk local demo atau restart-persistence test; sentinel/config exact untuk menonaktifkannya harus ditetapkan pada milestone implementation sebelum dipakai secara operasional.

## Strategi Testing

Testing dipisahkan dari evaluasi kualitas model.

### Unit tests — tanpa network

Deterministic tests untuk:

- request schema dan canonical hash;
- idempotency replay/conflict;
- guarded state transitions;
- checkpoint resume;
- warning derivation;
- structured output schemas;
- failure classification dan sanitization;
- cursor encoding/decoding;
- retention eligibility.

### Integration dan E2E — real infrastructure, fake AI

Gunakan PostgreSQL dan Redis nyata, tetapi model stages deterministic:

```text
HTTP -> PostgreSQL -> BullMQ -> Worker -> PostgreSQL -> HTTP
```

Ini membuktikan orchestration dan recovery tanpa biaya serta nondeterminism dari model.

### Opt-in live smoke — real AI

Planned command:

```bash
pnpm test:live
```

Live smoke:

- tidak berjalan pada default CI;
- membutuhkan explicit authorization karena dapat menimbulkan biaya;
- membaca secret dari ignored `.env`;
- memakai input representatif yang kecil;
- memverifikasi provider/model construction, tiga stage, schema validation, persistence, dan API retrieval;
- tidak menguji exact prose;
- tidak mencetak credential atau raw provider response.

### Human quality evaluation

Curated examples dievaluasi dengan rubric manusia untuk:

- groundedness;
- coverage;
- Source Language consistency;
- Source Difficulty appropriateness;
- topic/content mismatch behavior;
- usefulness ketika koleksi hasil kosong/minim;
- warning correctness.

Schema validation bukan bukti grounding. MVP tidak menggunakan LLM-as-judge.

## Target Struktur Project

```text
src/
├── app.ts
├── server.ts
├── worker.ts
├── cleanup.ts
├── config/
│   ├── api-env.ts
│   ├── worker-env.ts
│   ├── cleanup-env.ts
│   ├── prisma.ts
│   └── redis.ts
├── modules/jobs/
│   ├── job.route.ts
│   ├── job.schema.ts
│   ├── job.service.ts
│   ├── job.repository.ts
│   ├── job.mapper.ts
│   ├── job-state-machine.ts
│   └── job.types.ts
├── queue/
│   ├── job.queue.ts
│   ├── job.worker.ts
│   └── job.reconciler.ts
├── pipeline/
│   ├── registry.ts
│   ├── study-guide.pipeline.ts
│   ├── execute-checkpoint.ts
│   └── steps/
│       ├── analyze-material.step.ts
│       ├── extract-concepts.step.ts
│       └── generate-study-guide.step.ts
├── ai/
│   ├── client.ts
│   ├── prompts.ts
│   ├── schemas.ts
│   └── errors.ts
└── shared/
    ├── errors/
    ├── logger/
    ├── security/
    └── types/

prisma/
├── schema.prisma
└── migrations/

tests/
├── unit/
├── integration/
├── e2e/
├── live/
└── fixtures/
```

Entry point harus tipis. Route, prompts, schemas, orchestration, provider construction, dan process startup tidak digabung dalam satu file besar.

## Roadmap

### Milestone 1 — Bootstrap dan configuration boundaries

- pisahkan API entrypoint;
- process-specific env validation;
- liveness/readiness;
- loopback bind;
- graceful API shutdown.

### Milestone 2 — Durable schema dan state machine

- Job dan Job Step schema;
- Prisma migration;
- guarded transitions;
- idempotency constraint;
- lease fields dan indexes.

### Milestone 3 — Queue dan recovery infrastructure

- persistent local PostgreSQL/Redis;
- BullMQ queue;
- immediate dispatch;
- worker reconciler;
- dispatch retry/expiry;
- active-state recovery.

### Milestone 4 — Idempotent submission API

- `POST /jobs`;
- required `Idempotency-Key`;
- canonical request hash;
- concurrent duplicate handling;
- `202/200/400/409/413/503` contract.

### Milestone 5 — Deterministic worker dan checkpoints

- fake three-stage pipeline;
- checkpoint wrapper;
- resume logic;
- lease heartbeat/fencing;
- retry lifecycle.

### Milestone 6 — Bounded read APIs

- cursor-paginated summaries;
- lean Job Detail;
- explicit projections;
- factual progress;
- safe warning/failure mapping.

### Milestone 7 — Reliability dan operations

- failure taxonomy;
- stage timeout;
- worker concurrency;
- graceful worker shutdown;
- retention cleanup;
- structured logs.

### Milestone 8 — Real AI integration

- verified Anvia/OpenAI-compatible adapter;
- real three-stage model execution;
- structured output validation;
- pinned model/pipeline/result schema;
- nullable usage metadata.

### Milestone 9 — Full verification

- unit, integration, dan E2E suites;
- opt-in live smoke;
- curated human evaluation;
- process restart tests;
- Redis state-loss recovery demo;
- final documentation sync.

Satu milestone dianggap selesai hanya setelah acceptance checks terkait benar-benar dijalankan. Adanya implementasi tidak otomatis berarti seluruh acceptance sudah terpenuhi.

## Dokumentasi Desain

Dokumen utama:

- [Project Plan V2](docs/ai-pipeline-project-plan.md) — normative target specification, milestone, dan acceptance matrix.
- [Domain Context](CONTEXT.md) — canonical domain language dan istilah yang harus dihindari.
- `docs/adr/` — accepted architecture decisions untuk branch V2.
- Branch `master` — menyimpan README dan Project Plan V1.

README, Plan V2, Domain Context, dan ADR ditrack bersama pada branch `project-v2`.

Jika ada perbedaan desain, urutan sumber keputusan adalah:

1. accepted ADR yang relevan;
2. `CONTEXT.md` untuk bahasa domain;
3. Project Plan V2 untuk target implementation;
4. README V2 sebagai operational overview.

## Ringkasan

Current repository belum menjadi background job system. Ia baru bootstrap Hono yang dapat di-install, dibangun, dan dijalankan dengan tiga command yang tersedia: `pnpm dev`, `pnpm build`, dan `pnpm start`.

Target MVP V2 adalah durable, idempotent, recoverable AI job-processing system dengan:

- Hono API;
- PostgreSQL + Prisma;
- BullMQ + Redis;
- separate worker dan reconciler;
- processing lease/fencing;
- checkpoint-aware three-stage AI pipeline;
- Anvia/OpenAI-compatible live model integration;
- bounded polling API;
- safe failures dan quality warnings;
- deterministic tests serta opt-in live smoke.

README ini sengaja tidak mengklaim bahwa target tersebut sudah tersedia sebelum code dan acceptance evidence benar-benar ada.
