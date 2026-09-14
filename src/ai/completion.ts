import type { CompletionModel } from '@anvia/core/completion'
import { extract } from '@anvia/core/extractor'
import type { z } from 'zod'

export type StructuredCompletionRequest<Output> = {
  text: string
  instructions: string
  schema: z.ZodType<Output>
}

export type StructuredCompletion = <Output>(
  request: StructuredCompletionRequest<Output>,
) => Promise<Output>

export function createAnviaStructuredCompletion(
  model: CompletionModel,
): StructuredCompletion {
  return async <Output>(request: StructuredCompletionRequest<Output>) => {
    const result = await extract({
      model,
      text: request.text,
      instructions: request.instructions,
      outputSchema: request.schema,
    })

    return result.output
  }
}
