import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { createLatestRequest } from "../../api/latestRequest";
export default function NotificationBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const gate = createLatestRequest();
    const load = () => {
      const request = gate.start();
      void apiRequest<{ unreadCount: number }>("/api/notifications?limit=1", { signal: request.signal }).then(data => { if (request.isCurrent()) setCount(data.unreadCount); }).catch(() => {});
    };
    load(); const timer = window.setInterval(load, 60_000);
    window.addEventListener("mediflow:notifications-changed", load); window.addEventListener("focus", load);
    return () => { gate.invalidate(); window.clearInterval(timer); window.removeEventListener("mediflow:notifications-changed", load); window.removeEventListener("focus", load); };
  }, []);
  return count ? <span aria-label={`${count} unread notifications`} className="ml-auto min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">{count > 99 ? "99+" : count}</span> : null;
}
