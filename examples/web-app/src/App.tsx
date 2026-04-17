import { useCallback, useState } from "react";
import { useHealth } from "./hooks/useHealth";
import { useMicDevices } from "./hooks/useMicDevices";
import { useStreamRecorder } from "./hooks/useStreamRecorder";
import { Controls } from "./components/Controls";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { EventLogPanel } from "./components/EventLogPanel";
import { HealthBadge } from "./components/HealthBadge";
import { ErrorBanner } from "./components/ErrorBanner";
import type { LoggedEvent } from "./types";

export function App() {
  const health = useHealth();
  const { devices, refresh: refreshDevices } = useMicDevices();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [finals, setFinals] = useState<string[]>([]);

  const handleEvent = useCallback((e: LoggedEvent) => setEvents(prev => [...prev, e]), []);
  const handleFinal = useCallback((text: string) => setFinals(prev => [...prev, text]), []);

  const recorder = useStreamRecorder({ deviceId, onEvent: handleEvent, onFinal: handleFinal });

  const partial = events.length > 0 && events[events.length - 1]!.event.type === "partial"
    ? (events[events.length - 1]!.event as { type: "partial"; text: string }).text
    : "";

  const handleRecord = () => {
    if (recorder.recording) {
      void recorder.stop();
    } else {
      setEvents([]); setFinals([]);
      void recorder.start();
    }
  };

  return (
    <>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>parakeet-realtime-server demo</h1>
        <HealthBadge state={health} />
      </header>
      <ErrorBanner message={recorder.error} />
      <Controls
        devices={devices}
        selectedDeviceId={deviceId}
        onSelectDevice={setDeviceId}
        onRefreshDevices={() => void refreshDevices()}
        recording={recorder.recording}
        onRecordToggle={handleRecord}
        canRecord={health.ready === true}
      />
      <TranscriptPanel finals={finals} partial={partial} />
      <EventLogPanel events={events} onClear={() => setEvents([])} />
    </>
  );
}
