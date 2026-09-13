# Use at-least-once job processing with idempotent persistence

BullMQ workers provide at-least-once processing. Database writes and Job Step replacement must therefore be idempotent, but an AI provider call may be repeated if a worker crashes or times out after the provider accepted the request and before the result was persisted. The system does not claim exactly-once AI execution or exactly-once billing; provider idempotency support may reduce duplication but is not assumed as a cross-provider guarantee.
