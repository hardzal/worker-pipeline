import type { JobsOptions } from 'bullmq'
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

export type CreateJobInput = {
  topic: string
  content: string
}

export type JobCreationResult = {
  id: string
  status: 'QUEUED'
}

export type PendingJob = {
  id: string
  status: 'PENDING'
}

export type ProcessableJob = {
  id: string
  input: CreateJobInput
}

export type JobQueuePayload = {
  jobId: string
}

export interface JobRepository {
  createPending(input: CreateJobInput): Promise<PendingJob>
  markQueued(jobId: string, bullJobId: string): Promise<void>
  markFailed(jobId: string, error: string): Promise<void>
}

export interface JobWorkerRepository {
  loadForProcessing(jobId: string): Promise<ProcessableJob | null>
  markProcessing(jobId: string): Promise<void>
  markCompleted(jobId: string, result: JsonValue): Promise<void>
  markFailed(jobId: string, error: string): Promise<void>
}

export interface JobStepRepository {
  createStep(jobId: string, name: string, order: number, input: JsonValue): Promise<{ id: string }>
  markStepProcessing(stepId: string): Promise<void>
  markStepCompleted(stepId: string, output: JsonValue, durationMs: number): Promise<void>
  markStepFailed(stepId: string, error: string, durationMs: number): Promise<void>
}

export interface JobQueue {
  add(
    name: string,
    payload: JobQueuePayload,
    options: Pick<JobsOptions, 'jobId'>,
  ): Promise<{ id?: string | number | null }>
}
