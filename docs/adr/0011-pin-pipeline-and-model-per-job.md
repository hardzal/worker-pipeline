# Pin pipeline and model identity per job

Each Job stores the resolved `pipelineVersion` and `modelId` at submission time, and all processing retries use those pinned values. Provider credentials and secret connection details remain runtime configuration and are never persisted with the Job. Pinning prevents queued or retried Jobs from silently combining checkpoints produced by different prompts, schemas, or models; a removed pinned model causes a non-retryable failure rather than an implicit model substitution.
