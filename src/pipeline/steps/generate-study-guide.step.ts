import type { CreateJobInput } from '../../modules/jobs/job.types.js'
import type { StructuredCompletion } from '../../ai/completion.js'
import {
  generateStudyGuideInstructions,
  generateStudyGuideText,
} from '../../ai/prompts.js'
import {
  studyGuideSchema,
  type ConceptExtraction,
  type MaterialAnalysis,
  type StudyGuideResult,
} from '../../ai/schemas.js'

export function generateStudyGuide(
  input: CreateJobInput,
  analysis: MaterialAnalysis,
  concepts: ConceptExtraction,
  complete: StructuredCompletion,
): Promise<StudyGuideResult> {
  return complete({
    text: generateStudyGuideText(input, analysis, concepts),
    instructions: generateStudyGuideInstructions(),
    schema: studyGuideSchema,
  })
}
