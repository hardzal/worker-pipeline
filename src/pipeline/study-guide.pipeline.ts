import type { StructuredCompletion } from '../ai/completion.js'
import type { StudyGuideResult } from '../ai/schemas.js'
import type { JobProcessFunction } from '../modules/jobs/job.processor.js'
import { executeStep, type StepLogger } from './execute-step.js'
import { analyzeMaterial } from './steps/analyze-material.step.js'
import { extractConcepts } from './steps/extract-concepts.step.js'
import { generateStudyGuide } from './steps/generate-study-guide.step.js'

export type { StudyGuideResult } from '../ai/schemas.js'

export function createStudyGuideProcessor(dependencies: {
  complete: StructuredCompletion
  stepLogger: StepLogger
}): JobProcessFunction<StudyGuideResult> {
  return async ({ id: jobId, input }) => {
    const analysis = await executeStep(dependencies.stepLogger, {
      jobId,
      name: 'analyze-material',
      order: 1,
      input,
      run: () => analyzeMaterial(input, dependencies.complete),
    })
    const concepts = await executeStep(dependencies.stepLogger, {
      jobId,
      name: 'extract-concepts',
      order: 2,
      input: { topic: input.topic, analysis },
      run: () => extractConcepts(input, analysis, dependencies.complete),
    })

    return executeStep(dependencies.stepLogger, {
      jobId,
      name: 'generate-study-guide',
      order: 3,
      input: { topic: input.topic, analysis, concepts },
      run: () => generateStudyGuide(input, analysis, concepts, dependencies.complete),
    })
  }
}
