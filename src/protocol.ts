/**
 * The console WebSocket protocol — the TS mirror of leartech-console-api's
 * internal/consolewire Go types.
 *
 * ONE VOCABULARY, TWO ENDS. These frames must stay identical to the Go side:
 * the browser and the server agree on exactly one set of messages, so a change
 * lands in both or in neither. Field names match the Go json tags verbatim.
 */

// ── Upstream: browser → server ───────────────────────────────────────────────

export type ClientKind = 'message' | 'stop';

export interface ClientFrame {
  kind: ClientKind;
  /** The user's message (kind === 'message'). */
  text?: string;
  /** Model id for this turn; empty uses the connection's current/default. */
  model?: string;
}

// ── Downstream: server → browser ─────────────────────────────────────────────

export type ServerKind =
  | 'ready'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'usage'
  | 'turn_end'
  | 'error';

export interface ModelInfo {
  id: string;
  provider?: string;
}

export interface ToolInfo {
  name: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ServerFrame {
  kind: ServerKind;

  // ready
  models?: ModelInfo[];
  tools?: ToolInfo[];

  // text / tool
  text?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  finishReason?: string;

  // usage
  usage?: Usage;

  // error
  code?: string;
  message?: string;
  retryable?: boolean;
}

/** Parse a raw text frame from the server into a typed ServerFrame. */
export function parseServerFrame(data: string): ServerFrame {
  return JSON.parse(data) as ServerFrame;
}

/** Encode a client frame for sending. */
export function encodeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}
