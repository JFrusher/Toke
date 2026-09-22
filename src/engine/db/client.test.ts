import { describe, expect, it, vi } from 'vitest';
import { createDbClient } from '@/engine/db/client';
import type { DbReply, DbRequestEnvelope, Transport } from '@/engine/db/protocol';
import { isErr, isOk } from '@/lib/result';

/**
 * The client is tested against a fake Transport rather than a real Worker.
 * Correlation, error mapping and concurrency are the behaviours that matter,
 * and none of them need a thread to exercise.
 */

type Responder = (request: DbRequestEnvelope) => DbReply | Promise<DbReply> | null;

type FakeTransport = Transport & {
  readonly sent: DbRequestEnvelope[];
  /** Push a reply in whenever the test chooses, to control ordering. */
  deliver(reply: DbReply): void;
};

function fakeTransport(respond: Responder): FakeTransport {
  let handler: ((reply: DbReply) => void) | null = null;
  const sent: DbRequestEnvelope[] = [];

  return {
    sent,
    post(request) {
      sent.push(request);
      void Promise.resolve(respond(request)).then((reply) => {
        if (reply !== null) handler?.(reply);
      });
    },
    onMessage(next) {
      handler = next;
    },
    deliver(reply) {
      handler?.(reply);
    },
    terminate: vi.fn(),
  };
}

/** `sql` exists only on the query/exec variants of the request union. */
function sqlOf(request: DbRequestEnvelope): string {
  return 'sql' in request.payload ? request.payload.sql : '';
}

function okReply(id: number, rows: Record<string, unknown>[] = []): DbReply {
  return {
    id,
    ok: true,
    result: { op: 'query', rows: rows as never, columns: [] },
  };
}

describe('correlation', () => {
  it('resolves each call with its own reply', async () => {
    const client = createDbClient(
      fakeTransport((request) => okReply(request.id, [{ sql: sqlOf(request) }])),
    );

    const result = await client.query('SELECT 1');
    if (!isOk(result)) throw new Error('expected ok');
    expect(result.value.rows).toEqual([{ sql: 'SELECT 1' }]);
  });

  it('keeps ten concurrent queries correctly paired with their replies', async () => {
    // Replies come back in reverse order to prove the client matches on id
    // rather than on arrival order.
    const pending: DbRequestEnvelope[] = [];
    const transport = fakeTransport((request) => {
      pending.push(request);
      return null;
    });
    const client = createDbClient(transport);

    const promises = Array.from({ length: 10 }, (_, i) => client.query(`SELECT ${i}`));

    await vi.waitFor(() => expect(pending).toHaveLength(10));
    for (const request of [...pending].reverse()) {
      transport.deliver(okReply(request.id, [{ sql: sqlOf(request) }]));
    }

    const results = await Promise.all(promises);
    results.forEach((result, i) => {
      if (!isOk(result)) throw new Error('expected ok');
      expect(result.value.rows).toEqual([{ sql: `SELECT ${i}` }]);
    });
  });

  it('gives every request a unique id', async () => {
    const transport = fakeTransport((request) => okReply(request.id));
    const client = createDbClient(transport);

    await Promise.all([client.query('a'), client.query('b'), client.query('c')]);
    const ids = transport.sent.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('error handling', () => {
  it('resolves with Err rather than rejecting on a SQL error', async () => {
    // A rejected promise would need try/catch at every call site and would
    // surface as an unhandled rejection the first time one is missed.
    const client = createDbClient(
      fakeTransport((request) => ({
        id: request.id,
        ok: false,
        error: { code: 'SQL_ERROR', message: 'no such table: nope' },
      })),
    );

    const result = await client.query('SELECT * FROM nope');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('SQL_ERROR');
      expect(result.error.message).toMatch(/nope/);
    }
  });

  it('stays usable after an error', async () => {
    let calls = 0;
    const client = createDbClient(
      fakeTransport((request) => {
        calls += 1;
        return calls === 1
          ? { id: request.id, ok: false, error: { code: 'SQL_ERROR', message: 'bad' } }
          : okReply(request.id, [{ ok: 1 }]);
      }),
    );

    await client.query('bad');
    const second = await client.query('SELECT 1');
    expect(isOk(second)).toBe(true);
  });

  it('ignores a reply whose id it does not recognise', async () => {
    const transport = fakeTransport((request) => okReply(request.id));
    const client = createDbClient(transport);

    expect(() => transport.deliver(okReply(9999))).not.toThrow();
    expect(isOk(await client.query('SELECT 1'))).toBe(true);
  });
});

describe('lifecycle', () => {
  it('terminates the transport on close', () => {
    const transport = fakeTransport((request) => okReply(request.id));
    const client = createDbClient(transport);
    client.close();
    expect(transport.terminate).toHaveBeenCalled();
  });

  it('fails in-flight calls when closed rather than leaving them hanging', async () => {
    const transport = fakeTransport(() => null);
    const client = createDbClient(transport);

    const inFlight = client.query('SELECT 1');
    client.close();

    const result = await inFlight;
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('DB_CLOSED');
    }
  });
});
