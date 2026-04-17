import { useEffect, useState } from "react";
import { CONFIG } from "../config";

export interface HealthState {
  ready: boolean | null;
  error: string | null;
}

export function useHealth(pollMs = 3000): HealthState {
  const [state, setState] = useState<HealthState>({ ready: null, error: null });
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${CONFIG.httpBase}/health`);
        if (cancelled) return;
        if (!res.ok) { setState({ ready: null, error: `HTTP ${res.status}` }); return; }
        const body = await res.json() as { ready?: boolean };
        setState({ ready: body.ready === true, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ ready: null, error: err instanceof Error ? err.message : String(err) });
      }
    };
    void tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);
  return state;
}
