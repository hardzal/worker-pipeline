import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { sanitizeErrorMessage, sanitizeStepData } from "../shared/sanitize.js";

export type StepLogger = {
  createStep(
    jobId: string,
    name: string,
    order: number,
    input: JsonValue,
  ): Promise<{ id: string }>;
  markStepProcessing(stepId: string): Promise<void>;
  markStepCompleted(
    stepId: string,
    output: JsonValue,
    durationMs: number,
  ): Promise<void>;
  markStepFailed(
    stepId: string,
    error: string,
    durationMs: number,
  ): Promise<void>;
};

export type ExecuteStepOptions<TInput, TOutput> = {
  jobId: string;
  name: string;
  order: number;
  input: TInput;
  run: () => Promise<TOutput>;
};

export async function executeStep<TInput, TOutput>(
  logger: StepLogger,
  options: ExecuteStepOptions<TInput, TOutput>,
): Promise<TOutput> {
  const step = await logger.createStep(
    options.jobId,
    options.name,
    options.order,
    sanitizeStepData(options.input),
  );
  const startedAt = Date.now();

  try {
    await logger.markStepProcessing(step.id);
    const output = await options.run();

    await logger.markStepCompleted(
      step.id,
      sanitizeStepData(output),
      elapsedMilliseconds(startedAt),
    );

    return output;
  } catch (error) {
    try {
      await logger.markStepFailed(
        step.id,
        sanitizeErrorMessage(error),
        elapsedMilliseconds(startedAt),
      );
    } catch {
      // Preserve the original pipeline failure if step-log persistence also fails.
    }

    throw error;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
