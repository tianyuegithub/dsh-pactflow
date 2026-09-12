import { useSyncExternalStore } from 'react'

/**
 * Per-card unsaved draft store (A8): drafts are keyed by card identity so two
 * cards' unsaved state coexists without contamination, survives navigating
 * between cards, and clearing one key never touches another. In-memory only —
 * drafts deliberately do not survive a page reload or outlive the drawer.
 */
export class CardDraftStore {
  private readonly drafts = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  getSnapshot = (): number => this.version

  /** Raw stored draft for a key, or undefined when the card has no draft. */
  get(key: string): string | undefined {
    return this.drafts.get(key)
  }

  set(key: string, value: string): void {
    this.drafts.set(key, value)
    this.emit()
  }

  clear(key: string): void {
    if (!this.drafts.delete(key)) return
    this.emit()
  }

  clearAll(prefix?: string): void {
    if (prefix === undefined) {
      if (this.drafts.size === 0) return
      this.drafts.clear()
    } else {
      for (const key of [...this.drafts.keys()]) {
        if (key.startsWith(prefix)) this.drafts.delete(key)
      }
    }
    this.emit()
  }

  has(key: string): boolean {
    return this.drafts.has(key)
  }
}

/** The drawer-wide store; card identity lives entirely in the key. */
export const cardDrafts = new CardDraftStore()

/** Read one card's draft reactively: undefined = clean, string = unsaved draft. */
export function useCardDraft(key: string): readonly [string | undefined, (value: string) => void, () => void] {
  useSyncExternalStore(cardDrafts.subscribe, cardDrafts.getSnapshot)
  return [
    cardDrafts.get(key),
    (value: string) => cardDrafts.set(key, value),
    () => cardDrafts.clear(key),
  ]
}
