export class DeadlineExceeded extends Error {
  constructor() {
    super("요청 시간 한도에 도달했습니다.");
  }
}

export type Deadline = { signal: AbortSignal; remainingMs: () => number };

export async function withDeadline<T>(ms: number, run: (deadline: Deadline) => Promise<T>, startedAt = Date.now(), clock = Date.now): Promise<T> {
  const controller = new AbortController();
  const signal = controller.signal;
  const wallTimeRemaining = Math.max(0, startedAt + ms - Date.now());
  const expiresAt = clock() + wallTimeRemaining;
  const expire = () => controller.abort(new DeadlineExceeded());
  const remainingMs = () => {
    const remaining = expiresAt - clock();
    if (remaining <= 0) expire();
    signal.throwIfAborted();
    return remaining;
  };
  const expired = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const timer = setTimeout(expire, wallTimeRemaining);
  try {
    return await Promise.race([expired, run({ signal, remainingMs })]);
  } finally {
    clearTimeout(timer);
  }
}
