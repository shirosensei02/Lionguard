export const api: typeof chrome = (globalThis as any).chrome ?? (globalThis as any).browser;

export function getCurrentHost(url?: string): string | null {
  try {
    const u = new URL(url ?? location.href);
    return u.hostname;
  } catch { return null; }
}

export const storage = {
  async get<T = any>(keys?: string | string[] | { [key: string]: any }): Promise<T> {
    return new Promise((resolve) => api.storage.sync.get(keys as any, (v) => resolve(v as T)));
  },
  async set(items: Record<string, any>): Promise<void> {
    return new Promise((resolve) => api.storage.sync.set(items, () => resolve()));
  }
};