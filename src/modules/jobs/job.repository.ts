import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

import {
  currentPrismaTimestamp,
  type PrismaDb,
} from '../../config/prisma.js'

import type {
  CreateJobInput,
  JobRepository,
  JobStepDetails,
  JobStepRepository,
  JobStatus,
  JobWorkerRepository,
  JobQueryRepository,
  PendingJob,
  ProcessableJob,
} from './job.types.js'

const JOB_TYPE = 'study-guide'

export function createJobRepository(
  prisma: PrismaDb,
): JobRepository & JobWorkerRepository & JobStepRepository & JobQueryRepository {
  return {
    async createPending(input: CreateJobInput): Promise<PendingJob> {
      const now = currentPrismaTimestamp()
      const job = await prisma.orm.public.Job.create({
        id: randomUUID(),
        _type: JOB_TYPE,
        status: 'PENDING',
        input: {
          topic: input.topic,
          content: input.content,
        },
        updatedAt: now,
      })

      return {
        id: job.id,
        status: 'PENDING',
      }
    },

    async markQueued(jobId: string, bullJobId: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        bullJobId,
        queuedAt: now,
        status: 'QUEUED',
        updatedAt: now,
      })
    },

    async loadForProcessing(jobId: string): Promise<ProcessableJob | null> {
      const job = await prisma.orm.public.Job.first({ id: jobId })

      if (!job) {
        return null
      }

      return {
        id: job.id,
        input: parseJobInput(job.input),
      }
    },

    async markProcessing(jobId: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        error: null,
        startedAt: now,
        status: 'PROCESSING',
        updatedAt: now,
      })
    },

    async markCompleted(jobId: string, result: JsonValue): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        completedAt: now,
        result,
        status: 'COMPLETED',
        updatedAt: now,
      })
    },

    async markFailed(jobId: string, error: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        error,
        status: 'FAILED',
        updatedAt: now,
      })
    },

    async listJobs() {
      const jobs = await prisma.orm.public.Job.all()
      return jobs.map(toJobSummary)
    },

    async getJob(jobId: string) {
      const job = await prisma.orm.public.Job.first({ id: jobId })

      if (!job) {
        return null
      }

      const steps = await prisma.orm.public.JobStep
        .where({ jobId })
        .orderBy((step) => step.order.asc())
        .all()

      return {
        ...toJobSummary(job),
        input: job.input,
        steps: steps.map(toJobStepDetails).sort((left, right) => left.order - right.order),
      }
    },

    async createStep(
      jobId: string,
      name: string,
      order: number,
      input: JsonValue,
    ): Promise<{ id: string }> {
      const id = randomUUID()
      await prisma.orm.public.JobStep.create({
        id,
        jobId,
        name,
        order,
        status: 'PENDING',
        input,
      })

      return { id }
    },

    async markStepProcessing(stepId: string): Promise<void> {
      await prisma.orm.public.JobStep.where({ id: stepId }).update({
        startedAt: currentPrismaTimestamp(),
        status: 'PROCESSING',
      })
    },

    async markStepCompleted(
      stepId: string,
      output: JsonValue,
      durationMs: number,
    ): Promise<void> {
      await prisma.orm.public.JobStep.where({ id: stepId }).update({
        completedAt: currentPrismaTimestamp(),
        durationMs,
        output,
        status: 'COMPLETED',
      })
    },

    async markStepFailed(
      stepId: string,
      error: string,
      durationMs: number,
    ): Promise<void> {
      await prisma.orm.public.JobStep.where({ id: stepId }).update({
        completedAt: currentPrismaTimestamp(),
        durationMs,
        error,
        status: 'FAILED',
      })
    },
  }
}

function parseJobInput(input: unknown): CreateJobInput {
  if (!isRecord(input)) {
    throw new Error('Job input must be a JSON object')
  }

  if (typeof input.topic !== 'string' || typeof input.content !== 'string') {
    throw new Error('Job input must contain string topic and content fields')
  }

  return {
    content: input.content,
    topic: input.topic,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type JobQueryRow = {
  id: string
  _type: string
  status: JobStatus
  input: JsonValue
  result: JsonValue | null
  error: string | null
  createdAt: unknown
  completedAt: unknown
}

type JobStepQueryRow = {
  id: string
  name: string
  order: number
  status: JobStepDetails['status']
  input: JsonValue | null
  output: JsonValue | null
  error: string | null
  startedAt: unknown
  completedAt: unknown
  durationMs: number | null
}

function toJobSummary(job: JobQueryRow) {
  return {
    id: job.id,
    type: job._type,
    status: job.status,
    result: job.status === 'COMPLETED' ? job.result : null,
    error: job.error,
    createdAt: toTimestamp(job.createdAt),
    completedAt: nullableTimestamp(job.completedAt),
  }
}

function toJobStepDetails(step: JobStepQueryRow): JobStepDetails {
  return {
    id: step.id,
    name: step.name,
    order: step.order,
    status: step.status,
    input: step.input,
    output: step.output,
    error: step.error,
    startedAt: nullableTimestamp(step.startedAt),
    completedAt: nullableTimestamp(step.completedAt),
    durationMs: step.durationMs,
  }
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : toTimestamp(value)
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
