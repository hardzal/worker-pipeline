# Security & Architecture Review — AI Pipeline Agent

Tanggal review: 15 September 2026
Repository: `worker-pipeline`
Commit yang direview: `ba3946b83005473d016b68435e003bed84f0cff4` (`ba3946b update reamde files`)

## Executive summary

Struktur folder sudah cukup jelas untuk prototype: entrypoint API dan worker dipisahkan (`src/server.ts` dan `src/worker.ts`), pipeline dipisahkan dari queue, dan state job disimpan di PostgreSQL sementara BullMQ/Redis hanya membawa `jobId`.

Namun implementasi saat ini **belum aman untuk dipasang sebagai API publik atau layanan multi-tenant**. Temuan paling serius adalah seluruh route job tidak memiliki authentication/authorization. Akibatnya siapa pun yang dapat mencapai API dapat membuat pekerjaan LLM berbiaya, melihat daftar job, dan membaca input, output, serta detail step job lain.

Selain itu ada risiko denial-of-service/cost exhaustion, konfigurasi Redis tanpa password/TLS, sanitasi token yang dapat dilewati dengan format Authorization Bearer X, serta race condition antara PostgreSQL dan BullMQ yang dapat menghasilkan status job salah atau pemrosesan ganda.

**Verdict:**

- Prototype/local trusted network: cukup layak untuk eksperimen dengan catatan operasional.
- Internal service di belakang gateway yang sudah menangani auth, rate limit, dan network isolation: bisa dipakai setelah memastikan kontrol tersebut benar-benar aktif.
- Internet-facing API / multi-tenant production: **NO-GO sebelum temuan Critical dan High diperbaiki**.

## Scope dan metode

Diperiksa:

- 27 file TypeScript pada `src/`.
- 15 file test pada `tests/`.
- 9 file pada `prisma/`.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`.
- `.env.example`, `docker-compose.yml`, dan konfigurasi Prisma.
- Wiring API, queue, worker, AI provider, persistence, lifecycle, sanitasi error, dan struktur folder.

Verifikasi yang dijalankan:

- `pnpm run test` — lulus: 14 test files, 40 tests; 1 integration test di-skip karena environment integration tidak aktif.
- `pnpm run typecheck` — lulus.
- `pnpm run build` — lulus.
- `pnpm audit --prod --json` — tidak menemukan advisory (`0 info`, `0 low`, `0 moderate`, `0 high`, `0 critical`) pada dependency yang dipindai.
- `git diff --check` — lulus.
- `git status --short --branch` — bersih sebelum pembuatan laporan ini.

Open Code Review (`ocr`) juga dicoba dengan baseline root yang valid. Preview berhasil mengidentifikasi 47 file reviewable, tetapi tiga eksekusi review penuh berakhir `aborted`/timeout tanpa output dan tanpa file hasil. Karena itu **tidak ada temuan OCR yang diklaim sebagai fakta**; temuan di bawah berasal dari inspeksi source/config/test langsung dan verifikasi command di atas.

## Ringkasan severity

| Severity | Jumlah | Status umum |
|---|---:|---|
| Critical | 1 | Blocker untuk API publik/multi-tenant |
| High | 10 | Harus diperbaiki sebelum production exposure |
| Medium | 13 | Perlu ditangani sebelum skala/retensi data meningkat |
| Low | 2 | Hardening dan kualitas jangka panjang |

---

## Critical

### C-01 — Tidak ada authentication dan authorization pada route job

**Lokasi:**

- `src/app.ts:28-34`
- `src/modules/pipeline/pipeline.route.ts:12-56`
- `src/modules/jobs/job.route.ts:9-28`
- `prisma/schema.prisma:4-17,23-40`

`createApp()` langsung mendaftarkan route pipeline dan job tanpa middleware auth. Route berikut dapat dipanggil tanpa identitas atau ownership check:

- `POST /job`
- `GET /jobs`
- `GET /jobs/:id`

Data job menyimpan `input`, `result`, `error`, dan `JobStep.input/output`. Detail job mengembalikan input mentah dan seluruh step. Schema juga tidak memiliki `userId`, `tenantId`, atau owner scope yang dapat dipakai untuk membatasi query.

**Dampak:**

- Siapa pun yang mencapai API dapat menghabiskan quota/biaya AI dengan membuat job.
- `GET /jobs` dapat digunakan untuk enumerasi job ID dan status/result.
- `GET /jobs/:id` dapat membaca material pengguna, output model, dan step detail milik pengguna lain.
- Tidak ada isolasi tenant atau kontrol role.

**Perbaikan yang disarankan:**

1. Pasang authentication middleware di boundary HTTP; hanya `/health` yang boleh public bila memang diperlukan.
2. Derive `principalId`/`tenantId` dari token terverifikasi, bukan dari request body.
3. Tambahkan owner/tenant field dan index pada `Job`; filter `listJobs()` dan `getJob()` berdasarkan principal.
4. Terapkan authorization per resource dan role untuk endpoint detail/admin.
5. Tambahkan test negatif: tanpa credential `401`, tenant berbeda `404`/`403`, dan user tidak dapat membaca job milik user lain.
6. Jika auth sudah disediakan API gateway, tetap dokumentasikan dan enforce asumsi deployment itu; jangan menganggap jaringan internal sebagai authorization.

---

## High

### H-01 — Batas ukuran payload hanya divalidasi setelah seluruh request body dibaca

**Lokasi:** `src/modules/pipeline/pipeline.route.ts:12-27`, `src/modules/pipeline/pipeline.schema.ts:3-6`

Route memanggil `await context.req.json()` terlebih dahulu. Batas `content.max(50_000)` baru diterapkan setelah body JSON selesai dibaca dan diparse di memory. Dengan demikian request body yang jauh lebih besar dari 50 KB tetap dapat mengonsumsi memory dan CPU sebelum ditolak.

**Dampak:** request besar/chunked dari banyak koneksi dapat menyebabkan memory pressure, CPU exhaustion, atau process crash. Batas 50 KB pada string bukan body-size limit.

**Perbaikan yang disarankan:**

- Terapkan body-size limit di Hono atau reverse proxy sebelum parsing JSON.
- Tolak `Content-Length` yang melebihi batas dan tetap gunakan limit streaming untuk request chunked.
- Batasi ukuran setelah dekompresi bila proxy menerima compressed request.
- Uji payload besar, nested JSON, dan request tanpa `Content-Length`.

### H-02 — `GET /jobs` mengambil seluruh tabel tanpa pagination

**Lokasi:** `src/modules/jobs/job.route.ts:9-12`, `src/modules/jobs/job.repository.ts:106-108`

`listJobs()` memanggil `Job.all()` dan mengembalikan semua job sekaligus. Tidak ada limit, cursor, filter status, filter waktu, atau ordering yang dikendalikan API.

**Dampak:** latency dan memory meningkat linear terhadap jumlah job. Endpoint ini juga menjadi cara murah untuk memaksa query dan response besar. Masalah makin berat karena job menyimpan data yang terus bertambah tanpa mekanisme retention database.

**Perbaikan yang disarankan:**

- Gunakan cursor pagination dengan page size maksimum yang kecil.
- Tambahkan ordering stabil, misalnya `(createdAt, id)`, dan index yang sesuai.
- Sediakan filter status/waktu jika diperlukan.
- Batasi field pada list; jangan mengembalikan data yang tidak diperlukan.
- Tambahkan authorization scope sebelum pagination agar tenant tidak dapat menghitung atau membaca data tenant lain.

### H-03 — Transisi PostgreSQL dan enqueue BullMQ tidak atomic dan memiliki race condition

**Lokasi:**

- `src/modules/jobs/job.service.ts:23-49`
- `src/modules/jobs/job.repository.ts:47-55,77-95`
- `src/modules/jobs/job.processor.ts:30-46`

Alur saat ini adalah:

1. Insert job dengan status `PENDING`.
2. `queue.add(...)`.
3. Update job menjadi `QUEUED`.

Worker dapat mengambil job segera setelah langkah 2, ketika status masih `PENDING`. Worker tidak mensyaratkan status `QUEUED`, lalu memproses dan menulis `COMPLETED`. Setelah itu request API dapat menyelesaikan langkah 3 dan menimpa status menjadi `QUEUED`.

Jika langkah 3 gagal setelah queue berhasil, service menandai job `FAILED` dan mengembalikan `503`, tetapi job masih ada di BullMQ dan worker tetap dapat memprosesnya karena worker hanya skip status `COMPLETED`.

**Dampak:**

- Client menerima `503` tetapi pekerjaan sebenarnya tetap berjalan.
- Status dapat mundur dari `COMPLETED` menjadi `QUEUED`.
- Retry client dapat membuat job baru dan menggandakan biaya AI.
- Recovery dan monitoring tidak dapat mempercayai state PostgreSQL.

**Perbaikan yang disarankan:**

- Gunakan transactional outbox: tulis job dan outbox event dalam satu transaksi database, lalu dispatcher mengirim event ke BullMQ dengan job ID deterministik.
- Worker harus melakukan claim compare-and-set dari state yang diizinkan, bukan update bebas berdasarkan ID saja.
- Pastikan update completion/failure memiliki guard terhadap attempt/lease yang dimiliki worker.
- Sediakan reconciler untuk job `PENDING`/outbox yang tertinggal.
- Bedakan kegagalan enqueue dari kegagalan processing; jangan menandai `FAILED` jika queue record sudah berhasil dibuat tanpa mekanisme cancel/reconcile.

### H-04 — Timeout AI tidak membatalkan request provider yang masih berjalan

**Lokasi:** `src/modules/jobs/job.processor.ts:41-44,75-95`

`runWithTimeout()` hanya melakukan `reject()` setelah timer habis. Promise `dependencies.process(job)` tetap berjalan karena tidak ada `AbortController` atau cancellation signal yang diteruskan ke provider.

Setelah timeout, BullMQ dapat menjalankan retry sementara request AI sebelumnya masih aktif. Ini dapat membuat beberapa request provider berjalan bersamaan walaupun worker concurrency dikonfigurasi rendah.

**Dampak:** biaya provider berlipat, koneksi/socket bocor, concurrency efektif melebihi konfigurasi, dan hasil request lama dapat menyelesaikan proses setelah job dianggap gagal/retry.

**Perbaikan yang disarankan:**

- Ubah interface completion/provider agar menerima `AbortSignal`.
- Buat `AbortController` per attempt dan abort saat timeout.
- Pastikan SDK/provider benar-benar menghormati signal.
- Jangan menganggap worker slot bebas sebelum operasi eksternal dibatalkan atau selesai.
- Tambahkan test yang membuktikan provider menerima abort dan tidak ada operasi lama saat retry berikutnya dimulai.

### H-05 — Redis tidak memakai password/TLS dan konfigurasi compose mempublikasikan port

**Lokasi:**

- `src/config/redis.ts:5-24`
- `docker-compose.yml:19-30`

`RedisConnectionOptions` hanya memuat host, port, dan `maxRetriesPerRequest`. Tidak ada password, username/ACL, TLS, atau URL scheme. Compose menjalankan Redis tanpa password dan mempublikasikan `6380:6379`.

**Dampak:** pihak yang dapat mencapai port Redis dapat membaca atau memodifikasi queue BullMQ, memasukkan job palsu, menghapus job, atau mengganggu worker. Redis yang tidak terenkripsi juga memungkinkan credential/queue traffic disadap pada jaringan yang tidak tepercaya.

**Perbaikan yang disarankan:**

- Gunakan Redis ACL/password dan TLS untuk environment non-local.
- Validasi konfigurasi production agar credential dan TLS wajib aktif.
- Batasi network ACL/security group hanya ke API/worker.
- Bind port compose development ke loopback bila memang hanya untuk host lokal.
- Pisahkan credential lokal dan production; jangan mengandalkan port tersembunyi sebagai kontrol akses.

### H-06 — Sanitasi secret dapat dilewati oleh format Authorization Bearer X

**Lokasi:** `src/shared/sanitize.ts:4-5,60-67`

`SENSITIVE_TEXT_PATTERN` hanya menangkap satu token non-whitespace setelah nama field. Untuk header Authorization dengan scheme Bearer dan nilai rahasia setelah spasi, regex menangkap `Bearer` sebagai value yang disamarkan, tetapi nilai setelahnya tersisa di output. Fungsi ini dipakai untuk error yang disimpan ke database dan log worker/API.

**Dampak:** token/API credential yang muncul dalam error provider dapat masuk ke `Job.error`, log, atau observability pipeline.

**Perbaikan yang disarankan:**

- Redact seluruh nilai header authorization sampai delimiter yang aman, termasuk format Bearer X.
- Tambahkan redaction untuk URL query credential, JSON quoted values, dan pola provider yang digunakan.
- Lebih aman: jangan persist raw provider error; simpan error code dan correlation ID, detail hanya ke sink terproteksi.
- Tambahkan regression test untuk Authorization Bearer X, Basic Y, quoted JSON, newline, dan URL query.
- Review semua log/error path; sanitasi CLI juga saat ini tidak memakai helper yang sama.

### H-07 — Tidak ada admission control/rate limit untuk pekerjaan AI yang berbiaya

**Lokasi:**

- `src/modules/pipeline/pipeline.route.ts:12-56`
- `src/modules/pipeline/pipeline.schema.ts:3-6`
- `src/queue/job.queue.ts:7-18`
- `src/config/env.ts:22`

Ada batas panjang input dan retry default, tetapi tidak ada rate limit HTTP, quota per principal, queue length limit, per-tenant concurrency, atau cost budget. `WORKER_CONCURRENCY` dapat dikonfigurasi sampai 100, sementara satu job menjalankan tiga completion AI.

**Dampak:** setelah auth ditambahkan pun satu principal dapat menghabiskan quota LLM, Redis, database connection, dan worker capacity. Tanpa auth, risiko ini langsung menjadi abuse publik.

**Perbaikan yang disarankan:**

- Terapkan rate limit dan quota per principal/tenant.
- Batasi job aktif dan queue depth; kembalikan `429`/`503` secara deterministik saat penuh.
- Tambahkan per-tenant concurrency dan cost/token budget.
- Validasi retry policy agar kegagalan provider tidak menghasilkan biaya tak terkendali.
- Ukur prompt size dan durasi sebagai metrik, bukan hanya menyimpan hasil akhir.

### H-08 — Update lifecycle job tidak compare-and-set dan belum idempotent untuk duplicate delivery

**Lokasi:**

- `src/modules/jobs/job.processor.ts:36-46`
- `src/modules/jobs/job.repository.ts:77-95,130-180`
- `prisma/schema.prisma:23-40`

Worker hanya skip jika status sudah `COMPLETED`. Dua delivery/worker dapat sama-sama melihat state non-completed, membuat step yang sama, menjalankan tiga completion, lalu saling menimpa status/result. Index `(jobId, order)` tidak unique, sehingga duplicate step rows dapat tersimpan.

**Dampak:** duplicate model calls, hasil nondeterministik, biaya ganda, dan audit trail step yang salah. Ini menjadi lebih mungkin bila worker diskalakan atau operasi timeout masih hidup seperti H-04.

**Perbaikan yang disarankan:**

- Tambahkan lease/claim token dan conditional update (`WHERE status = ... AND lease = ...`).
- Buat completion/failure idempotent berdasarkan job ID dan attempt ownership.
- Tambahkan unique constraint `(jobId, order)` bila satu step per order memang invariant.
- Tetapkan kebijakan untuk stale `PROCESSING` jobs dan recovery lease.
- Uji duplicate delivery secara concurrent, bukan hanya sequential unit test.

---

### H-09 — Producer API dapat menunggu enqueue Redis tanpa batas aplikasi

**Lokasi:**

- `src/config/redis.ts:7-20`
- `src/config/runtime.ts:19-24`
- `src/modules/jobs/job.service.ts:25-33`
- `src/modules/pipeline/pipeline.route.ts:40-51`

Connection Redis memakai `maxRetriesPerRequest: null` untuk API queue dan tidak ada timeout aplikasi yang membungkus `queue.add()`. Error HTTP `503` hanya dikembalikan jika promise enqueue benar-benar reject.

**Dampak:** ketika Redis unavailable atau terus reconnect, request `POST /job` dapat menggantung lama dan menahan koneksi HTTP/resource API. Ini memperburuk queue flooding dan dapat membuat API tidak responsif.

**Perbaikan yang disarankan:**

- Pisahkan konfigurasi producer API dari worker.
- Gunakan bounded retry, `connectTimeout`, dan application-level enqueue timeout pada API.
- Fail fast dengan error publik `503` setelah deadline yang terukur.
- Tambahkan test Redis down/reconnect yang memastikan request selesai dalam batas waktu.

### H-10 — Error event Queue/Worker tidak ditangani secara eksplisit

**Lokasi:** `src/worker.ts:33-53`, `src/queue/job.worker.ts:11-19`, `src/config/runtime.ts:19-33`

Worker hanya memasang handler untuk event `completed` dan `failed`. Tidak ada handler eksplisit untuk `worker.on('error')`, `worker.on('stalled')`, atau error pada object queue yang dibuat di runtime.

**Dampak:** error koneksi Redis atau error internal BullMQ dapat tidak masuk ke observability terstruktur. Untuk event `error` pada EventEmitter, tidak adanya listener juga dapat menyebabkan proses Node keluar, tergantung event yang dipancarkan library.

**Perbaikan yang disarankan:**

- Tambahkan handler `error` untuk Worker dan Queue.
- Tambahkan metrik/alert untuk `stalled`, reconnect, failed processing, dan queue depth.
- Sertakan queue name, worker identity, job ID bila tersedia, dan correlation ID.
- Tambahkan restart policy deployment dan test Redis disconnect/reconnect.

---

## Medium

### M-01 — Error internal yang sudah disanitasi tetap dikembalikan ke caller melalui query API

**Lokasi:** `src/modules/jobs/job.repository.ts:227-236`, `src/modules/jobs/job.route.ts:9-27`

`toJobSummary()` mengembalikan `job.error` untuk list dan detail. Sanitasi saat ini hanya fokus pada beberapa nama secret dan panjang string; pesan database/provider/network dapat tetap berisi hostname, path, status internal, atau detail request.

**Dampak:** information disclosure dan kontrak API yang mengikat caller pada pesan internal.

**Perbaikan:** simpan `errorCode`, status publik, dan correlation ID; expose pesan generik. Detail diagnostik harus berada di log terproteksi dengan redaction yang kuat.

### M-02 — Compose menggunakan credential database plaintext dan port bind ke semua interface

**Lokasi:** `docker-compose.yml:5-10,19-25`

Password database development ditulis langsung di compose dan Postgres/Redis dipublikasikan tanpa host bind address. Ini dapat diterima untuk laptop disposable yang benar-benar terisolasi, tetapi berbahaya jika compose digunakan di shared host, CI runner, VM, atau dianggap sebagai deployment template.

**Perbaikan:**

- Gunakan `.env` lokal yang tidak di-commit untuk credential.
- Bind development port ke `127.0.0.1`.
- Jangan gunakan compose development sebagai production manifest.
- Tambahkan network isolation dan secret injection untuk deployment.

### M-03 — `OPENAI_API_BASE_URL` dapat berupa HTTP atau endpoint arbitrary

**Lokasi:** `src/config/env.ts:24-26`, `src/ai/client.ts:15-23`

Environment menerima base URL string tanpa validasi scheme/host. Client kemudian mengirim API key ke URL tersebut. Salah konfigurasi ke endpoint `http://` atau endpoint yang tidak tepercaya dapat membocorkan key.

**Perbaikan:**

- Parse URL saat startup.
- Wajibkan HTTPS untuk production; izinkan HTTP hanya untuk explicit local development.
- Gunakan allowlist host/provider bila arsitektur tidak membutuhkan arbitrary endpoint.
- Jangan menampilkan base URL lengkap dalam error/log jika dapat memuat credential query.

### M-04 — Retensi data PostgreSQL tidak dibatasi dan input/output material disimpan mentah

**Lokasi:** `prisma/schema.prisma:8-16,29-35`, `src/modules/jobs/job.repository.ts:30-38,123-126`

Queue memiliki `removeOnComplete`/`removeOnFail`, tetapi record PostgreSQL dan JobStep tidak memiliki TTL, purge job, retention policy, encryption policy, atau data classification. `GET /jobs/:id` mengembalikan raw input dan step data.

**Dampak:** material sensitif dan output LLM bertahan tanpa batas, memperbesar dampak kebocoran, backup exposure, dan kewajiban privacy/compliance.

Input dan final result job juga tidak melewati sanitasi yang sama dengan `JobStep`: input disimpan langsung pada create, result diteruskan langsung ke `markCompleted()`, dan detail query mengembalikan input/result tersebut. Ini sesuai bila material memang sengaja dipersist, tetapi harus diperlakukan sebagai data sensitif; sanitasi error saja tidak melindungi data utama.

**Perbaikan:**

- Tetapkan retention per status/tenant dan scheduled purge.
- Dokumentasikan apakah input/output boleh memuat PII/secret.
- Gunakan encryption at rest/database access controls dan backup controls.
- Redact atau hilangkan step input/output yang tidak diperlukan untuk operasi.
- Gabungkan dengan authorization C-01, karena retention tanpa access control belum cukup.

### M-05 — Submission tidak memiliki idempotency key

**Lokasi:** `src/modules/pipeline/pipeline.route.ts:12-42`, `src/modules/jobs/job.repository.ts:28-44`, `src/modules/jobs/job.service.ts:22-33`

Setiap request membuat ID baru melalui `randomUUID()`. API tidak membaca atau menyimpan idempotency key. Guard yang ada hanya melewati job yang sudah `COMPLETED`, bukan mencegah dua submission HTTP yang merepresentasikan permintaan logis yang sama.

**Dampak:** client yang retry setelah timeout atau response hilang dapat membuat job kedua dan memicu panggilan AI serta biaya provider dua kali.

**Perbaikan yang disarankan:**

- Terima header idempotency key.
- Simpan key dengan unique constraint dan mapping ke `Job`.
- Lakukan create job dan mapping key secara transactional.
- Kembalikan job yang sama untuk retry key yang sama.

### M-06 — Retry menghasilkan duplikasi `JobStep` tanpa identitas attempt

**Lokasi:** `src/pipeline/study-guide.pipeline.ts:15-37`, `src/pipeline/execute-step.ts:37-67`, `src/modules/jobs/job.repository.ts:130-180`, `prisma/schema.prisma:23-41`

Setiap retry menjalankan pipeline dari step pertama dan membuat `JobStep` baru. Schema step tidak memiliki `attemptNumber`/`attemptId`, sedangkan API hanya mengurutkan step berdasarkan `order`.

**Dampak:** detail job dapat berisi beberapa step dengan nama/order sama tanpa dapat membedakan attempt. Audit trail menjadi ambigu dan step yang sudah berhasil dapat dijalankan ulang.

**Perbaikan yang disarankan:**

- Tambahkan model attempt atau field `attemptNumber` pada `JobStep`.
- Jika workflow ingin resume, gunakan checkpoint/upsert per step.
- Tetapkan apakah API mengembalikan seluruh history atau hanya attempt terakhir.

### M-07 — Persistence failure dapat meninggalkan status job stale tanpa recovery path

**Lokasi:** `src/modules/jobs/job.processor.ts:48-57`, `src/modules/jobs/job.service.ts:39-50`, `src/pipeline/execute-step.ts:56-67`

Kegagalan `markFailed()` ditelan untuk mempertahankan error processing asli. Pola yang sama dipakai saat persistence error pada step dan saat cleanup enqueue error. Tidak ada retry persistence khusus, durable failure event, atau sweeper yang terlihat.

**Dampak:** BullMQ dapat mengetahui job gagal sementara PostgreSQL tetap menyimpan `PROCESSING`/`PENDING`. Setelah record queue dihapus, status durable dan error final dapat hilang dari sistem operasional.

**Perbaikan yang disarankan:**

- Tambahkan retry khusus untuk persistence failure.
- Sediakan sweeper untuk job `PROCESSING` yang stale dan job `PENDING` yang tidak memiliki outbox.
- Tambahkan metrik/alert saat update failure gagal.
- Gunakan durable failure event bila database utama sedang unavailable.

### M-08 — Material dan output antar-step belum memiliki boundary untrusted-data yang kuat

**Lokasi:** `src/ai/prompts.ts:4-5,16-24,34-44`, `src/pipeline/study-guide.pipeline.ts:15-37`

`topic` dan `content` dimasukkan langsung ke prompt. Output `analysis` dan `concepts` dari model kemudian dimasukkan kembali ke prompt tahap berikutnya. Instruksi hanya berupa text biasa dan tidak memberikan boundary yang tegas antara instruksi tepercaya dan material tidak tepercaya.

**Dampak:** material yang berisi instruksi seperti mengabaikan instruksi sebelumnya dapat memengaruhi output atau meracuni tahap berikutnya. Tidak ditemukan tool execution atau jalur langsung ke secret server; risiko yang terkonfirmasi adalah integritas/grounding output dan kemungkinan material terkirim ke provider.

**Perbaikan yang disarankan:**

- Tandai material sebagai untrusted data dengan delimiter konsisten.
- Gunakan instruction hierarchy/system message yang didukung provider.
- Jangan memasukkan credential/server secret ke prompt.
- Tambahkan grounding/provenance check sebelum output dipersist atau dikonsumsi downstream.
- Jika kelak menambah tool calling, gunakan allowlist, sandbox, dan approval boundary.

### M-09 — `/health` hanya liveness dan dapat false-positive saat dependency mati

**Lokasi:** `src/app.ts:24-26`, `src/server.ts:9-21`, `src/config/runtime.ts:19-33`

`GET /health` selalu mengembalikan `{ status: 'ok' }` tanpa mengecek PostgreSQL atau Redis. Runtime memang membuat kedua dependency tersebut, tetapi health handler tidak menggunakan koneksi atau timeout probe.

**Dampak:** jika endpoint ini dipakai sebagai readiness probe, load balancer dapat mengirim traffic ke instance yang tidak mampu enqueue atau query. Monitoring juga dapat menyatakan sehat ketika dependency utama mati.

**Perbaikan yang disarankan:**

- Pisahkan `/health/live` untuk process liveness dan `/health/ready` untuk dependency readiness.
- Probe PostgreSQL dan Redis dengan timeout pendek.
- Jangan membuat readiness request ikut menggantung saat dependency unavailable.

### M-10 — Shutdown tidak memiliki deadline atau fallback termination

**Lokasi:** `src/server.ts:50-61`, `src/worker.ts:71-75`

Shutdown menunggu `server.close()`, `runtime.close()`, atau `worker.close()` tanpa deadline. Worker juga menutup Prisma hanya setelah `worker.close()` selesai.

**Dampak:** deployment rolling/restart dapat menggantung jika koneksi atau operasi eksternal tidak selesai. Pada worker, graceful shutdown yang tidak bounded dapat memperlambat replacement dan mengganggu liveness.

**Perbaikan:**

- Gunakan shutdown deadline yang lebih pendek dari termination grace period orchestrator.
- Setelah deadline, log kondisi dan exit dengan aman sesuai kebijakan deployment.
- Pastikan active job di-lease/requeue dan tidak dianggap completed secara palsu.
- Tambahkan signal/lifecycle integration test.

### M-11 — Payload queue tidak divalidasi di runtime

**Lokasi:** `src/queue/job.worker.ts:7-19`, `src/modules/jobs/job.processor.ts:26-33`

`JobQueuePayload` hanya type TypeScript. Data Redis/BullMQ adalah input runtime, tetapi worker langsung membaca `queueJob.data.jobId` tanpa schema validation. Dengan Redis yang tidak terlindungi, payload malformed atau job ID arbitrary dapat memicu error dan query yang tidak diharapkan.

**Perbaikan:**

- Parse payload dengan schema runtime (`jobId` string UUID) sebelum akses database.
- Tolak payload invalid dengan error code yang tidak membocorkan isi payload.
- Pisahkan dead-letter handling dari retry processing biasa.

### M-12 — Dua lineage migration berada di repository

**Lokasi:**

- `prisma/legacy/migrations/...`
- `prisma/migrations/app/...`
- `prisma.config.ts`
- `prisma/schema.prisma`

Ada migration legacy SQL dan migration app/contract baru. Struktur ini berisiko membingungkan developer/deployment tool tentang migration source of truth, terutama ketika schema berkembang atau environment lama perlu di-upgrade.

**Perbaikan:**

- Tetapkan satu migration authority untuk deployment.
- Arsipkan lineage lama secara eksplisit atau dokumentasikan hubungan baseline-nya.
- Tambahkan CI check untuk memastikan schema/contract/migration konsisten.
- Uji upgrade dari database kosong dan database existing.

### M-13 — CLI masih mencetak pesan error mentah

**Lokasi:** `src/cli/index.ts:41-46`

CLI menggunakan `error.message`/`String(error)` langsung, tidak seperti API/worker yang menggunakan `sanitizeErrorMessage()`. Ini dapat mengekspos credential atau URL sensitif ke terminal log/CI artifact bila library provider memasukkannya ke error.

**Perbaikan:** gunakan sanitizer yang teruji untuk CLI, lalu gunakan error code publik dan correlation ID untuk automation. Pastikan sanitizer tidak dianggap sebagai pengganti secret isolation.

---

## Low

### L-01 — Sanitizer menganggap shared reference sebagai circular reference

**Lokasi:** `src/shared/sanitize.ts:7-8,41-48`

`WeakSet` tidak menghapus object setelah selesai diproses. Object yang direferensikan dua kali tetapi tidak circular akan menjadi `"[Circular]"` pada referensi kedua. Ini bukan bypass security utama, tetapi dapat merusak audit data/diagnostic output dan menyulitkan debugging.

**Perbaikan:** gunakan ancestor stack/path untuk mendeteksi siklus sebenarnya, atau hapus object dari set setelah traversal selesai.

### L-02 — Test coverage belum mengunci security contract dan failure races

**Lokasi:** `tests/unit/app.test.ts`, `tests/unit/pipeline-route.test.ts`, `tests/unit/job-service.test.ts`, `tests/unit/job-processor.test.ts`

Test saat ini memverifikasi happy path, validasi schema, retry, timeout, dan persistence dasar. Belum ada test untuk auth/tenant isolation, transport body limit, pagination, rate limit, Redis credential/TLS, duplicate delivery concurrent, enqueue-vs-mark race, abort provider, atau shutdown deadline.

**Perbaikan:** tambahkan contract/security tests sebelum perubahan production. Test harus mengecek bukan hanya status code, tetapi juga bahwa data tenant lain tidak pernah masuk query/result.

---

## Hal yang sudah baik

- API dan worker memiliki entrypoint terpisah: `src/server.ts` dan `src/worker.ts`.
- Pipeline step berada di `src/pipeline/` dan queue abstraction berada di `src/queue/`, sehingga boundary dasar mudah diikuti.
- `pipelineInputSchema` memiliki batas panjang topic/content dan output AI divalidasi dengan schema.
- Queue hanya membawa `jobId`; material tidak dikirim ulang di payload Redis.
- Job state dan step lifecycle dipersist ke PostgreSQL.
- Retry BullMQ memakai attempts dan exponential backoff.
- HTTP unhandled error mengembalikan pesan generik, bukan exception mentah.
- Foreign key `JobStep.jobId` memakai cascade delete.
- `pnpm audit --prod` pada dependency yang terpasang tidak menemukan advisory yang diketahui pada saat review.
- Tidak ditemukan credential real pada file yang diperiksa; contoh environment menggunakan placeholder.

Catatan: poin-poin positif ini tidak mengurangi C-01. Validation, sanitasi, dan jaringan internal bukan pengganti authentication/authorization.

## Penilaian struktur folder

Struktur saat ini cocok untuk satu pipeline dan satu deployment sederhana:

```text
src/
  server.ts                 API entrypoint
  worker.ts                 background worker entrypoint
  app.ts                    HTTP composition
  config/                   env, DB, Redis, runtime wiring
  modules/jobs/             job service, repository, routes, processor, types
  modules/pipeline/         pipeline agent, route, input schema
  pipeline/                 pipeline orchestration and steps
  queue/                    BullMQ queue/worker wrappers
  ai/                       model client, prompt, structured completion
  shared/                   sanitization helper
```

Masalah desain yang perlu diperhatikan:

1. `src/modules/jobs/job.repository.ts` mengimplementasikan repository create, worker lifecycle, step lifecycle, dan query sekaligus. Ini masih terbaca pada ukuran sekarang, tetapi state transition policy tersebar antara service, processor, dan repository. Pisahkan command/query atau minimal encapsulate state transition/CAS agar race lebih sulit dibuat.
2. `src/config/runtime.ts` menyatukan DB, queue, job service, dan API dependencies. Ini baik untuk composition root, tetapi lifecycle worker tidak melalui runtime yang sama; dokumentasikan ownership close/recovery dengan jelas.
3. Folder `prisma/legacy` dan `prisma/migrations/app` perlu satu source of truth yang eksplisit agar struktur migration tidak menjadi deployment hazard.
4. Belum ada boundary yang terlihat untuk auth, policy, rate limiting, retention, observability, dan tenant context. Jika requirement production mencakup multi-tenant, letakkan boundary tersebut dekat route/application layer, bukan tersebar di repository.

## Prioritas remediation

### P0 — sebelum API dapat diakses user/Internet

1. Perbaiki C-01: auth, authorization, ownership/tenant filter, dan schema owner.
2. Pasang body limit sebelum parsing, rate limit, quota, dan queue admission control (H-01, H-07).
3. Amankan Redis dengan ACL/password/TLS dan network isolation (H-05); tambahkan timeout producer serta error listener (H-09, H-10).
4. Perbaiki secret redaction dan jangan expose error internal (H-06, M-01, M-13).
5. Pastikan compose development tidak bind database/Redis ke semua interface (M-02).

### P1 — sebelum worker diskalakan atau menerima beban nyata

1. Ganti alur enqueue dengan transactional outbox/reconciler dan state claim yang atomic (H-03).
2. Tambahkan cancellation provider yang benar-benar menghentikan request saat timeout (H-04).
3. Terapkan idempotency/lease/CAS dan unique step invariant (H-08, M-05, M-06).
4. Tambahkan pagination/index/query limits pada job listing (H-02).
5. Validasi payload queue di runtime dan tambahkan grounding boundary untuk material (M-08, M-11).

### P2 — hardening operasional

1. Tambahkan bounded shutdown dan lifecycle tests (M-09, M-10).
2. Tetapkan retention, deletion, backup, dan data classification policy (M-04).
3. Rapikan migration authority dan CI schema consistency check (M-12).
4. Perbaiki shared-reference sanitizer dan tambah security regression suite (L-01, L-02).

## Kesimpulan

Folder structure dasar sudah memisahkan API, worker, pipeline, queue, dan persistence dengan cukup baik untuk prototype. Akan tetapi boundary security belum ada, dan lifecycle job belum atomic/idempotent. Dengan kondisi sekarang, sistem sebaiknya hanya dijalankan di jaringan development/trusted yang benar-benar terisolasi, menggunakan data non-sensitif, dan dengan Redis/PostgreSQL tidak dapat diakses pihak lain.

Untuk production, temuan C-01 dan kelompok H-01 sampai H-10 harus dianggap sebagai release blockers, bukan sekadar improvement dokumentasi.
