// A shared request queue for an API with a per-IP rate limit (iTunes,
// MusicBrainz). Every call to that API goes through one queue, so the app
// as a whole stays under the limit however many callers fire at once,
// rather than each call site needing its own rate-limit awareness.
//
// Requests *start* at most once per `intervalMs` on average, but a slow one
// doesn't hold up the next — rate limits count requests made, not requests
// in flight. `burst` lets up to that many start back to back, as long as no
// more than `burst` start within any `burst * intervalMs` window — the same
// average rate, for an API whose limit is a per-minute budget (iTunes)
// rather than a strict per-second spacing (MusicBrainz, burst 1).
//
// It's priority-ordered, not plain FIFO: something a person is waiting on
// right now (a search, a tracklist) jumps ahead of queued background work
// (the batch lookups behind the cached home rows). Without that, a search
// could end up waiting behind dozens of already-queued background lookups.
export const PRIORITY_INTERACTIVE = 0;
export const PRIORITY_BACKGROUND = 1;

type QueuedTask = { start: () => void; priority: number };

export function createPacedQueue(intervalMs: number, burst = 1) {
  const queue: QueuedTask[] = [];
  const windowMs = intervalMs * burst;
  // Start times within the current window, oldest first.
  const recentStarts: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump() {
    if (timer || queue.length === 0) return;
    const now = Date.now();
    while (recentStarts.length > 0 && recentStarts[0] <= now - windowMs) {
      recentStarts.shift();
    }
    const delay =
      recentStarts.length < burst ? 0 : recentStarts[0] + windowMs - now;
    timer = setTimeout(() => {
      timer = null;
      const task = queue.shift();
      if (!task) return;
      recentStarts.push(Date.now());
      task.start();
      pump();
    }, delay);
  }

  // Runs `fn` once its turn comes up. `fn` itself is only called then, so
  // anything time-sensitive inside it (a request timeout) starts counting
  // when the request is actually made, not while it waits in line.
  return function enqueue<T>(fn: () => Promise<T>, priority: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: QueuedTask = {
        start: () => {
          fn().then(resolve, reject);
        },
        priority,
      };
      // After every queued task of equal-or-higher priority (lower number =
      // higher priority): arrival order within a tier, but a higher-priority
      // arrival cuts the line.
      const index = queue.findIndex((t) => t.priority > priority);
      if (index === -1) queue.push(task);
      else queue.splice(index, 0, task);
      pump();
    });
  };
}
