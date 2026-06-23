import { useState, useEffect, useRef } from "react";

export default function SessionTimer({ sessionExpiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!sessionExpiresAt) return;
    const tick = () => {
      const now = Date.now();
      const diff = Math.max(0, sessionExpiresAt - now);
      setRemaining(diff);
      if (diff === 0) {
        clearInterval(intervalRef.current);
        onExpire?.();
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [sessionExpiresAt, onExpire]);

  if (remaining === null) return null;

  const totalMs = 15 * 60 * 1000;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const pct = Math.max(0, (remaining / totalMs) * 100);
  const isWarning = remaining <= 2 * 60 * 1000;
  const isCritical = remaining <= 60 * 1000;
  const expired = remaining === 0;

  const color = expired || isCritical ? "text-rose-400" : isWarning ? "text-amber-400" : "text-slate-400";
  const barColor = expired || isCritical ? "bg-rose-500" : isWarning ? "bg-amber-500" : "bg-violet-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-500 uppercase tracking-wider font-bold">
          {expired ? "Session Expired" : isWarning ? "⚠ Session Expiring Soon" : "Session Valid"}
        </span>
        <span className={`font-mono font-bold ${color} ${isCritical && !expired ? "animate-timer-warning" : ""}`}>
          {expired ? "00:00" : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
        </span>
      </div>
      <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
