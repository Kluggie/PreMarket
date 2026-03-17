export function createMockReq({ method = 'GET', url = '/', query = {}, headers = {}, body = undefined } = {}) {
  return {
    method,
    url,
    query,
    headers,
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

export function createMockRes() {
  const headers = new Map();
  const self = {
    statusCode: 200,
    ended: false,
    body: '',
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    /** Express-style res.status(code).json(body) chaining */
    status(code) {
      self.statusCode = code;
      return self;
    },
    json(payload) {
      self.ended = true;
      self.body = JSON.stringify(payload || {});
      return self;
    },
    end(payload = '') {
      self.ended = true;
      self.body = String(payload || '');
    },
    jsonBody() {
      try {
        return JSON.parse(self.body || '{}');
      } catch {
        return {};
      }
    },
  };
  return self;
}
