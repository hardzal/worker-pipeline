# Reject oversized source material instead of chunking in the MVP

The MVP requires Source Material to fit within one model request together with prompt and output budget. It does not implement chunking or map-reduce orchestration; input above the configurable conservative `MAX_SOURCE_CHARS` limit is rejected with `413 Payload Too Large` before a Job is created, and any provider context-limit error that escapes preflight is non-retryable. Chunked processing is a separate future pipeline because it introduces per-chunk checkpoints, merge semantics, and different grounding behavior.
