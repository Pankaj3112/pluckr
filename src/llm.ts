import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  GENERATE_SELECTORS_SYSTEM,
  generateSelectorsPrompt,
  FIX_SELECTORS_SYSTEM,
  fixSelectorsPrompt,
} from './prompts.js'

export interface LLMConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
}

function createModel(config: LLMConfig) {
  if (config.provider === 'anthropic') {
    const provider = createAnthropic({ apiKey: config.apiKey })
    return provider(config.model)
  }
  const provider = createOpenAI({ apiKey: config.apiKey })
  return provider(config.model)
}

function selectorsSchema(fieldNames: string[]) {
  const shape: Record<string, z.ZodString> = {}
  for (const name of fieldNames) {
    shape[name] = z.string()
  }
  return z.object({
    selectors: z.object(shape),
  })
}

export async function generateSelectors(
  html: string,
  fieldNames: string[],
  config: LLMConfig,
): Promise<Record<string, string>> {
  const fields = fieldNames.map((name) => ({ name, type: 'string' }))
  const model = createModel(config)

  const { object } = await generateObject({
    model,
    schema: selectorsSchema(fieldNames),
    system: GENERATE_SELECTORS_SYSTEM,
    prompt: generateSelectorsPrompt(html, fields),
  })

  return object.selectors
}

export async function fixSelectors(
  html: string,
  previousSelectors: Record<string, string>,
  errors: string,
  rawData: unknown,
  config: LLMConfig,
): Promise<Record<string, string>> {
  const fieldNames = Object.keys(previousSelectors)
  const model = createModel(config)

  const { object } = await generateObject({
    model,
    schema: selectorsSchema(fieldNames),
    system: FIX_SELECTORS_SYSTEM,
    prompt: fixSelectorsPrompt(html, previousSelectors, errors, rawData),
  })

  return object.selectors
}
