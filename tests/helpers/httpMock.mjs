export function createMockReq({ method = 'GET', url = '/', query = {}, headers = {}, body = undefined } = {}) {
  return {
    method,
    url,
    query,
    headers,
    body,
  };
}

export function createMockRes() {
  const headers = new Map();

  return {
    statusCode: 200,
    ended: false,
    body: '',
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(payload = '') {
      this.ended = true;
      this.body = String(payload || '');
    },
    jsonBody() {
      try {
        return JSON.parse(this.body || '{}');
      } catch {
        return {};
      }
    },
  };
}
