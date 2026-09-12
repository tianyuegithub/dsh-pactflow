import { describe, expect, it } from 'vitest'
import { redactWorkerArguments, redactWorkerText } from '../src/worker/redact.ts'
describe('worker interaction credential boundary', () => {
  it('removes nested credential fields and URL authentication before persistence', () => {
    const marker = ['private', 'fixture', 'value'].join('-')
    const value = redactWorkerArguments(JSON.stringify({ user: { api_key: marker }, url: `https://user:${marker}@example.invalid/path?access_token=${marker}&view=compact`,
      headers: { Authorization: `Bearer ${marker}` }, command: `tool --token=${marker}`, innocent: 'hello' }))
    expect(value).not.toContain(marker)
    expect(JSON.parse(value).innocent).toBe('hello')
    expect(value).toContain('view=compact')
  })
  it('never sends non-JSON raw argument text and strips known runtime values', () => {
    const marker = ['runtime', 'fixture', 'value'].join('-')
    expect(redactWorkerArguments(`opaque ${marker}`)).not.toContain(marker)
    expect(redactWorkerText(`value is ${marker}`, [marker])).not.toContain(marker)
  })
  it('is stable after redaction so Host verification can reject unsanitized frames', () => {
    const source = JSON.stringify({ nested: { password: 'fixture-value' }, url: 'https://example.invalid/?token=fixture-value', detail: 'Authorization=fixture-value' })
    const once = redactWorkerArguments(source)
    expect(JSON.parse(redactWorkerArguments(once))).toEqual(JSON.parse(once))
  })
})
