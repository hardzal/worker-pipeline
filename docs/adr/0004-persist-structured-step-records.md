# Persist canonical source once and structured step records

Source Material is stored once as the canonical `Job.input`; pipeline steps do not duplicate it. Each Job Step persists validated structured business values plus execution metadata, while API credentials, authorization headers, system prompts, and raw provider responses are excluded. This keeps execution inspectable while reducing database growth and limiting accidental persistence of sensitive data embedded in operational transcripts.
