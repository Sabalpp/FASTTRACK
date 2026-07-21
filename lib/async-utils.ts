export class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = "OperationTimeoutError";
  }
}

export function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      onTimeout?.();
      reject(new OperationTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  });
}

export function wait(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
