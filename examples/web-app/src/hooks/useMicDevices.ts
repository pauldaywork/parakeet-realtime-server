import { useCallback, useEffect, useState } from "react";

export interface MicDevice {
  deviceId: string;
  label: string;
}

export function useMicDevices() {
  const [devices, setDevices] = useState<MicDevice[]>([]);

  const refresh = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch { /* user will see a friendlier error later */ }
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all
      .filter(d => d.kind === "audioinput")
      .map(d => ({ deviceId: d.deviceId, label: d.label || "(unnamed mic)" })));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { devices, refresh };
}
