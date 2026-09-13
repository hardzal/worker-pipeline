# Retain terminal jobs for 30 days by default

A Job and its Source Material, Study Guide, errors, Job Steps, Submission Identity, and request hash are retained as one aggregate for 30 days after the Job reaches terminal `COMPLETED` or final `FAILED`. The duration is configurable through `JOB_RETENTION_DAYS`, and cleanup never removes active Jobs. The idempotency reservation expires with the aggregate. Retention may be explicitly disabled for local demonstrations or restart-persistence tests, but indefinite storage is not the default.
