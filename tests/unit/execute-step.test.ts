import { describe, expect, it, vi } from 'vitest'

import { executeStep, type StepLogger } from '../../src/pipeline/execute-step.js'

function createLogger() {
  return {
    createStep: vi.fn(async () => ({ id: 'step-1' })),
    markStepProcessing: vi.fn(async () => undefined),
    markStepCompleted: vi.fn(async () => undefined),
    markStepFailed: vi.fn(async () => undefined),
  } satisfies StepLogger
}

describe('executeStep', () => {
  it('persists sanitized input/output and lifecycle metadata on success', async () => {
    const logger = createLogger()

    const result = await executeStep(logger, {
      jobId: 'job-1',
      name: 'analyze-material',
      order: 1,
      input: {
        topic: 'MCP',
        token: 'input-secret',
        nested: { authorization: 'Bearer input-secret' },
      },
      run: async () => ({
        summary: 'The material summary',
        apiKey: 'output-secret',
      }),
    })

    expect(result).toEqual({
      summary: 'The material summary',
      apiKey: 'output-secret',
    })
    expect(logger.createStep).toHaveBeenCalledWith('job-1', 'analyze-material', 1, {
      topic: 'MCP',
      token: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    })
    expect(logger.markStepProcessing).toHaveBeenCalledWith('step-1')
    expect(logger.markStepCompleted).toHaveBeenCalledWith(
      'step-1',
      {
        summary: 'The material summary',
        apiKey: '[REDACTED]',
      },
      expect.any(Number),
    )
  })

  it('persists a sanitized failure and rethrows the original error', async () => {
    const logger = createLogger()
    const failure = new Error('provider apiKey=output-secret failed')

    await expect(
      executeStep(logger, {
        jobId: 'job-1',
        name: 'extract-concepts',
        order: 2,
        input: { topic: 'MCP' },
        run: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)

    expect(logger.markStepFailed).toHaveBeenCalledWith(
      'step-1',
      'provider apiKey=[REDACTED] failed',
      expect.any(Number),
    )
    expect(logger.markStepCompleted).not.toHaveBeenCalled()
  })
})
