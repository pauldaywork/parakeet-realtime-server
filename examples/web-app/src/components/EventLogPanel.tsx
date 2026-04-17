import type { LoggedEvent } from "../types";

interface Props {
  events: LoggedEvent[];
  onClear: () => void;
}

export function EventLogPanel({ events, onClear }: Props) {
  return (
    <section>
      <h3>Event log <button onClick={onClear} style={{ marginLeft: ".5rem" }}>Clear</button></h3>
      <ol style={{
        border: "1px solid #ccc", padding: ".5rem 1.5rem", margin: 0,
        maxHeight: "16rem", overflowY: "auto", fontFamily: "monospace", fontSize: ".85rem"
      }}>
        {events.map((e, i) => <li key={i}>{formatRow(e)}</li>)}
      </ol>
    </section>
  );
}

function formatRow(e: LoggedEvent): string {
  const ts = new Date(e.timestamp).toISOString().slice(11, 23);
  return `${ts}  ${JSON.stringify(e.event)}`;
}
