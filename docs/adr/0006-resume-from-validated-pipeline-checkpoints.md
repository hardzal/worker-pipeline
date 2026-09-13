# Resume retries from validated pipeline checkpoints

A completed Job Step is the canonical validated checkpoint for its stage, not an attempt-history log. When BullMQ retries a Job, the worker reuses completed checkpoints from the Job's pinned `pipelineVersion` and resumes at the first incomplete or failed stage; that stage and all downstream stages execute again. This reduces duplicate billable model calls while requiring schema validation, unique stage identity, and tests for checkpoint recovery. Checkpoints from a different pipeline version are never reused.
