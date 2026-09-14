import 'dotenv/config'

import { parseAppEnv } from '../config/env.js'
import { createPipelineRuntime } from '../config/runtime.js'
import { parsePipelineCliArgs } from './args.js'
import { pipelineInputSchema } from '../modules/pipeline/pipeline.schema.js'

async function main(): Promise<void> {
  let input: unknown

  try {
    input = parsePipelineCliArgs(process.argv.slice(2))
  } catch (error) {
    printError('CLI_INPUT_ERROR', error)
    process.exitCode = 1
    return
  }

  const parsed = pipelineInputSchema.safeParse(input)

  if (!parsed.success) {
    printError('VALIDATION_ERROR', new Error('Pipeline input is invalid'))
    process.exitCode = 1
    return
  }

  const environment = parseAppEnv(process.env)
  const runtime = createPipelineRuntime(environment)

  try {
    const result = await runtime.pipelineAgent.submit(parsed.data)
    console.log(JSON.stringify(result))
  } catch (error) {
    printError('PIPELINE_SUBMISSION_ERROR', error)
    process.exitCode = 1
  } finally {
    await runtime.close()
  }
}

function printError(code: string, error: unknown): void {
  console.error(
    JSON.stringify({
      error: code,
      message: error instanceof Error ? error.message : String(error),
    }),
  )
}

void main().catch((error: unknown) => {
  printError('CLI_ERROR', error)
  process.exitCode = 1
})
