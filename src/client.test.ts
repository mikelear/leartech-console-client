import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConsoleClient } from './client.js';
import { parseServerFrame, encodeClientFrame } from './protocol.js';

/**
 * FakeWebSocket stands in for the browser WebSocket: it records what the client
 * sent, exposes the subprotocol the handshake used, and lets a test push server
 * frames in. Enough to exercise the client without a socket.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  protocols: string | string[] | undefined;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { wasClean: boolean }) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
    // open on next tick so connect()'s promise can attach handlers first
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ wasClean: true });
  }
  // test helper
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function newClient() {
  return new ConsoleClient({
    url: 'wss://console.example/ws',
    bearer: 'tok-123',
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
}

test('connect carries the bearer in the subprotocol', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  await c.connect();
  const ws = FakeWebSocket.instances.at(-1)!;
  assert.deepEqual(ws.protocols, ['bearer.tok-123']);
});

test('ready surfaces models and tools', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  let gotModels: { id: string }[] = [];
  let gotTools: { name: string }[] = [];
  await c.connect({
    onReady: (m, t) => {
      gotModels = m;
      gotTools = t;
    },
  });
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.push({ kind: 'ready', models: [{ id: 'claude', provider: 'anthropic' }], tools: [{ name: 'gateway__search' }] });
  assert.equal(gotModels[0]?.id, 'claude');
  assert.equal(gotTools[0]?.name, 'gateway__search');
});

test('send writes a message frame with the model', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  await c.connect();
  const ws = FakeWebSocket.instances.at(-1)!;
  c.send('hello', 'glm-4');
  assert.equal(ws.sent.length, 1);
  assert.deepEqual(JSON.parse(ws.sent[0]!), { kind: 'message', text: 'hello', model: 'glm-4' });
});

test('stop writes a stop frame', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  await c.connect();
  const ws = FakeWebSocket.instances.at(-1)!;
  c.stop();
  assert.deepEqual(JSON.parse(ws.sent[0]!), { kind: 'stop' });
});

test('text / usage / turn_end / error dispatch to their handlers', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  const got: string[] = [];
  await c.connect({
    onText: (t) => got.push('text:' + t),
    onUsage: (u) => got.push('usage:' + u.totalTokens),
    onTurnEnd: (r) => got.push('end:' + r),
    onError: (code) => got.push('err:' + code),
  });
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.push({ kind: 'text', text: 'hi' });
  ws.push({ kind: 'usage', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } });
  ws.push({ kind: 'turn_end', finishReason: 'stop' });
  ws.push({ kind: 'error', code: 'model_not_allowed', message: 'no', retryable: false });
  assert.deepEqual(got, ['text:hi', 'usage:3', 'end:stop', 'err:model_not_allowed']);
});

test('a malformed frame becomes a bad_frame error, not a throw', async () => {
  FakeWebSocket.instances = [];
  const c = newClient();
  let code = '';
  await c.connect({ onError: (cd) => (code = cd) });
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.onmessage?.({ data: '{not json' });
  assert.equal(code, 'bad_frame');
});

test('protocol round-trips a client frame', () => {
  const raw = encodeClientFrame({ kind: 'message', text: 'x' });
  assert.equal(raw, '{"kind":"message","text":"x"}');
  const f = parseServerFrame('{"kind":"text","text":"y"}');
  assert.equal(f.kind, 'text');
  assert.equal(f.text, 'y');
});
