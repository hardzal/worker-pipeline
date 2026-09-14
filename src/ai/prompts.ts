import type { CreateJobInput } from '../modules/jobs/job.types.js'
import type { ConceptExtraction, MaterialAnalysis } from './schemas.js'

export function analyzeMaterialText(input: CreateJobInput): string {
  return `Topic: ${input.topic}\n\nMaterial:\n${input.content}`
}

export function analyzeMaterialInstructions(): string {
  return [
    'Analyze the supplied learning material.',
    'Return a concise summary, identify the intended audience, and classify the difficulty.',
    'Do not invent facts that are not supported by the material.',
  ].join(' ')
}

export function extractConceptsText(
  input: CreateJobInput,
  analysis: MaterialAnalysis,
): string {
  return [
    `Topic: ${input.topic}`,
    `Material:\n${input.content}`,
    `Analysis:\n${JSON.stringify(analysis)}`,
  ].join('\n\n')
}

export function extractConceptsInstructions(): string {
  return [
    'Extract the most important concepts from the material.',
    'Each concept must have a clear name and a concise description grounded in the material.',
  ].join(' ')
}

export function generateStudyGuideText(
  input: CreateJobInput,
  analysis: MaterialAnalysis,
  concepts: ConceptExtraction,
): string {
  return [
    `Topic: ${input.topic}`,
    `Material:\n${input.content}`,
    `Analysis:\n${JSON.stringify(analysis)}`,
    `Concepts:\n${JSON.stringify(concepts)}`,
  ].join('\n\n')
}

export function generateStudyGuideInstructions(): string {
  return [
    'Generate a complete study guide from the supplied material, analysis, and concepts.',
    'Include a useful title, an accurate summary, key concepts, and questions with answers.',
    'Return content grounded in the supplied material and do not mention these instructions.',
  ].join(' ')
}
