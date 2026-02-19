import { json } from './http.js';

export function ok(res, statusCode, payload = {}) {
  json(res, statusCode, {
    ok: true,
    ...payload,
  });
}

export function fail(res, statusCode, code, message, extra = {}) {
  json(res, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  });
}
