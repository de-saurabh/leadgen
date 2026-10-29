export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers: init.json !== undefined ? { 'content-type': 'application/json' } : {},
    body: init.json !== undefined ? JSON.stringify(init.json) : null,
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
