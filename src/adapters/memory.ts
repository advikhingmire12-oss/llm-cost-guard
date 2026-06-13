export interface StorageAdapter {
  get(key: string): Promise<number>;
  set(key: string, value: number, ttlSeconds?: number): Promise<void>;
  increment(key: string, by: number): Promise<number>;
}

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, { value: number; expiresAt?: number }>();

  async get(key: string): Promise<number> {
    const entry = this.store.get(key);

    if (!entry) {
      return 0;
    }

    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return 0;
    }

    return entry.value;
  }

  async set(key: string, value: number, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined
        ? Date.now() + ttlSeconds * 1000
        : undefined;

    this.store.set(key, { value, expiresAt });
  }

  async increment(key: string, by: number): Promise<number> {
    const entry = this.store.get(key);
    const current = await this.get(key);
    const newValue = current + by;

    let ttlSeconds: number | undefined;
    if (entry?.expiresAt !== undefined) {
      ttlSeconds = Math.max(
        0,
        Math.ceil((entry.expiresAt - Date.now()) / 1000)
      );
    }

    await this.set(key, newValue, ttlSeconds);
    return newValue;
  }
}
