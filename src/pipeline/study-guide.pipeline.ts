import type { StructuredCompletion } from '../ai/completion.js'
import type { StudyGuideResult } from '../ai/schemas.js'
import type { JobProcessFunction } from '../modules/jobs/job.processor.js'
import { analyzeMaterial } from './steps/analyze-material.step.js'
import { extractConcepts } from './steps/extract-concepts.step.js'
import { generateStudyGuide } from './steps/generate-study-guide.step.js'

export type { StudyGuideResult } from '../ai/schemas.js'

export function createStudyGuideProcessor(dependencies: {
  complete: StructuredCompletion
}): JobProcessFunction<StudyGuideResult> {
  return async ({ input }) => {
    const analysis = await analyzeMaterial(input, dependencies.complete)
    const concepts = await extractConcepts(input, analysis, dependencies.complete)

    return generateStudyGuide(input, analysis, concepts, dependencies.complete)
  }
}
