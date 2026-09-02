// Minimal routing + request helpers over node:http. No dependencies.

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      const segs = pathname.split('/').filter(Boolean);
      for (const r of routes) {
        if (r.method !== method || r.parts.length !== segs.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < segs.length; i++) {
          const part = r.parts[i];
          if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segs[i]);
          else if (part !== segs[i]) {
            ok = false;
            break;
          }
        }
        if (ok) return { handler: r.handler, params };
      }
      return null;
    },
  };
}

export async function readJsonBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

export function sendJson(res, status, obj) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}
