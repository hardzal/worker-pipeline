# Keep the MVP single-tenant and internal

The MVP is a trusted single-tenant service for local or internal-network use and does not implement authentication, authorization, or per-owner Job isolation. The server binds to loopback by default and must not be presented as safe for public deployment. This keeps the learning scope focused on durable asynchronous AI processing; exposing it publicly requires a separate security milestone covering identity, authorization, rate limits, abuse controls, and Job ownership.
