import type { PipelineAgentInput } from '../modules/pipeline/pipeline.agent.js'

export function parsePipelineCliArgs(argv: string[]): PipelineAgentInput {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv

  if (normalizedArgv[0] === '--json') {
    const json = normalizedArgv[1]

    if (!json) {
      throw new Error('The --json argument requires a JSON value')
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Error('The --json argument must contain valid JSON')
    }

    if (!isPipelineInput(parsed)) {
      throw new Error('The --json value must contain topic and content strings')
    }

    return parsed
  }

  const topic = readFlag(normalizedArgv, '--topic')
  const content = readFlag(normalizedArgv, '--content')

  if (!topic || !content) {
    throw new Error('Both --topic and --content are required')
  }

  return { topic, content }
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

function isPipelineInput(value: unknown): value is PipelineAgentInput {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const input = value as Record<string, unknown>
  return typeof input.topic === 'string' && typeof input.content === 'string'
}
