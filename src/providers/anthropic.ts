import Anthropic from '@anthropic-ai/sdk'
import type { MemoryProvider } from '../types.js'

export class AnthropicProvider implements MemoryProvider {
  name = 'anthropic'
  private client: Anthropic
  private model: string
  private maxTokens: number

  constructor(apiKey: string, model: string, maxTokens: number, baseURL?: string) {
    const defaultHeaders: Record<string, string> = {}
    const customHeaders = process.env['ANTHROPIC_CUSTOM_HEADERS']
    if (customHeaders) {
      for (const pair of customHeaders.split(',')) {
        const idx = pair.indexOf(':')
        if (idx !== -1) defaultHeaders[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
    }
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), defaultHeaders })
    this.model = model
    this.maxTokens = maxTokens
  }

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt)
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt)
  }

  async describeImage(imageData: string, mimeType: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: imageData },
          },
          { type: 'text', text: prompt },
        ],
      }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    return textBlock?.text ?? ''
  }

  private async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    return textBlock?.text ?? ''
  }
}
