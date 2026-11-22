import {
  AsyncLocalStorageProviderSingleton,
  type AsyncLocalStorageInterface,
} from "@langchain/core/singletons";

/**
 * Polyfill determinista de AsyncLocalStorage para navegador y Capacitor WebView.
 * Combinado con la cola FIFO única en GraphRunner garantiza que interrupt() siempre
 * resuelva getStore() sin pérdidas durante ejecuciones asíncronas.
 */
export class BrowserAsyncLocalStorage<T = unknown> implements AsyncLocalStorageInterface {
  private readonly stack: Array<T | undefined> = [];

  getStore(): T | undefined {
    if (this.stack.length === 0) return undefined;
    return this.stack[this.stack.length - 1];
  }

  enterWith(store: T): void {
    if (this.stack.length === 0) {
      this.stack.push(store);
    } else {
      this.stack[this.stack.length - 1] = store;
    }
  }

  disable(): void {
    this.stack.length = 0;
  }

  private popStore(expected: T | undefined): void {
    if (this.stack.length === 0) return;
    if (this.stack[this.stack.length - 1] === expected) {
      this.stack.pop();
      return;
    }
    const idx = this.stack.lastIndexOf(expected);
    if (idx >= 0) {
      this.stack.splice(idx, 1);
    }
  }

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    this.stack.push(store);
    try {
      const result = callback(...args);
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        return (result as unknown as Promise<unknown>).finally(() => {
          this.popStore(store);
        }) as unknown as R;
      }
      this.popStore(store);
      return result;
    } catch (err) {
      this.popStore(store);
      throw err;
    }
  }

  exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    return this.run(undefined as unknown as T, callback, ...args);
  }
}

export { BrowserAsyncLocalStorage as AsyncLocalStorage };

export function ensureBrowserAsyncLocalStorageInitialized(): void {
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new BrowserAsyncLocalStorage());
}
