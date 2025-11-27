const { AvitoApiClient } = require('../src/avito/apiClient');

function createResponse(status, bodyObj) {
  const text = JSON.stringify(bodyObj);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return bodyObj; },
    async text() { return text; },
    statusText: '',
  };
}

async function stubFetch(url, options = {}) {
  if (String(url).endsWith('/token')) {
    return createResponse(200, {
      access_token: 'stub-access-token',
      expires_in: 3600,
      token_type: 'bearer',
    });
  }
  return createResponse(200, {
    ok: true,
    url,
    method: options.method || 'GET',
    body: options.body || null,
  });
}

async function main() {
  const client = new AvitoApiClient({
    clientId: 'stub-id',
    clientSecret: 'stub-secret',
    refreshToken: 'stub-refresh',
    fetchImpl: stubFetch,
  });

  const res = await client.request({ path: '/sandbox/test', method: 'GET' });
  console.log('Self-test response:', res);
}

main().catch((err) => {
  console.error('Self-test failed:', err);
  process.exit(1);
});
