import type { Hono } from "hono";

import type { JobQueryService } from "./job.query.js";
import type { JobCursorRaw } from "./job.types.js";

export function registerJobQueryRoutes(
  app: Hono,
  jobQueryService: JobQueryService,
): void {
  app.get("/jobs", async (context) => {
    const showAll = context.req.query("show") || "";
    if (showAll == "all") {
      const jobs = await jobQueryService.listJobs();

      return context.json(jobs);
    }

    // pindahin nanti
    function encodeCursor(cursor: JobCursorRaw): string {
      return Buffer.from(JSON.stringify(cursor)).toString("base64url");
    }

    function decodeCursor(cursor: string): JobCursorRaw {
      const raw = Buffer.from(cursor, "base64url").toString("utf8");

      const payload = JSON.parse(raw) as JobCursorRaw;

      return {
        createdAt: payload.createdAt,
        id: payload.id,
      };
    }

    // input pasti string
    const rawLimit = context.req.query("limit") || "";

    const limitStr = Number(parseInt(rawLimit, 10) ?? 20);
    const rawCursor = context.req.query("cursor");

    const limit = Math.min(Math.max(limitStr, 1), 100);
    const decodedCursor = rawCursor ? decodeCursor(rawCursor) : undefined;

    // kenapa cursor createdAt tidak menerima type Date ya?
    const jobs = await jobQueryService.findMany({
      limit: limit + 1,
      cursor: decodedCursor,
    });

    const hasNext = jobs.length > limit;
    const data = hasNext ? jobs.slice(0, limit) : jobs;
    const lastItem = data.at(-1);

    const nextCursor =
      hasNext && lastItem
        ? encodeCursor({
            createdAt: lastItem.createdAt,
            id: lastItem.id,
          })
        : null;

    const result = {
      data,
      pagination: {
        hasNext,
        nextCursor,
      },
    };

    return context.json(result);
  });

  app.get("/jobs/:id", async (context) => {
    const job = await jobQueryService.getJob(context.req.param("id"));

    if (!job) {
      return context.json(
        {
          error: "JOB_NOT_FOUND",
          message: "Job was not found",
        },
        404,
      );
    }

    return context.json(job);
  });
}
