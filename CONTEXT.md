# AI Pipeline Job Processing

Konteks ini mencakup permintaan pembuatan study guide beserta state dan hasil pemrosesan AI asinkronnya.

## Language

**Client**:
Consumer tepercaya pada mesin atau jaringan internal yang membuat dan membaca Job. MVP tidak membedakan user, owner, atau tenant.
_Avoid_: Public User, Tenant, Job Owner

**Job**:
Satu maksud client untuk menghasilkan study guide yang dilacak sebagai satu unit durable. Pengiriman ulang dengan Submission Identity yang sama tetap merujuk pada Job yang sama; retry pemrosesan tidak membentuk riwayat attempt tersendiri.
_Avoid_: Queue Job, Task, Job Attempt

**Submission Identity**:
Identitas yang diberikan client untuk membedakan satu maksud pembuatan Job dari maksud lainnya. Identitas yang sama tidak boleh digunakan untuk materi sumber yang berbeda.
_Avoid_: Job ID, BullMQ Job ID, Content Hash

**Job Summary**:
Representasi ringkas sebuah Job untuk daftar paginated, berisi identitas, status, waktu, dan ringkasan hasil tanpa Source Material, Study Guide lengkap, atau Job Steps.
_Avoid_: Job Detail, Full Result

**Job Detail**:
Representasi satu Job untuk polling, berisi state dan metadata inti secara default. Source Material, Study Guide lengkap, dan Job Steps hanya disertakan melalui explicit projection.
_Avoid_: Job Summary, Always-Expanded Response

**Job Step**:
Checkpoint canonical untuk satu tahap pipeline pada sebuah Job. Job Step memuat structured business value tervalidasi, status/durasi terbaru, serta model/request/token metadata jika tersedia; tidak menyimpan salinan Source Material, transcript mentah provider, atau riwayat attempt.
_Avoid_: Log, Attempt Step, Provider Transcript

**Pipeline Version**:
Identitas definisi pipeline yang dipakai oleh sebuah Job, mencakup urutan tahap, prompt, dan schema output. Checkpoint hanya dapat digunakan kembali oleh Pipeline Version yang sama.
_Avoid_: Model Assignment, Application Version

**Model Assignment**:
Identitas model AI yang dipilih ketika Job dibuat dan tetap sama selama antrean serta retry. Model Assignment tidak mencakup credential provider.
_Avoid_: Pipeline Version, API Key, Current Worker Default

**Result Schema Version**:
Identitas bentuk persisted Study Guide yang menentukan field dan struktur datanya. Result Schema Version terpisah dari Pipeline Version dan Model Assignment.
_Avoid_: Pipeline Version, Model Assignment, Database Migration Version

**Retrying**:
Keadaan Job ketika upaya pemrosesan terbaru gagal, tetapi Job masih memenuhi syarat untuk dicoba kembali. Job yang Retrying belum dianggap gagal secara final.
_Avoid_: Failed, Processing, Requeued

**Terminal Job**:
Job yang telah `COMPLETED` atau final `FAILED` dan tidak akan diproses kembali secara otomatis. Masa retention mulai dihitung ketika Job menjadi terminal.
_Avoid_: Retrying Job, Queued Job, Archived Job

**Completed**:
Keadaan terminal ketika seluruh tahap pipeline selesai dan hasil memenuhi structured schema. Completed tidak menjamin semua koleksi hasil berisi item atau kualitas model sempurna.
_Avoid_: Quality Approved, Human Approved

**Quality Warning**:
Indikasi non-fatal bahwa hasil valid secara struktur tetapi mungkin kurang berguna, misalnya tidak memiliki key concept atau pertanyaan. Quality Warning tidak mengubah status Completed.
_Avoid_: Pipeline Error, Failed Step

**Job Failure**:
Representasi kegagalan yang aman untuk disimpan dan dibaca Client, terdiri dari stable code, safe message, failed step, dan sifat retryable. Job Failure bukan stack trace atau raw provider response.
_Avoid_: Exception Dump, Provider Error Body, Quality Warning

**Job Dispatch**:
Proses menyerahkan sebuah Job yang sudah tersimpan ke antrean pemrosesan. Kegagalan Job Dispatch bukan kegagalan pipeline karena pemrosesan belum dimulai.
_Avoid_: Job Processing, Pipeline Execution

**Job Recovery**:
Proses merekonstruksi scheduling untuk Job non-terminal dari state durable ketika queue state hilang atau kedaluwarsa. Job Recovery tidak mengubah Terminal Job.
_Avoid_: Processing Retry, Manual Resubmission

**Pending**:
Keadaan Job yang sudah diterima dan tersimpan secara durable, tetapi Job Dispatch belum berhasil. Pending Job tetap dimiliki sistem dan akan direkonsiliasi.
_Avoid_: Queued, Failed, Draft

**Study Guide**:
Hasil pembelajaran yang dihasilkan pipeline hanya dari fakta dalam Source Material dan ditulis pada level Source Difficulty yang diinfer. Study Guide boleh menyusun ulang dan meringkas materi, tetapi tidak boleh memperkenalkan klaim eksternal.
_Avoid_: AI Response, Output Blob

**Source Material**:
Materi `content` yang diberikan client dan menjadi satu-satunya sumber fakta bagi Study Guide. Requested Topic memberi konteks, tetapi bukan sumber fakta tambahan.
_Avoid_: Prompt, External Knowledge, Reference Data

**Requested Topic**:
Label topik yang diberikan client untuk menyatakan intent awal. Requested Topic dapat berbeda dari Detected Subject dan tidak mengalahkan fakta dalam Source Material.
_Avoid_: Source of Truth, Detected Subject

**Detected Subject**:
Subjek yang diinfer model dari Source Material. Jika berbeda secara bermakna dari Requested Topic, Study Guide mengikuti Detected Subject dan memuat Quality Warning.
_Avoid_: Requested Topic, User Preference

**Source Difficulty**:
Klasifikasi `beginner`, `intermediate`, atau `advanced` yang diinfer model dari Source Material dan menjadi level penulisan Study Guide.
_Avoid_: Client Preference, Audience Override

**Source Language**:
Bahasa dominan yang diinfer dari Source Material dan digunakan oleh seluruh Study Guide. Materi multibahasa memakai bahasa dominan serta menghasilkan Quality Warning.
_Avoid_: Requested Topic Language, Server Locale

**Key Concept**:
Unit pengetahuan penting yang diekstrak dari Source Material, terdiri dari nama, definisi, dan alasan pentingnya konsep tersebut. Bentuk yang sama dipakai pada checkpoint extraction dan Study Guide.
_Avoid_: Description, Topic, Keyword
