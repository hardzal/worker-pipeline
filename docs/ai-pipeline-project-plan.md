# AI Pipeline Job Processing API — Project Plan V2

## 1. Document Status

Status: **normative target specification**

Dokumen ini adalah specification canonical untuk branch `project-v2`. Plan V1 tetap tersedia pada branch `master`; pada masing-masing branch, file canonical menggunakan path `docs/ai-pipeline-project-plan.md`. Jika terjadi perbedaan di branch V2, Plan V2, `CONTEXT.md`, dan ADR yang relevan menjadi sumber keputusan terbaru.

Dokumen ini tidak menyatakan bahwa target sudah diimplementasikan. Kondisi repository saat V2 dibuat masih berupa bootstrap Hono sederhana:

- `GET /` mengembalikan plain text `Hello Hono!`;
- server memakai port hard-coded `3000`;
- script yang tersedia hanya `dev`, `build`, dan `start`;
- PostgreSQL, Prisma, Redis, BullMQ, worker, reconciler, AI pipeline, dan automated tests belum diimplementasikan;
- `docker-compose.yml` masih kosong.

## 2. Objective

Membangun API pemrosesan AI asinkron bergaya production untuk menghasilkan Study Guide dari Source Material yang dikirim Client.

Sistem harus:

1. menerima submission secara idempotent;
2. menyimpan Job secara durable sebelum menjadwalkannya;
3. menjalankan sequential AI pipeline di background worker;
4. menyimpan checkpoint canonical setiap pipeline stage;
5. memulihkan active Job ketika queue state hilang atau kedaluwarsa;
6. menyimpan Study Guide, status, warning, dan failure secara aman;
7. menyediakan polling API yang bounded;
8. menggunakan model AI nyata pada runtime production/live mode;
9. tetap dapat diuji secara deterministic tanpa billable model call;
10. mempertahankan aggregate terminal selama retention window.

## 3. Scope Boundary

### 3.1 In scope untuk MVP

- trusted single-tenant local/internal service;
- Hono HTTP API;
- PostgreSQL sebagai durable source of truth;
- Prisma sebagai data-access layer;
- BullMQ dengan Redis sebagai scheduler/execution queue;
- worker process terpisah;
- recoverable-job reconciler di dalam worker process;
- sequential Study Guide pipeline dengan tiga stage;
- real model calls melalui Anvia SDK dan provider OpenAI-compatible;
- structured output validation;
- checkpoint resume;
- processing retry dan dispatch recovery;
- cursor pagination dan explicit response projections;
- structured safe failures dan quality warnings;
- retention cleanup;
- unit, integration, end-to-end, dan opt-in live smoke test.

### 3.2 Explicitly out of scope

- public authentication dan authorization;
- multi-tenancy atau Job ownership per user;
- public internet deployment;
- input chunking/map-reduce;
- attempt history;
- exactly-once AI execution atau billing;
- evaluator/improve loop;
- Server-Sent Events;
- cancellation;
- queue dashboard;
- cost estimation;
- automated LLM-as-judge;
- multiple Job kinds.

Public deployment memerlukan milestone terpisah untuk identity, authorization, rate limit, abuse control, dan owner isolation.

## 4. Ubiquitous Language

Istilah domain canonical didefinisikan di root `CONTEXT.md`. Ringkasan terpenting:

- **Job**: satu maksud Client untuk menghasilkan Study Guide.
- **Submission Identity**: identitas intent dari header `Idempotency-Key`.
- **Source Material**: field `content` dan satu-satunya sumber fakta.
- **Requested Topic**: label intent dari Client, bukan sumber fakta.
- **Detected Subject**: subject yang diinfer model dari Source Material.
- **Job Step**: checkpoint canonical terbaru untuk satu pipeline stage, bukan attempt log.
- **Study Guide**: hasil akhir yang grounded melalui prompt pada Source Material.
- **Quality Warning**: kondisi non-fatal pada hasil yang tetap dapat berstatus Completed.
- **Job Failure**: structured safe failure yang dapat disimpan dan diekspos.
- **Pipeline Version**, **Model Assignment**, dan **Result Schema Version**: tiga identitas berbeda.

## 5. Core Architectural Principles

### 5.1 PostgreSQL is the durable source of truth

PostgreSQL menyimpan:

- Submission Identity dan request hash;
- Source Material canonical;
- state machine Job;
- dispatch/recovery state;
- processing lease;
- pinned pipeline/model identity;
- Job Step checkpoints;
- Study Guide;
- Quality Warnings;
- structured Job Failure;
- retention timestamps.

Redis tidak menjadi permanent result database. Queue state yang hilang harus dapat direkonstruksi dari Job non-terminal di PostgreSQL.

### 5.2 BullMQ schedules work

BullMQ menentukan kapan dan worker mana yang menjalankan Job. Queue payload harus kecil:

```json
{
  "jobId": "database-job-id"
}
```

Database `Job.id` selalu dipakai sebagai BullMQ `jobId`. Tidak ada field `bullJobId` terpisah pada MVP.

### 5.3 At-least-once processing

Worker menjalankan Job dengan guarantee at-least-once. Database writes dan checkpoint replacement harus idempotent, tetapi model call dapat terulang jika worker mati setelah provider menerima request dan sebelum hasil tersimpan.

Sistem tidak mengklaim:

- exactly-once model execution;
- exactly-once provider billing;
- total active compute duration lintas retry tanpa attempt history.

### 5.4 Checkpoints, not attempt logs

`JobStep` menyimpan current canonical checkpoint per stage. Riwayat attempt lama tidak disimpan.

Saat retry:

1. validasi checkpoint completed dari pinned Pipeline Version;
2. gunakan kembali checkpoint yang valid;
3. mulai dari stage pertama yang incomplete atau failed;
4. jalankan ulang stage tersebut dan seluruh downstream stage;
5. jangan memakai checkpoint dari Pipeline Version berbeda.

## 6. High-Level Architecture

```text
Trusted Client
      |
      | POST /jobs + Idempotency-Key
      v
+-----------------------+
| Hono API              |
| validate + persist    |
+-----------+-----------+
            |
            | Job=PENDING
            v
+-----------------------+
| PostgreSQL            |
| durable source        |
+-----------+-----------+
            |
            | immediate dispatch attempt
            v
+-----------------------+
| BullMQ / Redis        |
+-----------+-----------+
            |
            v
+-----------------------+
| Worker Process        |
| - reconciler          |
| - queue consumer      |
| - processing lease    |
+-----------+-----------+
            |
            v
+-----------------------+
| Sequential Pipeline   |
| Analyze -> Extract    |
| -> Generate           |
+-----------+-----------+
            |
            | checkpoint/result writes
            v
+-----------------------+
| PostgreSQL            |
| Job Steps + Result    |
+-----------+-----------+
            |
            v
GET /jobs / GET /jobs/:id
```

## 7. Process Responsibilities

### 7.1 API process

Owns:

- HTTP request parsing;
- request ID generation/propagation;
- input and header validation;
- idempotent Job submission;
- immediate dispatch attempt;
- Job summary/detail queries;
- liveness/readiness endpoints;
- response projection and safe error mapping.

Does not own:

- pipeline prompts;
- model execution;
- periodic recovery;
- retention cleanup execution logic inside request handlers.

### 7.2 Worker process

Owns:

- BullMQ worker;
- recoverable-job reconciler;
- processing lease acquire/renew/release;
- checkpoint-aware pipeline orchestration;
- failure classification;
- retry state;
- final result persistence;
- graceful shutdown.

### 7.3 Cleanup process

Boleh berupa scheduled command terpisah. Owns:

- mencari Terminal Job yang melewati retention window;
- menghapus aggregate Job dan Job Steps secara atomik/cascade;
- melepaskan Submission Identity bersama penghapusan Job.

## 8. Job Lifecycle

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

### 8.1 Status semantics

- `PENDING`: Job sudah durable dan dimiliki sistem, tetapi initial dispatch belum berhasil.
- `QUEUED`: BullMQ Job berhasil dibuat dan menunggu worker.
- `PROCESSING`: worker memiliki processing lease dan menjalankan/resume pipeline.
- `RETRYING`: latest processing attempt gagal secara transient dan retry masih dijadwalkan.
- `COMPLETED`: seluruh stage selesai dan persisted result lolos structured schema.
- `FAILED`: terminal failure; tidak ada automatic processing retry tersisa.

`COMPLETED` tidak berarti human-approved atau quality-perfect. Empty collections boleh valid, tetapi menghasilkan Quality Warning.

### 8.2 Legal transitions

| From | To | Trigger |
| --- | --- | --- |
| — | `PENDING` | idempotent submission tersimpan |
| `PENDING` | `QUEUED` | immediate/reconciled dispatch berhasil |
| `PENDING` | `FAILED` | dispatch maximum age habis |
| `QUEUED` | `PROCESSING` | worker memperoleh lease |
| `PROCESSING` | `RETRYING` | retryable failure dan attempt tersisa |
| `RETRYING` | `PROCESSING` | delayed retry memperoleh lease baru |
| `PROCESSING` | `COMPLETED` | final checkpoint dan result tersimpan |
| `PROCESSING` | `FAILED` | non-retryable failure atau attempts exhausted |

Semua transition memakai conditional database update/compare-and-set. Stale event yang tidak lagi cocok dengan source status menjadi no-op. `COMPLETED` dan `FAILED` terminal tidak boleh diregresikan.

## 9. Submission Contract

### 9.1 `POST /jobs`

Required header:

```http
Idempotency-Key: <client-generated-key>
Content-Type: application/json
```

Target key rules:

- trimmed, non-empty printable value;
- maksimum 255 karakter;
- unique selama retention/idempotency window;
- tidak boleh mengandung credential atau data pribadi.

Request:

```json
{
  "topic": "Model Context Protocol",
  "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources..."
}
```

Validation:

- `topic`: trimmed string, 3–200 karakter;
- `content`: trimmed non-empty string dengan minimum 50 karakter;
- `content` tidak boleh melewati `MAX_SOURCE_CHARS`;
- unknown request fields ditolak;
- request hash dihitung dari canonical validated payload;
- oversized content ditolak sebelum Job dibuat.

MVP tidak melakukan chunking. Default target `MAX_SOURCE_CHARS=20000` dan wajib dapat diubah sesuai context budget model yang dipilih.

### 9.2 Submission outcomes

#### New Job, immediate dispatch succeeds

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

#### New Job is durable, dispatch pending

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

#### Same key and same payload during idempotency window

```http
HTTP/1.1 200 OK
Idempotency-Replayed: true
Location: /jobs/<id>
```

Body berisi current lean Job Detail, bukan stale initial response.

#### Same key and different payload

```http
HTTP/1.1 409 Conflict
```

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_CONFLICT",
    "message": "Idempotency key was already used for a different request"
  }
}
```

#### Missing/invalid input or key

```http
HTTP/1.1 400 Bad Request
```

#### Source exceeds configured limit

```http
HTTP/1.1 413 Payload Too Large
```

No Job dibuat pada `400` atau `413`.

#### Persistence unavailable

```http
HTTP/1.1 503 Service Unavailable
```

No ownership diterima jika durable Job tidak dapat dibuat.

### 9.3 Concurrent duplicate submission

Unique constraint dan transaction harus memastikan concurrent request dengan Submission Identity yang sama membuat tepat satu Job. Jangan menggunakan unsafe check-then-insert tanpa database conflict handling.

### 9.4 Manual rerun after final failure

MVP tidak memiliki `POST /jobs/:id/retry`. Intent baru memakai `Idempotency-Key` baru dan membuat Job baru. Key lama mereferensikan original Job selama 30-day idempotency window.

## 10. Read API

### 10.1 `GET /jobs`

Cursor-paginated Job Summary endpoint:

```http
GET /jobs?limit=20&cursor=<opaque>&status=COMPLETED
```

Rules:

- default limit 20;
- maximum limit 100;
- stable order `createdAt DESC, id DESC`;
- optional exact status filter;
- cursor berupa opaque base64url representation dari sort boundary;
- invalid cursor atau invalid status menghasilkan `400`;
- tidak menjalankan unbounded total count secara default.

Response:

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

Job Summary tidak memuat Source Material, full Study Guide, atau Job Steps.

### 10.2 `GET /jobs/:id`

Default response adalah lean Job Detail:

```json
{
  "id": "job-uuid",
  "status": "PROCESSING",
  "pipelineVersion": "study-guide.pipeline.v1",
  "modelId": "configured-model-id",
  "progress": {
    "completedSteps": 2,
    "totalSteps": 3,
    "currentStep": "generate-study-guide",
    "nextRetryAt": null
  },
  "warnings": [],
  "lastError": null,
  "createdAt": "...",
  "queuedAt": "...",
  "startedAt": "...",
  "stateChangedAt": "...",
  "terminalAt": null,
  "elapsedMs": null
}
```

Heavy fields menggunakan explicit projection:

```http
GET /jobs/:id?include=result,steps,source
```

Allowed values:

- `result`;
- `steps`;
- `source`.

Unknown include value menghasilkan `400`. Missing/deleted Job menghasilkan `404`.

Progress bersifat factual:

- `totalSteps` berasal dari pinned Pipeline Version;
- `completedSteps` berasal dari validated completed checkpoints;
- `currentStep` hanya ada ketika stage aktif;
- `nextRetryAt` hanya ada saat delayed retry/dispatch relevan;
- tidak ada percentage atau estimated completion time pada MVP.

### 10.3 Cache behavior

Job polling responses harus menggunakan cache policy yang mencegah intermediary menyajikan state stale pada environment internal. ETag boleh ditambahkan kemudian, tetapi bukan requirement MVP.

## 11. Health Contract

### 11.1 API liveness

```http
GET /health/live
```

Membuktikan process/event loop hidup tanpa memanggil dependency.

### 11.2 API readiness

```http
GET /health/ready
```

- PostgreSQL wajib healthy;
- `LLM_MODEL`, default Pipeline Version, dan Result Schema Version wajib valid/resolvable agar Model Assignment dapat dipin saat submission;
- Redis dilaporkan `healthy` atau `degraded`;
- Redis down tidak membuat API unready karena API dapat menerima durable `PENDING` Job;
- response tidak memanggil billable AI endpoint.

### 11.3 Worker readiness

Worker memerlukan:

- PostgreSQL;
- Redis;
- valid AI configuration;
- pipeline/model registry yang memuat pinned defaults.

Credential diverifikasi keberadaan/formatnya saat startup. Readiness tidak melakukan model generation call.

## 12. Recovery and Dispatch

### 12.1 Immediate dispatch

Setelah Job tersimpan sebagai `PENDING`, API mencoba enqueue dengan:

```json
{
  "name": "generate-study-guide",
  "data": {
    "jobId": "database-job-id"
  },
  "jobId": "database-job-id"
}
```

Jika enqueue berhasil, guarded transition mengubah Job menjadi `QUEUED`. Jika gagal, Job tetap `PENDING`, safe dispatch error disimpan, dan API tetap mengembalikan `202 PENDING`.

### 12.2 Recoverable-job reconciler

Reconciler berjalan:

- pada worker startup;
- setiap `RECOVERY_SCAN_INTERVAL_MS`, default 30 detik;
- dalam bounded batches;
- dengan database locking/claiming agar aman ketika ada lebih dari satu worker.

Responsibilities:

- enqueue due `PENDING` Job;
- memulihkan stale `QUEUED` jika BullMQ Job hilang;
- memulihkan `RETRYING` jika delayed BullMQ Job hilang;
- memulihkan stale `PROCESSING` setelah processing lease expired;
- tidak pernah enqueue Terminal Job.

### 12.3 Dispatch retry policy

- exponential backoff;
- delay cap lima menit;
- default maximum dispatch age 24 jam melalui `DISPATCH_MAX_AGE_MS`;
- simpan `dispatchAttempts`, `nextDispatchAt`, dan safe `lastDispatchError`;
- setelah expiry: final `FAILED` dengan `QUEUE_DISPATCH_EXPIRED`.

Dispatch retry budget terpisah dari processing retry budget.

## 13. Processing Lease and Fencing

Worker memperoleh lease sebelum mengubah Job menjadi `PROCESSING`.

Target fields:

- `leaseOwner`: opaque random token;
- `leaseExpiresAt`: expiry timestamp.

Defaults:

- `PROCESSING_HEARTBEAT_MS=30000`;
- `PROCESSING_LEASE_MS=300000`.

Rules:

1. acquire memakai guarded atomic update;
2. worker memperpanjang lease secara periodik;
3. semua checkpoint, failure, dan completion write menyertakan current `leaseOwner`;
4. kehilangan lease menghentikan write dan membatalkan pekerjaan sejauh adapter memungkinkan;
5. worker lama tidak boleh menimpa state setelah lease dipindahkan;
6. BullMQ stalled detection tetap aktif, tetapi tidak menggantikan database lease.

Lease adalah fencing mechanism, bukan exactly-once guarantee.

## 14. AI Pipeline Contract

### 14.1 Pipeline identity

Target pinned values ketika Job dibuat:

- `pipelineVersion = study-guide.pipeline.v1`;
- `modelId = current validated LLM_MODEL`;
- result schema target `study-guide.v1`.

Perubahan runtime `LLM_MODEL` tidak mengubah Job yang sudah dibuat. Pinned model yang tidak tersedia menghasilkan non-retryable failure; worker tidak melakukan silent model substitution.

### 14.2 Grounding policy

- Source Material adalah satu-satunya sumber fakta;
- Requested Topic hanya memberi initial context;
- model boleh meringkas, menyusun ulang, dan membuat Q&A;
- model tidak boleh menambahkan external factual claims;
- insufficient material menghasilkan limitation/warning, bukan fakta buatan;
- grounding ditegakkan melalui prompt dan human quality evaluation;
- result schema tidak memiliki exact evidence/quotation field;
- schema validation tidak boleh diklaim sebagai proof of grounding.

### 14.3 Stage 1 — Analyze Material

Input:

- Requested Topic;
- Source Material.

Output checkpoint:

```json
{
  "detectedSubject": "Model Context Protocol",
  "sourceDifficulty": "beginner",
  "sourceLanguage": "en",
  "topicMatchesContent": true,
  "learningObjectives": [],
  "importantSections": [],
  "warnings": []
}
```

Rules:

- `sourceDifficulty`: `beginner | intermediate | advanced`;
- Study Guide mengikuti inferred Source Difficulty;
- output memakai dominant Source Language;
- mixed-language content menghasilkan `MIXED_SOURCE_LANGUAGE`;
- Requested Topic mismatch menghasilkan `TOPIC_CONTENT_MISMATCH`;
- mismatch tidak otomatis menggagalkan Job; Detected Subject menang.

### 14.4 Stage 2 — Extract Key Concepts

Input:

- Stage 1 checkpoint;
- reference ke canonical Source Material, bukan duplicate persistence.

Output checkpoint:

```json
{
  "concepts": [
    {
      "name": "MCP Server",
      "definition": "A component that exposes capabilities.",
      "importance": "It connects AI applications to tools and data."
    }
  ],
  "warnings": []
}
```

Canonical Key Concept selalu memakai:

- `name`;
- `definition`;
- `importance`.

Field `description` tidak dipakai sebagai bentuk alternatif.

### 14.5 Stage 3 — Generate Study Guide

Input:

- Requested Topic;
- Detected Subject;
- Source Difficulty;
- Source Language;
- validated Key Concepts;
- references/checkpoints dari upstream.

Persisted result:

```json
{
  "schemaVersion": "study-guide.v1",
  "title": "Model Context Protocol Study Guide",
  "summary": "...",
  "detectedSubject": "Model Context Protocol",
  "sourceDifficulty": "beginner",
  "sourceLanguage": "en",
  "keyConcepts": [
    {
      "name": "MCP Server",
      "definition": "...",
      "importance": "..."
    }
  ],
  "questions": [
    {
      "question": "What problem does MCP solve?",
      "answer": "..."
    }
  ],
  "limitations": [],
  "warnings": []
}
```

Arrays boleh kosong jika schema tetap valid. Empty result collections menghasilkan Quality Warning dan Job tetap dapat `COMPLETED`.

### 14.6 Stable warning codes

Minimum target warning vocabulary:

- `TOPIC_CONTENT_MISMATCH`;
- `MIXED_SOURCE_LANGUAGE`;
- `LIMITED_SOURCE_MATERIAL`;
- `NO_KEY_CONCEPTS`;
- `NO_QUESTIONS`.

Warnings harus machine-readable dan dapat memiliki safe human message.

## 15. Checkpoint Execution

Setiap stage memakai satu reusable checkpoint wrapper, misalnya:

```text
executeCheckpoint(jobId, leaseOwner, stageDefinition, execute)
```

Responsibilities:

1. memastikan Job dan lease masih valid;
2. load existing checkpoint;
3. reuse completed output hanya jika Pipeline Version dan schema cocok;
4. upsert stage menjadi `PROCESSING` untuk re-execution;
5. clear stale downstream checkpoints bila upstream stage berubah;
6. execute model call dengan per-step timeout;
7. validate structured output;
8. persist sanitized structured output dan usage metadata;
9. mark stage `COMPLETED`;
10. pada error, persist structured safe stage failure dan rethrow classified error.

Final stage checkpoint dan transition Job ke `COMPLETED` harus diselesaikan secara transactionally. Jika final checkpoint sudah ada tetapi completion transition belum tersimpan, retry melakukan finalize tanpa model call ulang.

## 16. Retry and Failure Policy

### 16.1 Processing retry defaults

- maximum total executions: 3, yaitu satu initial execution dan paling banyak dua retries;
- exponential backoff: 1s lalu 2s sebelum kedua retry tersebut;
- optional jitter boleh ditambahkan selama test deterministic dapat mengontrol clock;
- retry dimulai dari first non-completed checkpoint.

### 16.2 Retryable failures

- network error;
- provider timeout;
- HTTP `429`;
- provider `5xx`;
- transient PostgreSQL/Redis error;
- invalid structured AI output.

### 16.3 Non-retryable failures

- invalid/missing worker configuration;
- provider `401`/`403`;
- pinned model unavailable/unsupported;
- provider context limit exceeded;
- missing database Job for queue payload;
- internal pipeline invariant/schema incompatibility;
- explicit processing lease loss for stale worker writes.

### 16.4 AI step timeout

- `AI_STEP_TIMEOUT_MS=120000` default;
- timeout berlaku per model-backed stage;
- timeout retryable;
- gunakan AbortSignal jika adapter mendukung;
- local timeout tidak menjamin provider membatalkan request atau biaya.

### 16.5 Structured safe failure

Public/persisted shape:

```json
{
  "code": "AI_RATE_LIMITED",
  "message": "AI provider is temporarily unavailable",
  "failedStep": "generate-study-guide",
  "retryable": true
}
```

Raw provider body, stack trace, prompt, SQL detail, authorization header, dan credential tidak boleh masuk public Job Failure.

Minimum stable error codes:

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

Transient failure terlihat sebagai `lastError` saat `RETRYING` dan dibersihkan saat Job akhirnya `COMPLETED`.

## 17. Persistence Model

### 17.1 Job aggregate fields

Conceptual target:

| Field | Purpose |
| --- | --- |
| `id` | database/BullMQ Job identity |
| `status` | guarded Job state |
| `idempotencyKey` | Submission Identity, unique selama retention |
| `requestHash` | canonical validated request hash |
| `input` | Requested Topic + canonical Source Material |
| `pipelineVersion` | pinned pipeline identity |
| `modelId` | pinned Model Assignment |
| `resultSchemaVersion` | persisted result shape identity |
| `result` | full Study Guide or null |
| `warnings` | structured Quality Warnings |
| `lastError` | current safe Job Failure or null |
| `dispatchAttempts` | dispatch recovery counter |
| `nextDispatchAt` | next dispatch eligibility |
| `dispatchDeadlineAt` | default 24-hour expiry |
| `leaseOwner` | processing fencing token |
| `leaseExpiresAt` | processing lease expiry |
| timestamps | create/queue/start/state/terminal/update times |

Tidak ada `type` atau `bullJobId` pada MVP.

Recommended indexes/constraints:

- unique `idempotencyKey`;
- index `(status, nextDispatchAt)`;
- index `(status, leaseExpiresAt)`;
- index `(status, terminalAt)`;
- pagination index `(createdAt DESC, id DESC)`;
- database constraints/checks jika didukung migration untuk illegal null combinations.

### 17.2 Job Step fields

| Field | Purpose |
| --- | --- |
| `id` | checkpoint row identity |
| `jobId` | parent Job |
| `name` | canonical stage name |
| `order` | stage order |
| `status` | `PENDING/PROCESSING/COMPLETED/FAILED` |
| `input` | structured references/upstream values, no Source Material copy |
| `output` | validated structured checkpoint |
| `error` | structured safe stage failure |
| `startedAt/completedAt/durationMs` | latest checkpoint execution metadata |
| `modelId` | actual pinned model used |
| `providerRequestId` | nullable provider correlation |
| `inputTokens/outputTokens` | nullable usage metadata |

Constraints:

- foreign key to Job with cascade delete;
- unique `(jobId, name)`;
- index `(jobId, order)`;
- no attempt history.

## 18. Data Handling and Logging

### 18.1 Persist once

Canonical Source Material disimpan hanya di `Job.input`. Job Step tidak menyalin full content.

### 18.2 Allowed checkpoint data

- structured validated analysis;
- structured validated concepts;
- structured final result;
- stage status/timing;
- model ID;
- nullable provider request ID;
- nullable token usage.

### 18.3 Never persist in Job/Job Step

- API keys;
- authorization headers;
- passwords/tokens;
- system prompts;
- raw provider transcripts;
- raw provider error bodies;
- stack traces;
- SQL detail.

### 18.4 Application logs

Structured events:

- `job.created`;
- `job.dispatch_pending`;
- `job.queued`;
- `job.processing`;
- `job.retrying`;
- `job.completed`;
- `job.failed`;
- `job.recovered`;
- `job.retention_deleted`.

Correlation fields:

- `requestId` for HTTP;
- `jobId` for background processing;
- stage name;
- safe error code;
- duration.

Diagnostic causes harus disanitasi dan hanya masuk restricted application logs.

## 19. Time Semantics

- `createdAt`: Job durable;
- `queuedAt`: first successful dispatch;
- `startedAt`: first processing start, tidak ditimpa retry;
- `stateChangedAt`: latest legal transition;
- `nextRetryAt`: delayed processing retry;
- `terminalAt`: final completed/failed time;
- `updatedAt`: persistence update time.

Job-level `elapsedMs` adalah `terminalAt - createdAt`. Jangan menamai jumlah latest Job Step duration sebagai total compute time.

## 20. Retention

Default:

```text
JOB_RETENTION_DAYS=30
```

Rules:

- clock dimulai saat Job menjadi Terminal Job;
- active Job tidak pernah dihapus oleh retention cleanup;
- Job, Source Material, Study Guide, failures, warnings, Job Steps, Submission Identity, dan request hash dihapus sebagai satu aggregate;
- idempotency window sama dengan retention window;
- setelah aggregate dihapus, old key boleh dipakai lagi;
- retention dapat dinonaktifkan secara eksplisit hanya untuk local demo/restart-persistence test;
- queue cleanup policy terpisah dari database retention.

## 21. Concurrency and Shutdown

### 21.1 Worker concurrency

```text
WORKER_CONCURRENCY=1
```

Default aman untuk local billable provider dan configurable. Queue/provider limiter dapat ditambahkan berdasarkan observed `429`, latency, dan cost.

### 21.2 Graceful shutdown

```text
SHUTDOWN_GRACE_MS=30000
```

Worker shutdown:

1. berhenti mengambil Job baru;
2. pertahankan lease/heartbeat selama active work;
3. tunggu active work hingga grace period;
4. tutup BullMQ/Redis/Prisma;
5. setelah timeout, exit dan biarkan stalled/recovery path bekerja.

API shutdown:

1. berhenti menerima connection baru;
2. selesaikan inflight request dalam grace period;
3. tutup server, Redis client, dan Prisma.

## 22. Environment Configuration

Canonical AI configuration mengikuti repository saat ini:

```env
LLM_MODEL=
OPENAI_API_KEY=
OPENAI_API_BASE_URL=
```

Target full configuration:

```env
NODE_ENV=development
HOST=127.0.0.1
PORT=3000

DATABASE_URL=postgresql://...
REDIS_URL=redis://127.0.0.1:6379

LLM_MODEL=
OPENAI_API_KEY=
OPENAI_API_BASE_URL=

MAX_SOURCE_CHARS=20000
WORKER_CONCURRENCY=1
AI_STEP_TIMEOUT_MS=120000
SHUTDOWN_GRACE_MS=30000
RECOVERY_SCAN_INTERVAL_MS=30000
DISPATCH_MAX_AGE_MS=86400000
PROCESSING_HEARTBEAT_MS=30000
PROCESSING_LEASE_MS=300000
JOB_RETENTION_DAYS=30
```

Process-specific validation:

| Process | Required configuration |
| --- | --- |
| API | host/port, PostgreSQL, non-blank `LLM_MODEL`, default Pipeline Version dan Result Schema Version; Redis may be degraded |
| Worker/reconciler | PostgreSQL, Redis, AI provider credential/base URL, pinned model, pipeline registry |
| Cleanup | PostgreSQL, retention policy |

Blank optional values diperlakukan sebagai missing. Error config menyebut nama field, tidak pernah secret value. Job menyimpan `modelId`, bukan credential.

Missing atau invalid required process configuration menggagalkan startup/readiness process tersebut. Provider credential tetap worker-only; API membutuhkan model identity untuk pinning, bukan credential untuk menjalankan model call.

## 23. Local Docker Infrastructure

Target Compose services:

- PostgreSQL dengan named volume;
- Redis dengan AOF dan named volume;
- healthcheck untuk keduanya;
- host ports bind ke `127.0.0.1`;
- dependency readiness, bukan hanya container started.

Test scenarios harus membedakan:

- API restart;
- worker restart;
- PostgreSQL container restart;
- Redis restart dengan persisted state;
- Redis state loss dan PostgreSQL-driven recovery.

## 24. Target Project Structure

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

Entry points tetap tipis. Route, prompt, schema, orchestration, dan provider construction tidak diletakkan di satu `index.ts`.

## 25. Target Scripts

Scripts berikut adalah target dan belum tersedia pada bootstrap saat V2 dibuat:

```json
{
  "scripts": {
    "dev:api": "tsx watch src/server.ts",
    "dev:worker": "tsx watch src/worker.ts",
    "build": "tsc",
    "start:api": "node dist/server.js",
    "start:worker": "node dist/worker.js",
    "cleanup": "node dist/cleanup.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "test": "vitest run",
    "test:integration": "vitest run tests/integration tests/e2e",
    "test:live": "vitest run tests/live",
    "typecheck": "tsc --noEmit"
  }
}
```

Gunakan pnpm secara konsisten.

## 26. Testing Strategy

### 26.1 Unit tests — no network

Use deterministic fakes untuk:

- request schema dan canonical hash;
- idempotency conflict/replay logic;
- guarded state transitions;
- checkpoint selection/resume;
- warning derivation;
- structured output schemas;
- failure classification;
- sanitization;
- cursor encoding/decoding;
- retention eligibility.

### 26.2 Integration and E2E — real PostgreSQL/Redis, fake AI

Test full control flow:

```text
HTTP -> PostgreSQL -> BullMQ -> Worker -> PostgreSQL -> HTTP
```

AI stages tetap deterministic agar test stabil dan gratis.

### 26.3 Opt-in live smoke — real AI

`pnpm test:live`:

- tidak berjalan otomatis di default CI;
- membaca credential dari ignored `.env`;
- memakai satu small representative Job;
- memverifikasi provider/model construction, three-stage pipeline, schema parsing, checkpoint/result persistence, dan API retrieval;
- assert structure dan non-empty required strings, bukan exact prose;
- tidak mencetak credential atau raw provider response.

Billable call memerlukan explicit authorization sebelum dijalankan oleh automation/agent.

### 26.4 Quality evaluation

Gunakan curated dataset kecil dan human rubric untuk:

- groundedness;
- coverage;
- source language consistency;
- Source Difficulty appropriateness;
- topic/content mismatch behavior;
- usefulness ketika arrays kosong/minim;
- warning correctness.

Quality evaluation adalah acceptance activity, bukan deterministic unit-test gate setiap commit. MVP tidak memakai LLM-as-judge.

## 27. Deterministic-First Milestones

### Milestone 1 — Bootstrap and configuration boundaries

Deliverables:

- separate target API entrypoint;
- process-specific env schemas;
- `GET /health/live` dan `/health/ready`;
- loopback bind by default;
- graceful API shutdown.

Acceptance:

- liveness tidak memanggil dependency;
- readiness gagal saat PostgreSQL unavailable;
- readiness melaporkan Redis degraded tanpa membuat API unavailable;
- config tests tidak membaca developer `.env`.

### Milestone 2 — Durable schema and state machine

Deliverables:

- Job/JobStep schema;
- migration;
- repositories;
- guarded transitions;
- idempotency constraint;
- processing lease fields;
- indexes.

Acceptance:

- illegal/stale transition tidak menimpa current state;
- terminal state tidak beregresi;
- one Submission Identity cannot create two Jobs;
- source disimpan sekali;
- Job Step relation/cascade bekerja.

### Milestone 3 — Queue and recovery infrastructure

Deliverables:

- local PostgreSQL/Redis Compose;
- BullMQ queue;
- immediate dispatch;
- worker-owned reconciler;
- dispatch backoff/expiry;
- active-state recovery.

Acceptance:

- Redis unavailable menghasilkan durable `PENDING`;
- recovery mengubahnya menjadi `QUEUED` setelah Redis pulih;
- missing queue state direkonstruksi;
- Terminal Job tidak dire-enqueue;
- 24-hour dispatch expiry dapat diuji dengan fake clock/config override.

### Milestone 4 — Idempotent submission API

Deliverables:

- `POST /jobs` validation;
- required `Idempotency-Key`;
- request hashing;
- `202/200/400/409/413/503` contract;
- `Location` dan replay header.

Acceptance:

- same key/same payload returns one Job;
- same key/different payload returns `409`;
- concurrent duplicates create exactly one Job;
- oversized input creates no Job.

### Milestone 5 — Deterministic worker and checkpoints

Deliverables:

- fake three-stage pipeline;
- checkpoint wrapper;
- resume logic;
- lease acquire/heartbeat/fencing;
- at-least-once safe persistence;
- `RETRYING` semantics.

Acceptance:

- failed stage resumes from last valid checkpoint;
- completed upstream fake stage is not called again;
- invalid Pipeline Version checkpoint is not reused;
- stale lease owner cannot write;
- retry exhaustion creates final `FAILED`;
- final checkpoint can finalize Job without rerunning stage.

### Milestone 6 — Bounded read APIs

Deliverables:

- cursor-paginated `GET /jobs`;
- lean `GET /jobs/:id`;
- include projections;
- factual progress;
- safe error/warning mapping.

Acceptance:

- stable pagination has no duplicate/skip at equal timestamps;
- list never includes Source Material/full result/steps;
- default detail is lean;
- allowed includes return requested fields only;
- unknown include and invalid cursor return `400`;
- missing/deleted Job returns `404`.

### Milestone 7 — Reliability and operations

Deliverables:

- failure taxonomy;
- per-step timeout;
- worker concurrency config;
- graceful worker shutdown;
- retention cleanup;
- structured logs.

Acceptance:

- retryable failure becomes `RETRYING` before final outcome;
- non-retryable failure does not waste attempts;
- safe failure has no secret/raw provider body;
- active Job is not retention-deleted;
- expired aggregate and idempotency reservation are deleted together;
- shutdown stops new work and exits after configured grace.

### Milestone 8 — Real AI integration

Deliverables:

- verified Anvia/OpenAI-compatible adapter;
- Stage 1 real structured analysis;
- Stage 2 real Key Concept extraction;
- Stage 3 real Study Guide generation;
- pinned model/pipeline/result versions;
- nullable usage metadata.

Acceptance:

- real runtime path contains no fake AI response;
- every stage output is schema-validated;
- Key Concept fields remain `name/definition/importance`;
- empty arrays generate warnings rather than schema failure;
- model change after submission does not alter existing Job assignment.

### Milestone 9 — Full verification

Deliverables:

- unit/integration/E2E suites;
- opt-in live smoke;
- curated human evaluation;
- restart and Redis-loss demos;
- README sync.

Acceptance:

- default tests use no provider credential/network;
- real provider smoke succeeds when explicitly authorized/configured;
- completed result survives API and worker restart;
- Redis state-loss recovery restores non-terminal work;
- human rubric result is recorded without claiming deterministic grounding proof;
- build/typecheck/tests pass with observed output.

## 28. Critical Acceptance Matrix

| Requirement | Evidence |
| --- | --- |
| Durable acceptance | PostgreSQL integration test |
| HTTP idempotency | duplicate/concurrent submission tests |
| Dispatch recovery | Redis outage + recovery integration test |
| Active Job recovery | queue-state loss + lease-expiry test |
| At-least-once safety | duplicate delivery test |
| Checkpoint resume | fake stage call-count assertions |
| State machine safety | stale transition and terminal regression tests |
| Bounded list | cursor pagination contract tests |
| Lean detail | include projection tests |
| Safe failure | redaction/leak assertions |
| Result versioning | historical decoder fixture |
| Model pinning | config-change-after-submission test |
| Retention | fake-clock cleanup integration test |
| Real AI wiring | opt-in live smoke |
| Grounding quality | curated human rubric |
| Restart durability | completed result after process restart |

## 29. Definition of Done

MVP complete hanya jika seluruh item berikut dibuktikan:

- [ ] API dan worker berjalan sebagai process terpisah.
- [ ] PostgreSQL dan Redis local infrastructure healthy dan persistent.
- [ ] API bind ke loopback secara default.
- [ ] `POST /jobs` memerlukan Idempotency-Key.
- [ ] Duplicate/replayed submission mengikuti `200/202/409` contract.
- [ ] Job durable sebelum dispatch.
- [ ] Redis outage menghasilkan recoverable `PENDING`, bukan silent loss.
- [ ] Reconciler memulihkan stale non-terminal queue state.
- [ ] Worker memakai processing lease dan fencing token.
- [ ] Job lifecycle memuat `RETRYING` dan guarded transitions.
- [ ] Worker menjalankan three-stage sequential pipeline.
- [ ] Retry resume dari validated checkpoint terakhir.
- [ ] Real runtime menggunakan model call nyata.
- [ ] Structured AI output selalu divalidasi.
- [ ] Source Material dipersist sekali, bukan diduplikasi per step.
- [ ] Job Step menyimpan structured output dan nullable usage metadata.
- [ ] Study Guide menggunakan Source Material sebagai satu-satunya sumber fakta melalui prompt policy.
- [ ] Requested Topic mismatch dan mixed language menghasilkan warning.
- [ ] Empty concept/question arrays menghasilkan Quality Warning.
- [ ] Final result memiliki Result Schema Version.
- [ ] Pipeline Version dan Model Assignment dipin per Job.
- [ ] Structured failure tidak mengekspos secret/raw diagnostic data.
- [ ] `GET /jobs` cursor-paginated dan mengembalikan summary saja.
- [ ] `GET /jobs/:id` lean by default dan mendukung validated include projection.
- [ ] Factual progress tersedia tanpa fake percentage/ETA.
- [ ] Retention default 30 hari dan tidak menghapus active Job.
- [ ] Worker concurrency, timeout, lease, recovery, dan shutdown configurable.
- [ ] Unit, integration, E2E, dan opt-in live smoke tersedia.
- [ ] Restart dan Redis-loss recovery berhasil didemonstrasikan.
- [ ] Human quality rubric dijalankan pada curated examples.
- [ ] README membedakan current implementation dari target V2 secara jujur.

## 30. Deferred Evolution

Setelah MVP diterima, evaluasi secara terpisah:

- chunked/map-reduce pipeline untuk Source Material besar;
- audience/output-language override;
- attempt history dan accurate cumulative compute cost;
- evaluator/improve loop dengan bounded iterations;
- cancellation semantics;
- event streaming/SSE;
- public auth/multi-tenancy;
- cost estimation dan metrics dashboard;
- multiple Job kinds dan context boundaries.

Fitur tersebut tidak boleh ditambahkan dengan memperluas satu model/string generik secara diam-diam. Setiap perubahan harus memperbarui domain language, contract tests, versioning, dan ADR ketika trade-off memenuhi syarat.
