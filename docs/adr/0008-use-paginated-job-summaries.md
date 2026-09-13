# Use cursor-paginated job summaries for the collection API

`GET /jobs` returns cursor-paginated Job Summaries ordered by `createdAt DESC, id DESC`, with a default limit of 20 and a maximum of 100. It may filter by status but does not include Source Material, the complete Study Guide, or Job Steps; clients use `GET /jobs/:id` for those details. This deliberately replaces the original unbounded full-result list contract to keep query, serialization, memory, and response size bounded as Job volume grows.
