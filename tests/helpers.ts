// Test doubles for core's interfaces.
import type { HttpClient, HttpRequest, HttpResponse, Storage, StorageChanges } from '../core/interfaces';

/** A Storage kept in memory, with chrome.storage's get-with-defaults behaviour. */
export class MemoryStorage implements Storage {
  data: Record<string, unknown> = {};
  private listeners: ((changes: StorageChanges) => void)[] = [];

  constructor(initial: Record<string, unknown> = {}) {
    this.data = structuredClone(initial);
  }

  async get<T extends object>(defaults: T): Promise<T> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) out[key] = key in this.data ? structuredClone(this.data[key]) : (defaults as any)[key];
    return out as T;
  }

  async set(values: Record<string, unknown>): Promise<void> {
    const changes: StorageChanges = {};
    for (const [key, value] of Object.entries(values)) {
      changes[key] = { oldValue: this.data[key], newValue: value };
      this.data[key] = structuredClone(value);
    }
    this.listeners.forEach((l) => l(changes));
  }

  onChanged(listener: (changes: StorageChanges) => void): void {
    this.listeners.push(listener);
  }
}

/** An HttpClient that answers from a function and records every request. */
export class FakeHttp implements HttpClient {
  requests: HttpRequest[] = [];
  constructor(private answer: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(structuredClone(request));
    return this.answer(request);
  }
}
