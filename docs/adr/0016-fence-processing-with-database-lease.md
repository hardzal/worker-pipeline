# Fence processing writes with a database lease

A worker processing a Job acquires a database lease with an opaque owner token and expiry, renews it every 30 seconds, and uses that token to guard all subsequent checkpoint and completion writes. The default lease expiry is five minutes and configurable. BullMQ stalled detection remains useful, but the PostgreSQL lease is required to recover `PROCESSING` Jobs after Redis state loss and to prevent an old worker from overwriting state after a reconciler assigns new ownership; this is fencing for safe recovery, not an exactly-once guarantee.
