# @mikelear/leartech-console-client

The browser TypeScript client to **leartech-console-api** — the Ship Proven
console middle layer. It opens the console WebSocket, sends the user's turns, and
surfaces the server's streamed agent events through a small callback interface.

It is the **TS mirror of the Go `agent-core` / `consolewire` contract**: the same
frame vocabulary on both ends, so the browser and the server cannot drift — a
protocol change lands in both or in neither.

## Why it exists

`leartech-sp-web` (the Angular console) was first built talking **directly** to
the ai-gateway from the browser — a thin proof. That can't be the end state: the
browser can't hold a minted gateway key safely, and the shell's tools are the
Mac's, not a browser's. The middle layer (`console-api`) runs the agent loop
server-side; this package is how the browser talks to it.

## Use

```ts
import { ConsoleClient } from '@mikelear/leartech-console-client';

const client = new ConsoleClient({
  url: 'wss://leartech-console-api-ship-proven.jx.leartech.com/ws',
  bearer: accessToken, // the signed-in user's OIDC access token
});

await client.connect({
  onReady: (models, tools) => { /* render the model picker + tool summary */ },
  onText:  (delta)        => { /* append to the streaming assistant bubble */ },
  onToolCall: (name, args) => { /* show "→ name(args)" in the transcript */ },
  onUsage: (u)            => { /* show tokens/cost */ },
  onTurnEnd: (reason)     => { /* close the bubble */ },
  onError: (code, msg)    => { /* surface the error */ },
});

client.send('Summarise the deploy-video-site plan', 'claude-sonnet-4');
client.stop();   // ask the server to stop the in-flight turn
client.close();
```

### Auth

The bearer rides the WebSocket handshake as the `bearer.<token>` subprotocol —
the one handshake header a browser WebSocket can set (`EventSource` / a plain
WebSocket cannot send `Authorization`). `console-api`'s `wshub` validates it
against the estate Verifier before the upgrade completes.

## Contract source of truth

`src/protocol.ts` mirrors `leartech-console-api/internal/consolewire` (Go). Field
names match the Go json tags verbatim. When the Go side adds a frame, add it here
in the same PR train.

## Build / test

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node --test (fake WebSocket; no socket needed)
npm run lint
```

Published to GitHub Packages as `@mikelear/leartech-console-client`.
