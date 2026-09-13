# Reconcile recoverable jobs instead of using a transactional outbox

The API persists a Job before dispatching it to BullMQ, but PostgreSQL and Redis cannot participate in one atomic transaction. A reconciler owned by the worker process treats PostgreSQL as the source of truth for all non-terminal work: it dispatches due `PENDING` Jobs and reconstructs stale `QUEUED`, `PROCESSING`, or `RETRYING` Jobs when their expected BullMQ state is missing. Terminal Jobs are never enqueued. The worker reconciles at startup and periodically thereafter using the database Job ID as BullMQ `jobId` and guarded state transitions.

Initial dispatch retries use exponential backoff capped at five minutes and a configurable maximum age of 24 hours by default. After dispatch expiry, the Job becomes final `FAILED` with `QUEUE_DISPATCH_EXPIRED`.

Once the Job is durable, the API has accepted ownership: `POST /jobs` returns `202` with `QUEUED` after immediate dispatch or `202` with `PENDING` when the reconciler must complete dispatch. A persistence failure returns `503` because no Job was accepted.
