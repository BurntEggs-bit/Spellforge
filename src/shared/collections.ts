/** A Map that keeps at most `capacity` entries: adding a new key beyond it drops the oldest one added. */
export class BoundedMap<K, V> extends Map<K, V> {
  readonly capacity: number

  constructor(capacity: number) {
    super()
    this.capacity = capacity
  }

  override set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.capacity) {
      const oldest = this.keys().next()
      if (!oldest.done) this.delete(oldest.value)
    }
    return super.set(key, value)
  }
}
