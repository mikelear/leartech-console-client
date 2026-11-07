/**
 * ConsoleClient — the browser's typed client to leartech-console-api.
 *
 * It owns one WebSocket to the console middle layer, authenticated at the
 * handshake (the bearer rides the `bearer.<token>` subprotocol, because a
 * browser WebSocket cannot set an Authorization header). It sends user turns and
 * surfaces the server's streamed frames through a small callback interface — the
 * same event vocabulary the Go side produces, so the console UI reasons over one
 * shape whether it is talking to this client or (in tests) a fake.
 *
 * It is deliberately transport-only: it knows the frames, not the agent. Model
 * choice, transcript state and rendering belong to the caller.
 */

import {
  ClientFrame,
  ModelInfo,
  ServerFrame,
  ToolInfo,
  Usage,
  encodeClientFrame,
  parseServerFrame,
} from './protocol.js';

/** Callbacks the console UI supplies; every one is optional. */
export interface ConsoleHandlers {
  /** The connection is open and the server sent its capabilities. */
  onReady?: (models: ModelInfo[], tools: ToolInfo[]) => void;
  /** An assistant text delta. */
  onText?: (text: string) => void;
  /** The model asked for a tool (shown in the transcript). */
  onToolCall?: (name: string, argsJson: string) => void;
  /** A tool result fed back (shown so the user sees what the agent did). */
  onToolResult?: (result: string) => void;
  /** The turn's token/cost figures. */
  onUsage?: (usage: Usage) => void;
  /** The assistant turn finished (finish reason). */
  onTurnEnd?: (finishReason: string) => void;
  /** A terminal error for the turn, or the connection. */
  onError?: (code: string, message: string, retryable: boolean) => void;
  /** The socket closed (clean or not). */
  onClose?: (clean: boolean) => void;
}

export interface ConsoleClientOptions {
  /** wss:// URL of console-api's /ws endpoint. */
  url: string;
  /** The signed-in user's bearer (OIDC access token). */
  bearer: string;
  /**
   * WebSocket implementation. Defaults to the global `WebSocket` (browser); a
   * test injects a fake so the client is exercised without a socket.
   */
  WebSocketImpl?: typeof WebSocket;
}

export class ConsoleClient {
  private ws: WebSocket | null = null;
  private readonly opts: ConsoleClientOptions;
  private handlers: ConsoleHandlers = {};

  constructor(opts: ConsoleClientOptions) {
    this.opts = opts;
  }

  /** Open the connection. Resolves when the socket opens (before `ready`). */
  connect(handlers: ConsoleHandlers = {}): Promise<void> {
    this.handlers = handlers;
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    // The bearer rides the subprotocol — `bearer.<token>` — the one handshake
    // header a browser WebSocket can influence. console-api's wshub reads it.
    this.ws = new Impl(this.opts.url, [`bearer.${this.opts.bearer}`]);

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('no websocket'));
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('websocket connection failed'));
      this.ws.onmessage = (ev: MessageEvent) => this.dispatch(String(ev.data));
      this.ws.onclose = (ev: CloseEvent) => this.handlers.onClose?.(ev.wasClean);
    });
  }

  /** Send a user turn. `model` is optional (server uses its default). */
  send(text: string, model?: string): void {
    const frame: ClientFrame = { kind: 'message', text };
    if (model) {
      frame.model = model;
    }
    this.write(frame);
  }

  /** Ask the server to stop the in-flight turn at its next boundary. */
  stop(): void {
    this.write({ kind: 'stop' });
  }

  /** Close the connection. */
  close(): void {
    this.ws?.close();
  }

  private write(frame: ClientFrame): void {
    this.ws?.send(encodeClientFrame(frame));
  }

  private dispatch(raw: string): void {
    let f: ServerFrame;
    try {
      f = parseServerFrame(raw);
    } catch {
      this.handlers.onError?.('bad_frame', 'could not parse a server frame', false);
      return;
    }
    switch (f.kind) {
      case 'ready':
        this.handlers.onReady?.(f.models ?? [], f.tools ?? []);
        break;
      case 'text':
        if (f.text) this.handlers.onText?.(f.text);
        break;
      case 'tool_call':
        this.handlers.onToolCall?.(f.toolName ?? '', f.toolArgs ?? '');
        break;
      case 'tool_result':
        this.handlers.onToolResult?.(f.toolResult ?? '');
        break;
      case 'usage':
        if (f.usage) this.handlers.onUsage?.(f.usage);
        break;
      case 'turn_end':
        this.handlers.onTurnEnd?.(f.finishReason ?? 'stop');
        break;
      case 'error':
        this.handlers.onError?.(f.code ?? 'error', f.message ?? 'error', Boolean(f.retryable));
        break;
    }
  }
}
