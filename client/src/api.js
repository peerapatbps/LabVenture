// In production (served via BellBeast proxy), prefix all API calls with /labventure
export const BASE = import.meta.env.PROD ? '/labventure' : '';

// Centralized fetch helper — always sends cookies
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const get = (path, opts) => api(path, opts);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path, body) => api(path, { method: 'DELETE', body });

// Raw file upload (body = the File itself; name travels in X-File-Name)
export async function upload(path, file) {
  const res = await fetch(BASE + path, {
    method: 'POST', credentials: 'include', body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
  if (res.status === 401) throw new Error('Unauthorized');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'ไฟล์ใหญ่เกินกำหนด' : `HTTP ${res.status}`));
  return data;
}
