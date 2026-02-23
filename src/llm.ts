import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  GENERATE_SELECTORS_SYSTEM,
  generateSelectorsPrompt,
  FIX_SELECTORS_SYSTEM,
  fixSelectorsPrompt,
} from './prompts.js'

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
  model: LanguageModel,
): Promise<Record<string, string>> {
  const fields = fieldNames.map((name) => ({ name, type: 'string' }))

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
  model: LanguageModel,
): Promise<Record<string, string>> {
  const fieldNames = Object.keys(previousSelectors)

  const { object } = await generateObject({
    model,
    schema: selectorsSchema(fieldNames),
    system: FIX_SELECTORS_SYSTEM,
    prompt: fixSelectorsPrompt(html, previousSelectors, errors, rawData),
  })

  return object.selectors
}
