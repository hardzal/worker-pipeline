import {
  OpenAIClient,
  type OpenAICompletionModel,
  type OpenAICompletionModelId,
} from '@anvia/openai'

import type { AppEnv } from '../config/env.js'

type AiEnvironment = AppEnv &
  Required<Pick<AppEnv, 'LLM_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_API_BASE_URL'>>

export function createAiCompletionModel(
  environment: AiEnvironment,
): OpenAICompletionModel {
  const client = new OpenAIClient({
    apiKey: environment.OPENAI_API_KEY,
    baseUrl: environment.OPENAI_API_BASE_URL,
  })

  return client.completionModel({
    modelId: environment.LLM_MODEL as OpenAICompletionModelId,
    api: 'chat',
  })
}
