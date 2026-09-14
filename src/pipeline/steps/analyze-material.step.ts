import type { CreateJobInput } from '../../modules/jobs/job.types.js'
import type { StructuredCompletion } from '../../ai/completion.js'
import {
  analyzeMaterialInstructions,
  analyzeMaterialText,
} from '../../ai/prompts.js'
import {
  materialAnalysisSchema,
  type MaterialAnalysis,
} from '../../ai/schemas.js'

export function analyzeMaterial(
  input: CreateJobInput,
  complete: StructuredCompletion,
): Promise<MaterialAnalysis> {
  return complete({
    text: analyzeMaterialText(input),
    instructions: analyzeMaterialInstructions(),
    schema: materialAnalysisSchema,
  })
}
