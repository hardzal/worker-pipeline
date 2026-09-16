import type { Hono } from "hono";

import { JobEnqueueError } from "../jobs/job.service.js";

import type { PipelineAgent } from "./pipeline.agent.js";
import { pipelineInputSchema } from "./pipeline.schema.js";
import { bodyLimit } from "hono/body-limit";

export function registerPipelineRoutes(
  app: Hono,
  pipelineAgent: PipelineAgent,
): void {
  app.use(
    "/job",
    bodyLimit({
      maxSize: 50000,
    }),
  );

  app.post("/job", async (context) => {
    let requestBody: unknown;

    try {
      requestBody = await context.req.json();
    } catch {
      return context.json(
        {
          error: "VALIDATION_ERROR",
          message: "Request body must be valid JSON",
        },
        400,
      );
    }

    const parsed = pipelineInputSchema.safeParse(requestBody);

    if (!parsed.success) {
      return context.json(
        {
          error: "VALIDATION_ERROR",
          message: "Request body is invalid",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    try {
      const result = await pipelineAgent.submit(parsed.data);
      return context.json(result, 202);
    } catch (error) {
      if (error instanceof JobEnqueueError) {
        return context.json(
          {
            error: "JOB_ENQUEUE_FAILED",
            message: "Job could not be queued",
          },
          503,
        );
      }

      throw error;
    }
  });
}
