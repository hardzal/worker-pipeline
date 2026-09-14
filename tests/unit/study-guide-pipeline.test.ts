import { describe, expect, it, vi } from 'vitest'

import {
  createStudyGuideProcessor,
  type StructuredCompletion,
} from '../../src/pipeline/study-guide.pipeline.js'
import type { StepLogger } from '../../src/pipeline/execute-step.js'

const job = {
  id: 'job-1',
  input: {
    topic: 'Model Context Protocol',
    content:
      'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
  },
}

function createStepLogger() {
  let nextStep = 0

  return {
    createStep: vi.fn(async () => ({ id: `step-${++nextStep}` })),
    markStepProcessing: vi.fn(async () => undefined),
    markStepCompleted: vi.fn(async () => undefined),
    markStepFailed: vi.fn(async () => undefined),
  } satisfies StepLogger
}

describe('createStudyGuideProcessor', () => {
  it('runs analysis, concept extraction, and guide generation sequentially', async () => {
    const expectedGuide = {
      title: 'Model Context Protocol Study Guide',
      summary: 'MCP provides a standard boundary between AI applications and external systems.',
      keyConcepts: [
        {
          name: 'MCP Host',
          description: 'The AI application that coordinates MCP clients.',
        },
      ],
      questions: [
        {
          question: 'What problem does MCP solve?',
          answer: 'It standardizes how AI applications connect to external systems.',
        },
      ],
    }
    const responses: unknown[] = [
      {
        summary: 'MCP standardizes connections between AI applications and external systems.',
        audience: 'Software engineers building AI applications',
        difficulty: 'intermediate',
      },
      {
        concepts: [
          {
            name: 'MCP Host',
            description: 'The AI application that coordinates MCP clients.',
          },
          {
            name: 'MCP Server',
            description: 'A service that exposes tools, resources, or prompts.',
          },
        ],
      },
      expectedGuide,
    ]
    const complete = vi.fn<StructuredCompletion>(async ({ schema }) => {
      return schema.parse(responses.shift())
    })

    const stepLogger = createStepLogger()
    const result = await createStudyGuideProcessor({ complete, stepLogger })(job)

    expect(result).toEqual(expectedGuide)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(complete.mock.calls[0]?.[0].instructions).toContain('Analyze')
    expect(complete.mock.calls[1]?.[0].instructions).toContain('concept')
    expect(complete.mock.calls[2]?.[0].instructions).toContain('study guide')
    expect(stepLogger.createStep.mock.calls.map(([jobId, name, order]) => [jobId, name, order])).toEqual([
      ['job-1', 'analyze-material', 1],
      ['job-1', 'extract-concepts', 2],
      ['job-1', 'generate-study-guide', 3],
    ])
    expect(stepLogger.markStepCompleted).toHaveBeenCalledTimes(3)
  })

  it('propagates a model failure without returning a partial guide', async () => {
    const complete = vi.fn<StructuredCompletion>(async () => {
      throw new Error('model unavailable')
    })

    const stepLogger = createStepLogger()

    await expect(
      createStudyGuideProcessor({ complete, stepLogger })(job),
    ).rejects.toThrow('model unavailable')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(stepLogger.markStepFailed).toHaveBeenCalledTimes(1)
  })

  it('propagates invalid structured AI output and records a failed step', async () => {
    const complete = vi.fn<StructuredCompletion>(async ({ schema }) => {
      return schema.parse({
        summary: '',
        audience: 'Software engineers',
        difficulty: 'intermediate',
      })
    })
    const stepLogger = createStepLogger()

    await expect(
      createStudyGuideProcessor({ complete, stepLogger })(job),
    ).rejects.toThrow()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(stepLogger.markStepFailed).toHaveBeenCalledWith(
      'step-1',
      expect.any(String),
      expect.any(Number),
    )
    expect(stepLogger.markStepCompleted).not.toHaveBeenCalled()
  })
})
