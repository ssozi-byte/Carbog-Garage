/**
 * Minimal in-process TTL cache for public, read-heavy content.
 * (Per Spec §41 low-bandwidth caching. Redis replaces this in Phase 8
 * if multi-instance deployment requires shared caching.)
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>()

  constructor(private readonly ttlMs: number = 60_000) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  async wrap<U extends T>(key: string, producer: () => Promise<U>): Promise<U> {
    const cached = this.get(key)
    if (cached !== undefined) return cached as U
    const value = await producer()
    this.set(key, value)
    return value
  }
}
