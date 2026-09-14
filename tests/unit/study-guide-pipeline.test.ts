import { describe, expect, it, vi } from 'vitest'

import {
  createStudyGuideProcessor,
  type StructuredCompletion,
} from '../../src/pipeline/study-guide.pipeline.js'

const job = {
  id: 'job-1',
  input: {
    topic: 'Model Context Protocol',
    content:
      'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
  },
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

    const result = await createStudyGuideProcessor({ complete })(job)

    expect(result).toEqual(expectedGuide)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(complete.mock.calls[0]?.[0].instructions).toContain('Analyze')
    expect(complete.mock.calls[1]?.[0].instructions).toContain('concept')
    expect(complete.mock.calls[2]?.[0].instructions).toContain('study guide')
  })

  it('propagates a model failure without returning a partial guide', async () => {
    const complete = vi.fn<StructuredCompletion>(async () => {
      throw new Error('model unavailable')
    })

    await expect(
      createStudyGuideProcessor({ complete })(job),
    ).rejects.toThrow('model unavailable')
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
