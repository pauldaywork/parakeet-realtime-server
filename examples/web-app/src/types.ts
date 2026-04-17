export type ServerEvent =
  | { type: "partial"; text: string }
  | { type: "final";   text: string }
  | { type: "error";   message: string };

export interface LoggedEvent {
  timestamp: number;
  event: ServerEvent | { type: "open" } | { type: "close"; code: number };
}
