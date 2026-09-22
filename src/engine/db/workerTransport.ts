import type { DbReply, DbRequestEnvelope, Transport } from '@/engine/db/protocol';

/**
 * Real Worker transport. Kept apart from `client.ts` so the client can be
 * tested without a thread — this file is the only part that needs a browser.
 *
 * `new URL(..., import.meta.url)` is the form bundlers recognise; a string
 * path would not be traced and the worker would 404 in production.
 */
export function createWorkerTransport(): Transport {
  const worker = new Worker(new URL('./db.worker.ts', import.meta.url), {
    type: 'module',
  });

  return {
    post(request: DbRequestEnvelope) {
      worker.postMessage(request);
    },
    onMessage(handler: (reply: DbReply) => void) {
      worker.onmessage = (event: MessageEvent<DbReply>) => handler(event.data);
    },
    terminate() {
      worker.terminate();
    },
  };
}
