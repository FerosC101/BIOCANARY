export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Offline = (method: string, path: string, body?: unknown) => Promise<unknown>
let offline: Offline | null = null
/** Route every request to the offline demo instead of the server (see lib/demo.ts). */
export const setOffline = (h: Offline) => {
  offline = h
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (offline) return (await offline(method, path, body)) as T
  let res: Response
  try {
    res = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'The BIOCANARY server cannot be reached.')
  }
  if (!res.ok) {
    let message = 'The server could not complete this request.'
    try {
      const detail = (await res.json()).detail
      if (typeof detail === 'string') message = detail
    } catch {
      // keep the generic message: the response body was not JSON
    }
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('biocanary:signed-out'))
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const get = <T>(path: string) => request<T>('GET', path)
export const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body)
export const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
