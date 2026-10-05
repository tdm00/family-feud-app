export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    playerToken?: string;
    displayToken?: string;
  },
): Promise<T> {
  const headers = new Headers();
  if (opts?.body !== undefined) headers.set("content-type", "application/json");
  if (opts?.playerToken) headers.set("x-player-token", opts.playerToken);
  if (opts?.displayToken) headers.set("x-display-token", opts.displayToken);
  const res = await fetch(path, {
    method: opts?.method ?? (opts?.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error || "Request failed", res.status);
  return data as T;
}

export const PLAYER_TOKEN_KEY = "feud.playerToken";
export const DISPLAY_TOKEN_KEY = "feud.displayToken";
