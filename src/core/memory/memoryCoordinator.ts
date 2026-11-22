import type { MemoryCoordinator } from "../contracts/types";

export class LocalMemoryCoordinator implements MemoryCoordinator {
  private llmReleaser: (() => Promise<void>) | null = null;
  private heavyLock: Promise<void> = Promise.resolve();

  registerLlmReleaser(fn: () => Promise<void>): void {
    this.llmReleaser = fn;
  }

  async releaseLlmIfLoaded(): Promise<void> {
    if (this.llmReleaser) {
      await this.llmReleaser();
    }
  }

  async acquireHeavyTask(task: "ocr" | "pdf" | "llm"): Promise<() => Promise<void>> {
    let releaseQueue!: () => void;
    const prev = this.heavyLock;
    this.heavyLock = new Promise<void>((res) => {
      releaseQueue = res;
    });

    await prev;

    if (task === "ocr" || task === "pdf") {
      try {
        await this.releaseLlmIfLoaded();
      } catch {
        // Proceed with heavy task even if optional LLM releaser warns
      }
    }

    let released = false;
    return async () => {
      if (!released) {
        released = true;
        releaseQueue();
      }
    };
  }
}

export class MemoryCoordinatorNoop implements MemoryCoordinator {
  private llmReleaser: (() => Promise<void>) | null = null;

  registerLlmReleaser(fn: () => Promise<void>): void {
    this.llmReleaser = fn;
  }

  async acquireHeavyTask(_task: "ocr" | "pdf" | "llm"): Promise<() => Promise<void>> {
    return async () => undefined;
  }

  async releaseLlmIfLoaded(): Promise<void> {
    if (this.llmReleaser) {
      await this.llmReleaser();
    }
  }
}
