import type { CreateJobInput } from '../../modules/jobs/job.types.js'
import type { StructuredCompletion } from '../../ai/completion.js'
import {
  extractConceptsInstructions,
  extractConceptsText,
} from '../../ai/prompts.js'
import {
  conceptExtractionSchema,
  type ConceptExtraction,
  type MaterialAnalysis,
} from '../../ai/schemas.js'

export function extractConcepts(
  input: CreateJobInput,
  analysis: MaterialAnalysis,
  complete: StructuredCompletion,
): Promise<ConceptExtraction> {
  return complete({
    text: extractConceptsText(input, analysis),
    instructions: extractConceptsInstructions(),
    schema: conceptExtractionSchema,
  })
}
