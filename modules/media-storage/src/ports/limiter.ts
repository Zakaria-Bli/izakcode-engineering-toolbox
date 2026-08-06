export interface CompletionLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>
}
