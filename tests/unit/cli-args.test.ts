import { describe, expect, it } from 'vitest'

import { parsePipelineCliArgs } from '../../src/cli/args.js'

describe('pipeline CLI arguments', () => {
  it('parses topic and content flags into pipeline input', () => {
    expect(
      parsePipelineCliArgs([
        '--topic',
        'Model Context Protocol',
        '--content',
        'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
      ]),
    ).toEqual({
      topic: 'Model Context Protocol',
      content:
        'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
    })
  })

  it('parses a JSON input argument for script-friendly CLI usage', () => {
    expect(
      parsePipelineCliArgs([
        '--',
        '--json',
        '{"topic":"AI","content":"A sufficiently long pipeline input for a CLI request."}',
      ]),
    ).toEqual({
      topic: 'AI',
      content: 'A sufficiently long pipeline input for a CLI request.',
    })
  })

  it('rejects incomplete input', () => {
    expect(() => parsePipelineCliArgs(['--topic', 'AI'])).toThrow(
      'Both --topic and --content are required',
    )
  })
})
