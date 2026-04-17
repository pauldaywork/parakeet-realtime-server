import type { HealthState } from "../hooks/useHealth";

export function HealthBadge({ state }: { state: HealthState }) {
  const label = state.error ? `error: ${state.error}`
              : state.ready == null ? "connecting..."
              : state.ready ? "ready"
              : "loading model...";
  const color = state.error ? "#c33"
              : state.ready == null ? "#888"
              : state.ready ? "#0a0"
              : "#c90";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
      <span style={{ width: "0.6rem", height: "0.6rem", borderRadius: "50%", background: color }} />
      <span style={{ fontSize: ".9rem" }}>{label}</span>
    </span>
  );
}
