/// <reference lib="webworker" />

import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import type { DbReply, DbRequestEnvelope, DbSuccess } from '@/engine/db/protocol';
import { appError } from '@/lib/errors';

/**
 * Owns the database handle. Nothing on the main thread holds a reference to
 * it, which is what keeps SQL confined to this side of the boundary
 * (CLAUDE.md §2.1).
 *
 * Deliberately thin: all behaviour lives in `database.ts` so it can be tested
 * without spawning a worker.
 */

let handle: DatabaseHandle | null = null;

function reply(message: DbReply): void {
  self.postMessage(message);
}

function notInitialised(id: number): void {
  reply({
    id,
    ok: false,
    error: appError('DB_NOT_INITIALISED', 'The database has not been opened yet.', {
      hint: 'Send an "init" request before querying.',
    }),
  });
}

async function handleRequest(envelope: DbRequestEnvelope): Promise<void> {
  const { id, payload } = envelope;

  if (payload.op === 'init') {
    const opened = await openDatabase({
      ...(payload.bytes === undefined ? {} : { bytes: payload.bytes }),
      locateFile: () => '/sql-wasm.wasm',
    });

    if (!opened.ok) {
      reply({ id, ok: false, error: opened.error });
      return;
    }

    handle?.close();
    handle = opened.value;
    reply({ id, ok: true, result: { op: 'init' } });
    return;
  }

  if (handle === null) {
    notInitialised(id);
    return;
  }

  if (payload.op === 'query') {
    const result = handle.query(payload.sql, payload.params);
    reply(
      result.ok
        ? { id, ok: true, result: { op: 'query', ...result.value } satisfies DbSuccess }
        : { id, ok: false, error: result.error },
    );
    return;
  }

  if (payload.op === 'exec') {
    const result = handle.exec(payload.sql, payload.params);
    reply(
      result.ok
        ? { id, ok: true, result: { op: 'exec', ...result.value } satisfies DbSuccess }
        : { id, ok: false, error: result.error },
    );
    return;
  }

  reply({ id, ok: true, result: { op: 'export', bytes: handle.export() } });
}

self.onmessage = (event: MessageEvent<DbRequestEnvelope>) => {
  // A throw here would kill the worker and every in-flight request with it,
  // so every failure is converted into a reply instead.
  void handleRequest(event.data).catch((error: unknown) => {
    reply({
      id: event.data.id,
      ok: false,
      error: appError(
        'DB_ERROR',
        error instanceof Error ? error.message : 'Unknown database worker failure.',
      ),
    });
  });
};
