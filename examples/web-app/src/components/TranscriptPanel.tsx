interface Props {
  finals: string[];
  partial: string;
}

export function TranscriptPanel({ finals, partial }: Props) {
  return (
    <section>
      <h3>Transcript</h3>
      <div style={{
        border: "1px solid #ccc", padding: "1rem", minHeight: "6rem",
        whiteSpace: "pre-wrap", fontFamily: "system-ui, sans-serif"
      }}>
        {finals.map((t, i) => <div key={i}>{t}</div>)}
        {partial && <div style={{ color: "#888", fontStyle: "italic" }}>{partial}</div>}
      </div>
    </section>
  );
}
