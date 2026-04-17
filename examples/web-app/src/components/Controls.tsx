import type { MicDevice } from "../hooks/useMicDevices";

interface Props {
  devices: MicDevice[];
  selectedDeviceId: string | null;
  onSelectDevice: (id: string | null) => void;
  onRefreshDevices: () => void;
  recording: boolean;
  onRecordToggle: () => void;
  canRecord: boolean;
}

export function Controls(p: Props) {
  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
      <label>
        Mic:{" "}
        <select
          value={p.selectedDeviceId ?? ""}
          onChange={e => p.onSelectDevice(e.target.value || null)}
        >
          <option value="">(default)</option>
          {p.devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
      <button onClick={p.onRefreshDevices}>Refresh mics</button>
      <button onClick={p.onRecordToggle} disabled={!p.canRecord && !p.recording}>
        {p.recording ? "Stop" : "Record"}
      </button>
    </div>
  );
}
