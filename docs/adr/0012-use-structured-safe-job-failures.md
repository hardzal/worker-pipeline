# Persist and expose structured safe job failures

Job APIs and durable Job state use a structured failure containing a stable code, safe message, failed step, and retryability. Raw provider bodies, stack traces, prompts, SQL details, and credentials are not persisted in or returned as the public Job Failure; sanitized diagnostic causes may be written to restricted application logs correlated by request ID and Job ID. A transient failure may appear as `lastError` while `RETRYING` and is cleared when the Job completes.
