import { describe, expect, it } from 'vitest'
import { CardDraftStore } from '../src/client/card-drafts.ts'

// A8: unsaved drafts are keyed by card identity. Two cards' drafts coexist
// without contamination, survive "navigation" (i.e. the store outlives the
// mounted card), and clearing one key never touches another.
describe('PactFlow card draft store', () => {
  it('keeps two cards\' drafts coexisting without contamination', () => {
    const store = new CardDraftStore()
    store.set('validation-profiles:ws-a', 'draft of A')
    store.set('validation-profiles:ws-b', 'draft of B')
    expect(store.get('validation-profiles:ws-a')).toBe('draft of A')
    expect(store.get('validation-profiles:ws-b')).toBe('draft of B')
    store.set('validation-profiles:ws-a', 'edited A')
    expect(store.get('validation-profiles:ws-b')).toBe('draft of B')
  })

  it('clears exactly one key on save or discard', () => {
    const store = new CardDraftStore()
    store.set('validation-profiles:ws-a', 'A')
    store.set('validation-profiles:ws-b', 'B')
    store.clear('validation-profiles:ws-a')
    expect(store.has('validation-profiles:ws-a')).toBe(false)
    expect(store.get('validation-profiles:ws-b')).toBe('B')
  })

  it('clears a whole card family by prefix and notifies subscribers', () => {
    const store = new CardDraftStore()
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    store.set('validation-profiles:ws-a', 'A')
    store.set('worker-policy:ws-a', 'W')
    store.clearAll('validation-profiles:')
    expect(store.has('validation-profiles:ws-a')).toBe(false)
    expect(store.has('worker-policy:ws-a')).toBe(true)
    expect(notifications).toBeGreaterThan(0)
  })

  it('clearAll with no prefix drops everything', () => {
    const store = new CardDraftStore()
    store.set('a', '1')
    store.set('b', '2')
    store.clearAll()
    expect(store.has('a')).toBe(false)
    expect(store.has('b')).toBe(false)
  })
})
