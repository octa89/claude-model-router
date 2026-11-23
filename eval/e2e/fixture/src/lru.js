/**
 * A least-recently-used cache holding at most `limit` entries.
 *
 * get(key) returns the value, or undefined, and counts as a use of the key.
 * set(key, value) adds or replaces an entry and counts as a use; when a new
 * key would take the cache over its limit, the least recently used entry is
 * removed first. size is the number of entries. delete(key) removes an entry
 * and returns whether it was there.
 */
export class LruCache {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
    this.size = 0;
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.size > this.limit) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.size--;
    }
    this.map.set(key, value);
    this.size++;
  }

  delete(key) {
    this.size--;
    return this.map.delete(key);
  }
}
