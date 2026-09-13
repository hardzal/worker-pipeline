# Keep job detail responses lean with explicit projections

`GET /jobs/:id` returns identity, state, timestamps, progress, quality warnings, and safe failure information by default. Clients explicitly request heavy fields through a validated `include` projection such as `include=result,steps,source`; unknown projection values return `400`. This prevents status polling from repeatedly transferring Source Material, the full Study Guide, and checkpoint payloads while keeping one detail endpoint for the MVP.
