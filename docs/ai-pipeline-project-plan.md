# AI Pipeline Agent — Detailed Project Plan

## 1. Project Overview

Build a production-style asynchronous Pipeline Agent using:

- **Hono** for the HTTP API
- **BullMQ** for background job processing
- **Redis** as the BullMQ backend
- **PostgreSQL** as the durable source of truth
- **Prisma 8** as the ORM
- **anvia.dev / real AI model calls** inside the worker
- **TypeScript** for application code

The Pipeline Agent accepts a real input through HTTP or CLI, delegates internally to the JobService for a durable job record and queue submission, processes the input through an AI pipeline in a background worker, saves the final generated output, and exposes status/result endpoints separately.

The project should also record meaningful pipeline steps so the processing flow can be inspected later.

---

# 2. Main Goal

The system must support this flow:

```text
Client / CLI
  |
  | HTTP POST /job or CLI command
  v
Pipeline Agent
  |
  | validate input
  | invoke internal JobService
  v
JobService
  |-- create Job in PostgreSQL
  |-- enqueue job ID in BullMQ / Redis
  v
PostgreSQL <------> BullMQ / Redis
  |
  v
Background Worker
  |
  | load input from PostgreSQL
  | run real AI pipeline
  | persist step logs
  | save final output
  v
PostgreSQL
  |
  +----------------------+
  |                      |
  v                      v
GET /jobs          GET /jobs/:id
```

The main rule is:

> **BullMQ handles execution scheduling. PostgreSQL stores durable application state and final results.**

Redis should not be treated as the permanent result database.

---

# 3. Recommended AI Pipeline

Use a **Study Guide Generator** because it naturally demonstrates multiple meaningful processing steps.

## Input

Example:

```json
{
  "topic": "Model Context Protocol",
  "content": "MCP is an open protocol that standardizes how AI applications connect to external tools and data sources..."
}
```

## Pipeline Pattern

The core pattern is:

> **Sequential Pipeline / Prompt Chaining**

```text
Input
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

This is preferable for the base assignment because it is easy to reason about, easy to persist, and does not add unnecessary control-flow complexity.

An optional future extension can add an **Evaluate-Improve** stage.

---

# 4. Expected Final Output

The final result must be an actual generated output, not merely metadata.

Example:

```json
{
  "title": "Model Context Protocol Study Guide",
  "summary": "MCP standardizes how AI applications communicate with external systems.",
  "keyConcepts": [
    {
      "name": "MCP Host",
      "description": "The application that manages MCP clients."
    },
    {
      "name": "MCP Client",
      "description": "Maintains a connection with an MCP server."
    },
    {
      "name": "MCP Server",
      "description": "Exposes tools, resources, or prompts."
    }
  ],
  "questions": [
    {
      "question": "What problem does MCP solve?",
      "answer": "It standardizes communication between AI applications and external systems."
    }
  ]
}
```

This complete object is stored in:

```text
Job.result
```

---

# 5. Functional Requirements

## 5.1 POST `/job`

Responsibilities:

1. Validate request body.
2. Create a durable job record in PostgreSQL.
3. Store the original input.
4. Add the job to BullMQ.
5. Update status to `QUEUED`.
6. Return HTTP `202 Accepted`.

Example response:

```json
{
  "id": "job-uuid",
  "status": "QUEUED"
}
```

---

## 5.2 GET `/jobs`

Responsibilities:

1. Fetch all jobs from PostgreSQL.
2. Return each job's current status.
3. Return the saved result when available.
4. Return `result: null` if the job is not completed.

Example:

```json
[
  {
    "id": "job-001",
    "status": "COMPLETED",
    "result": {
      "title": "MCP Study Guide",
      "summary": "..."
    }
  },
  {
    "id": "job-002",
    "status": "PROCESSING",
    "result": null
  }
]
```

---

## 5.3 GET `/jobs/:id`

Responsibilities:

1. Look up one job by ID.
2. Return `404` when missing.
3. Return status.
4. Return final generated result if completed.
5. Return `result: null` if not ready.
6. Optionally include pipeline step details.

Example:

```json
{
  "id": "job-001",
  "status": "COMPLETED",
  "input": {
    "topic": "Model Context Protocol",
    "content": "..."
  },
  "result": {
    "title": "Model Context Protocol Study Guide",
    "summary": "...",
    "keyConcepts": [],
    "questions": []
  },
  "steps": []
}
```

---

# 6. Non-Functional Requirements

The project should satisfy the following:

- Background processing must not block the API request.
- Job results must survive API restarts.
- Real model calls must be used.
- AI responses must not be mocked.
- Job status must be durable.
- Queue payloads should remain small.
- Worker failures must be persisted.
- Job execution must support retries.
- Step duration should be measurable.
- Input/output logs should be inspectable.
- Sensitive fields should be redacted before logging.
- The system should have clear boundaries between API, queue, worker, pipeline, AI client, and persistence layers.

---

# 7. Job Lifecycle

Recommended statuses:

```text
PENDING
   |
   v
QUEUED
   |
   v
PROCESSING
   |
   +-------> COMPLETED
   |
   +-------> FAILED
```

## Meaning

### `PENDING`

The database record exists, but enqueueing has not completed yet.

### `QUEUED`

The BullMQ job has been created successfully.

### `PROCESSING`

A worker has started executing the job.

### `COMPLETED`

The AI pipeline finished and the result was saved.

### `FAILED`

The pipeline or enqueue operation failed.

---

# 8. Database Design

## 8.1 Job Table

Purpose:

- Store the original input.
- Track durable state.
- Store the actual generated result.
- Record failures.
- Link the database job to BullMQ.

Suggested Prisma model:

```prisma
model Job {
  id          String    @id @default(uuid())
  type        String
  status      JobStatus @default(PENDING)

  input       Json
  result      Json?
  error       String?

  bullJobId   String?   @unique

  createdAt   DateTime  @default(now())
  queuedAt    DateTime?
  startedAt   DateTime?
  completedAt DateTime?
  updatedAt   DateTime  @updatedAt

  steps       JobStep[]
}

enum JobStatus {
  PENDING
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}
```

---

## 8.2 JobStep Table

Purpose:

- Record every meaningful pipeline stage.
- Capture step input/output.
- Record execution time.
- Persist failures.
- Make debugging easier.

Suggested Prisma model:

```prisma
model JobStep {
  id          String        @id @default(uuid())

  jobId       String
  job         Job           @relation(fields: [jobId], references: [id], onDelete: Cascade)

  name        String
  order       Int
  status      JobStepStatus @default(PENDING)

  input       Json?
  output      Json?
  error       String?

  startedAt   DateTime?
  completedAt DateTime?
  durationMs  Int?

  createdAt   DateTime      @default(now())

  @@index([jobId])
  @@index([jobId, order])
}

enum JobStepStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

---

# 9. Queue Design

Use one queue:

```text
study-guide
```

Queue payload:

```json
{
  "jobId": "database-job-id"
}
```

Avoid putting the whole article/input inside Redis when the input already exists in PostgreSQL.

Benefits:

- smaller queue payloads
- PostgreSQL remains the source of truth
- retries always reload the canonical input
- easier debugging
- less duplication

---

# 10. Queue Configuration

Suggested BullMQ options:

```ts
{
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000
  },
  removeOnComplete: {
    age: 3600
  },
  removeOnFail: {
    age: 86400
  }
}
```

Use the database job ID as the BullMQ `jobId` when possible.

Example:

```ts
await queue.add(
  "generate-study-guide",
  { jobId: job.id },
  {
    jobId: job.id,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000
    }
  }
);
```

---

# 11. API Request Flow

## Step 1 — Validate

Validate:

- `topic`
- `content`

Example schema:

```ts
const createJobSchema = z.object({
  topic: z.string().min(3).max(200),
  content: z.string().min(50).max(50_000)
});
```

---

## Step 2 — Create Database Record

```text
status = PENDING
```

Store:

```json
{
  "topic": "...",
  "content": "..."
}
```

---

## Step 3 — Enqueue BullMQ Job

Enqueue only:

```json
{
  "jobId": "..."
}
```

---

## Step 4 — Update Database

If enqueue succeeds:

```text
status = QUEUED
```

If enqueue fails:

```text
status = FAILED
error = enqueue error
```

---

## Step 5 — Return HTTP 202

```json
{
  "id": "...",
  "status": "QUEUED"
}
```

---

# 12. Background Worker Flow

Worker processing:

```text
BullMQ job received
       |
       v
Read Job from PostgreSQL
       |
       v
status = PROCESSING
       |
       v
Run AI pipeline
       |
       +--> Step 1: Analyze Material
       |
       +--> Step 2: Extract Concepts
       |
       +--> Step 3: Generate Study Guide
       |
       v
Save final result
       |
       v
status = COMPLETED
```

If any pipeline step fails:

```text
step = FAILED
job = FAILED
error persisted
exception rethrown
BullMQ retry policy applied
```

---

# 13. AI Pipeline Detail

## Step 1 — Analyze Material

Input:

```json
{
  "topic": "...",
  "content": "..."
}
```

Output:

```json
{
  "subject": "...",
  "difficulty": "beginner",
  "learningObjectives": [
    "..."
  ],
  "importantSections": [
    "..."
  ]
}
```

Purpose:

- understand the material
- determine scope
- identify learning objectives

---

## Step 2 — Extract Key Concepts

Input:

```json
{
  "originalContent": "...",
  "analysis": {}
}
```

Output:

```json
{
  "concepts": [
    {
      "name": "...",
      "definition": "...",
      "importance": "..."
    }
  ]
}
```

Purpose:

- extract meaningful learning units
- normalize them into structured data

---

## Step 3 — Generate Study Guide

Input:

```json
{
  "topic": "...",
  "analysis": {},
  "concepts": []
}
```

Output:

```json
{
  "title": "...",
  "summary": "...",
  "keyConcepts": [],
  "questions": []
}
```

Purpose:

- generate the final persisted result

---

# 14. Pipeline Step Wrapper

Every pipeline stage should use one reusable execution wrapper.

Concept:

```ts
executeStep({
  jobId,
  name,
  order,
  input,
  execute
})
```

Responsibilities:

1. Create the `JobStep`.
2. Mark it `PROCESSING`.
3. Store sanitized input.
4. Execute the real step.
5. Store output.
6. Calculate duration.
7. Mark `COMPLETED`.
8. On error:
   - persist error
   - mark `FAILED`
   - rethrow

Pseudo implementation:

```ts
async function executeStep<TInput, TOutput>({
  jobId,
  name,
  order,
  input,
  execute
}: ExecuteStepOptions<TInput, TOutput>): Promise<TOutput> {
  const startedAt = Date.now();

  const step = await prisma.jobStep.create({
    data: {
      jobId,
      name,
      order,
      status: "PROCESSING",
      input: sanitize(input),
      startedAt: new Date()
    }
  });

  try {
    const output = await execute();

    await prisma.jobStep.update({
      where: { id: step.id },
      data: {
        status: "COMPLETED",
        output: sanitize(output),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt
      }
    });

    return output;
  } catch (error) {
    await prisma.jobStep.update({
      where: { id: step.id },
      data: {
        status: "FAILED",
        error: getErrorMessage(error),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt
      }
    });

    throw error;
  }
}
```

---

# 15. Project Structure

Recommended folder layout:

```text
src/
├── app.ts
├── server.ts
├── cli/
│   ├── index.ts
│   └── args.ts
│
├── config/
│   ├── env.ts
│   ├── prisma.ts
│   ├── redis.ts
│   └── runtime.ts
│
├── modules/
│   ├── pipeline/
│   │   ├── pipeline.agent.ts
│   │   ├── pipeline.route.ts
│   │   └── pipeline.schema.ts
│   └── jobs/
│       ├── job.service.ts
│       ├── job.repository.ts
│       ├── job.mapper.ts
│       └── job.types.ts
│
├── queue/
│   ├── job.queue.ts
│   └── job.worker.ts
│
├── pipeline/
│   ├── study-guide.pipeline.ts
│   ├── execute-step.ts
│   └── steps/
│       ├── analyze-material.step.ts
│       ├── extract-concepts.step.ts
│       └── generate-study-guide.step.ts
│
├── ai/
│   ├── client.ts
│   ├── prompts.ts
│   └── schemas.ts
│
├── shared/
│   ├── errors/
│   ├── logger/
│   ├── utils/
│   └── types/
│
└── worker.ts

prisma/
├── schema.prisma          # active Prisma 8 contract
├── migrations/             # active Prisma 8 migration graph
├── legacy/
│   ├── schema.prisma      # legacy Prisma 7 source
│   └── migrations/        # legacy migration history

generated/prisma/
├── contract.json
└── contract.d.ts

docker/
└── ...

docker-compose.yml
.env.example
package.json
tsconfig.json
README.md
```

---

# 16. Module Responsibilities

## `modules/pipeline`

Owns:

- public Pipeline Agent use case
- HTTP route adapter for `POST /job`
- shared input schema for HTTP and CLI
- orchestration boundary into internal `JobService`

It should not contain queue or database implementation details.

---

## `modules/jobs`

Owns:

- internal job application service
- durable job persistence
- enqueue command to BullMQ
- database retrieval and state transitions

It is not a public input API and should not contain AI logic.

---

## `queue`

Owns:

- BullMQ queue creation
- worker registration
- retry configuration

It should not contain route logic.

---

## `pipeline`

Owns:

- processing sequence
- step orchestration
- step logging

It should not know about HTTP.

---

## `ai`

Owns:

- AI provider configuration
- prompt definitions
- structured output validation
- model call implementation

---

## `config`

Owns:

- environment variables
- Prisma initialization
- Redis initialization

---

# 17. API Contract

## POST `/job`

This is the public Pipeline Agent boundary. It is not a direct public JobService endpoint.

### Request

```json
{
  "topic": "Model Context Protocol",
  "content": "..."
}
```

### Success

Status:

```text
202 Accepted
```

Body:

```json
{
  "id": "...",
  "status": "QUEUED"
}
```

### Validation Error

Status:

```text
400 Bad Request
```

Example:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request body",
  "details": []
}
```

---

# 18. GET `/jobs`

Status:

```text
200 OK
```

Response:

```json
[
  {
    "id": "...",
    "type": "STUDY_GUIDE",
    "status": "COMPLETED",
    "result": {},
    "error": null,
    "createdAt": "...",
    "completedAt": "..."
  }
]
```

---

# 19. GET `/jobs/:id`

Status:

```text
200 OK
```

Response:

```json
{
  "id": "...",
  "type": "STUDY_GUIDE",
  "status": "COMPLETED",
  "input": {},
  "result": {},
  "error": null,
  "steps": [
    {
      "name": "analyze-material",
      "order": 1,
      "status": "COMPLETED",
      "input": {},
      "output": {},
      "durationMs": 1250
    }
  ]
}
```

Missing job:

```text
404 Not Found
```

```json
{
  "error": "JOB_NOT_FOUND",
  "message": "Job was not found"
}
```

---

# 20. Error Handling Strategy

Errors should be categorized.

## Validation Failure

Handled by API.

```text
400
```

No BullMQ job is created.

---

## Enqueue Failure

Database job already exists.

Update:

```text
status = FAILED
```

Persist:

```text
error = queue error
```

---

## AI Provider Failure

Worker:

1. records failed step
2. throws error
3. BullMQ retries
4. if retries are exhausted, the job remains failed

---

## Invalid AI Structured Output

Treat as a pipeline failure.

Validate model outputs before continuing.

Recommended:

```text
AI response
  |
  v
Zod validation
  |
  +--> valid   -> continue
  |
  +--> invalid -> fail step
```

---

## Database Failure

Do not pretend the step succeeded.

Prefer failing the execution so BullMQ can retry where appropriate.

---

# 21. Retry Strategy

Recommended:

```text
attempts = 3
```

Backoff:

```text
1s
2s
4s
```

Do not retry:

- validation errors
- unsupported input
- known permanent configuration errors

Retry:

- temporary provider failures
- network errors
- temporary Redis problems
- transient AI API failures

---

# 22. Idempotency Considerations

Using the database job ID as BullMQ `jobId` helps prevent accidental duplicate queue jobs.

Worker logic should also inspect the current job state.

For example:

```text
if Job.status == COMPLETED
    do not process again
```

Optional:

```text
if result already exists
    return existing result
```

This becomes especially useful when workers restart or BullMQ retries.

---

# 23. Logging and Observability

Use two layers.

## Application Logs

Examples:

```text
job.created
job.queued
job.processing
job.completed
job.failed
```

Fields:

```json
{
  "jobId": "...",
  "event": "job.processing",
  "timestamp": "..."
}
```

---

## Pipeline Step Logs

Stored in PostgreSQL:

```text
analyze-material
extract-concepts
generate-study-guide
```

Each includes:

- input
- output
- duration
- status
- error

---

# 24. Sensitive Data Handling

Before storing step input/output, sanitize sensitive values.

Never persist:

- API keys
- Authorization headers
- passwords
- access tokens
- refresh tokens
- provider credentials

Example utility:

```ts
sanitize({
  authorization: "Bearer secret",
  prompt: "..."
})
```

Becomes:

```json
{
  "authorization": "[REDACTED]",
  "prompt": "..."
}
```

---

# 25. Environment Variables

Suggested `.env.example`:

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_pipeline

REDIS_HOST=localhost
REDIS_PORT=6379

ANVIA_API_KEY=
AI_MODEL=
```

If the provider requires an API URL:

```env
ANVIA_BASE_URL=
```

---

# 26. Local Development Environment

Use Docker Compose for PostgreSQL and Redis.

Suggested services:

```text
postgres
redis
```

Optional later:

```text
api
worker
```

Development mode can run API and worker separately:

```bash
npm run dev:api
npm run dev:worker
```

This clearly demonstrates that the background processor is a separate process.

---

# 27. Suggested Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "dev:api": "tsx watch src/server.ts",
    "dev:worker": "tsx watch src/worker.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "start:worker": "node dist/worker.js",
    "prisma:contract:emit": "prisma contract emit",
    "prisma:db:verify": "prisma db verify",
    "prisma:db:migrate": "prisma db migrate",
    "prisma:migration:plan": "prisma migration plan",
    "test": "vitest"
  }
}
```

---

# 28. Implementation Milestones

## Phase 1 — Project Bootstrap

Tasks:

- initialize TypeScript project
- install Hono
- install Prisma
- install BullMQ
- install Redis client/dependencies
- install validation library
- configure environment variables
- create Hono health endpoint

Acceptance criteria:

```http
GET /health
```

returns:

```json
{
  "status": "ok"
}
```

---

## Phase 2 — Infrastructure

Tasks:

- create PostgreSQL container
- create Redis container
- connect Prisma
- connect BullMQ
- create shared Redis connection
- verify Redis connection

Acceptance criteria:

- Prisma can query PostgreSQL.
- Queue can accept a simple test job.
- Worker can consume that job.

---

## Phase 3 — Database Schema

Tasks:

- create `Job`
- create `JobStep`
- create enums
- generate migration
- run migration

Acceptance criteria:

- records can be created and queried
- relations work correctly

---

## Phase 4 — Pipeline Agent Input Boundary

Tasks:

- define shared Pipeline Agent input schema
- add HTTP `POST /job` adapter
- add CLI input/output adapter
- invoke internal JobService from the Pipeline Agent
- insert PENDING record
- enqueue BullMQ job
- update status to QUEUED
- return `202` from HTTP and JSON output from CLI

Acceptance criteria:

```http
POST /job
```

via the Pipeline Agent creates both:

- PostgreSQL job record
- BullMQ queue job

The caller submits through the public `/job` boundary; `JobService` remains internal and owns persistence/enqueue.

---

## Phase 5 — Worker

Status: **Completed**. Phase 6 replaced the temporary processor with the real AI pipeline.

Tasks:

- create worker process
- load Job using `jobId`
- update status to PROCESSING
- implement temporary test processor (completed during Phase 5, removed during Phase 6)
- save result
- set COMPLETED
- persist errors

Acceptance criteria:

```text
POST /job
-> worker executes
-> Job becomes COMPLETED
```

Before connecting the real AI provider, use a deterministic local function only during development.

Remove the fake implementation before final submission.

---

## Phase 6 — Real AI Integration

Status: **Implemented and smoke-tested with real model calls**.

Tasks:

- configure AI client
- create model call helper
- define structured response schemas
- implement analyze step
- implement concept extraction step
- implement final study-guide step
- validate AI responses

Acceptance criteria:

The final result is generated from the actual input through real model calls.

Implemented as three sequential structured calls:

```text
analyze material
  -> extract concepts
  -> generate study guide
```

---

## Phase 7 — Step Logging

Status: **Completed**. `executeStep` now persists sanitized input/output, lifecycle status, duration, and sanitized errors through the `JobStep` repository contract. The real API → queue → worker smoke test produced three `COMPLETED` `JobStep` rows for one completed job.

Tasks:

- create `executeStep`
- record step input
- record step output
- record duration
- record status
- persist errors
- sanitize data

Acceptance criteria:

A completed job contains at least three persisted steps.

---

## Phase 8 — GET Endpoints

Tasks:

- implement `GET /jobs`
- implement `GET /jobs/:id`
- include result
- return null before completion
- handle 404
- optionally include steps

Acceptance criteria:

All assignment endpoints work correctly.

---

## Phase 9 — Failure Handling

Test:

- invalid input
- missing job
- unavailable Redis
- AI timeout
- invalid AI JSON
- worker failure

Acceptance criteria:

Failures are visible in PostgreSQL instead of disappearing silently.

---

## Phase 10 — Restart Persistence Test

Required scenario:

1. Start API and worker.
2. Create a job.
3. Wait until `COMPLETED`.
4. Stop API.
5. Restart API.
6. Call:

```http
GET /jobs/:id
```

Expected:

The previously generated result is still available.

This proves PostgreSQL is the durable result store.

---

# 29. Testing Plan

## Unit Tests

Focus on:

- validation schema
- `executeStep`
- job service
- error normalization
- sanitization
- AI response validation

---

## Integration Tests

Test:

```text
API -> PostgreSQL
```

and:

```text
Worker -> PostgreSQL
```

Also verify:

```text
Job
  |
  +--> JobStep
```

relations.

---

## End-to-End Test

Scenario:

```text
POST /job
  |
  v
202 QUEUED
  |
  v
worker processes
  |
  v
GET /jobs/:id
  |
  v
COMPLETED + real result
```

---

# 30. Important Test Cases

## Valid Job

Expected:

```text
202 -> QUEUED -> PROCESSING -> COMPLETED
```

---

## Invalid Request

Input:

```json
{
  "topic": "",
  "content": "short"
}
```

Expected:

```text
400
```

No job is queued.

---

## Job Not Found

```http
GET /jobs/random-id
```

Expected:

```text
404
```

---

## Job Still Running

Expected:

```json
{
  "status": "PROCESSING",
  "result": null
}
```

---

## Job Failure

Expected:

```json
{
  "status": "FAILED",
  "result": null,
  "error": "..."
}
```

---

## Persistence

After API restart:

```text
GET /jobs/:id
```

still returns the generated result.

---

# 31. Demo Flow

The final demo should show the entire lifecycle.

## 1. Start Infrastructure

```bash
docker compose up -d
```

---

## 2. Start API

```bash
npm run dev:api
```

---

## 3. Start Worker

```bash
npm run dev:worker
```

---

## 4. Create Job

```http
POST /job
```

Expected:

```json
{
  "id": "...",
  "status": "QUEUED"
}
```

---

## 5. Immediately Fetch Job

```http
GET /jobs/:id
```

Likely:

```json
{
  "status": "PROCESSING",
  "result": null
}
```

---

## 6. Fetch Again

Expected:

```json
{
  "status": "COMPLETED",
  "result": {
    "title": "...",
    "summary": "...",
    "keyConcepts": [],
    "questions": []
  }
}
```

---

## 7. List Jobs

```http
GET /jobs
```

Show:

- completed job
- currently running job
- failed job

---

## 8. Demonstrate Failed Job

Possible controlled failure:

- invalid provider configuration in local demo environment
- a test-only forced-error input flag
- intentionally invalid processing fixture

Do not leave unsafe debug behavior enabled in the production path.

---

## 9. Restart API

Stop API.

Start again.

Fetch previous completed job.

The result must still exist.

---

# 32. Definition of Done

The project is complete when all items below are true.

- [ ] Hono API starts successfully.
- [ ] PostgreSQL runs locally.
- [ ] Redis runs locally.
- [ ] Prisma migrations work.
- [ ] POST `/job` validates input.
- [ ] POST `/job` returns HTTP 202.
- [ ] Job is inserted into PostgreSQL.
- [ ] BullMQ receives the job.
- [ ] Separate worker consumes the job.
- [ ] Worker performs real AI calls.
- [ ] Pipeline has meaningful sequential steps.
- [ ] Step input/output is persisted.
- [ ] Step duration is persisted.
- [ ] Final generated output is saved in `Job.result`.
- [ ] GET `/jobs` returns statuses and saved results.
- [ ] GET `/jobs/:id` returns one job.
- [ ] Missing job returns 404.
- [ ] Incomplete result is `null`.
- [ ] Failed jobs persist an error.
- [ ] Retry configuration is present.
- [ ] Sensitive data is not logged.
- [ ] Completed results survive API restart.
- [ ] README explains how to run API and worker.
- [ ] Demo proves success and failure flows.

---

# 33. Stretch Goals

Only implement these after the assignment requirements are complete.

## Evaluate-Improve Pattern

Extend:

```text
Generate Study Guide
        |
        v
Evaluate Quality
        |
        v
score >= threshold?
   |          |
  yes         no
   |          |
 final      improve
              |
              v
           evaluate
```

Use:

```text
maxIterations = 2
```

to prevent infinite loops.

---

## Job Attempt Table

Add execution attempt history:

```text
Job
  |
  +--> Attempt 1
  +--> Attempt 2
  +--> Attempt 3
```

Useful for retries.

---

## Server-Sent Events

Add:

```http
GET /jobs/:id/events
```

for real-time progress updates.

---

## Queue Dashboard

Add Bull Board or a custom admin page for queue visibility.

---

## Metrics

Track:

- job processing duration
- step duration
- success rate
- failure rate
- AI call duration
- token usage
- cost estimate

---

## Cancellation

Add:

```http
POST /jobs/:id/cancel
```

and persist:

```text
CANCELLED
```

---

# 34. Suggested Development Order

Build in this order:

```text
1. Hono
2. PostgreSQL + Prisma
3. Redis + BullMQ
4. Job database model
5. POST /job
6. Worker
7. GET endpoints
8. Real AI client
9. Sequential AI pipeline
10. JobStep logging
11. Error handling
12. Retries
13. Tests
14. Restart persistence demo
15. README cleanup
```

Do not start with advanced agent patterns before the asynchronous job infrastructure is stable.

---

# 35. Architecture Decisions

## Why PostgreSQL is the source of truth

BullMQ is responsible for scheduling and execution.

PostgreSQL is responsible for durable state.

This allows:

- results to survive API restart
- historical jobs to remain queryable
- queue cleanup without losing results
- easier audit/debugging

---

## Why the queue contains only `jobId`

The full input already exists in PostgreSQL.

Passing only `jobId`:

- avoids duplication
- keeps Redis payloads small
- makes retries deterministic
- centralizes data ownership

---

## Why `JobStep` is separate from `Job.result`

`Job.result` represents the final business output.

`JobStep` represents execution observability.

Example:

```text
Job.result
=
the actual study guide
```

while:

```text
JobStep
=
how the system produced the study guide
```

They solve different problems.

---

## Why Sequential Pipeline First

Sequential Prompt Chaining is enough to demonstrate meaningful AI processing.

It is:

- easier to test
- easier to debug
- cheaper than iterative evaluation
- easier to explain
- sufficient for the assignment

Evaluate-Improve can be added after the base project works.

---

# 36. Final Target Architecture

```text
                        CLIENT
                           |
                           |
                     POST /job
                           |
                           v
                    +--------------+
                    |   Hono API   |
                    +------+-------+
                           |
                    Validate Input
                           |
                           v
                    +--------------+
                    | PostgreSQL   |
                    | Job=PENDING  |
                    +------+-------+
                           |
                         enqueue
                           |
                           v
                    +--------------+
                    |   BullMQ     |
                    |    Redis     |
                    +------+-------+
                           |
                           v
                    +--------------+
                    |    Worker    |
                    +------+-------+
                           |
                    Job=PROCESSING
                           |
                           v
              +-------------------------+
              | Sequential AI Pipeline  |
              +-------------------------+
                  |        |         |
                  v        v         v
               Analyze  Extract   Generate
                  |        |         |
                  +--------+---------+
                           |
                      JobStep logs
                           |
                           v
                    +--------------+
                    | PostgreSQL   |
                    +------+-------+
                           |
                           v
                    Job=COMPLETED
                    result=<output>
                           |
              +------------+------------+
              |                         |
              v                         v
         GET /jobs                GET /jobs/:id
```

---

# 37. Core Principle

Keep the implementation centered on this distinction:

```text
BullMQ
=
When and where should this work execute?
```

```text
Worker
=
How should this work execute?
```

```text
AI Pipeline
=
What processing stages transform the input?
```

```text
PostgreSQL
=
What durable state and result should survive?
```

```text
JobStep
=
What happened during processing?
```

This separation makes the project easier to reason about and gives it a clean foundation for future AI-agent workflows.
