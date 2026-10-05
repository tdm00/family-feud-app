import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@feud/shared";
import { io, type Socket } from "socket.io-client";
import { api } from "./api.js";

export function useLiveState(opts: {
  role: "host" | "player" | "display";
  token?: string;
  enabled?: boolean;
}): { snapshot: Snapshot | null; connected: boolean; buzz: (windowId: string) => void } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    api<Snapshot>("/api/state", {
      playerToken: opts.role === "player" ? opts.token : undefined,
      displayToken: opts.role === "display" ? opts.token : undefined,
    })
      .then((next) => {
        if (!cancel) setSnapshot(next);
      })
      .catch(() => undefined);

    const socket = io({
      auth: { role: opts.role, token: opts.token },
      withCredentials: true,
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("state", (next: Snapshot) => setSnapshot(next));
    return () => {
      cancel = true;
      socketRef.current = null;
      socket.disconnect();
    };
  }, [enabled, opts.role, opts.token]);

  return {
    snapshot,
    connected,
    buzz: (windowId: string) => {
      socketRef.current?.emit("buzz", { windowId });
    },
  };
}
