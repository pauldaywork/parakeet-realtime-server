interface Props {
  message: string | null;
}

export function ErrorBanner({ message }: Props) {
  if (!message) return null;
  return (
    <div style={{ background: "#fee", border: "1px solid #c33", padding: ".5rem 1rem", marginBottom: "1rem" }}>
      <strong>Error:</strong> {message}
    </div>
  );
}
