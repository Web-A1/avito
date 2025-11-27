const DEFAULT_API_URL = 'https://api.avito.ru';
const TOKEN_SLACK_MS = 30_000; // обновляем токен за 30с до истечения

class AvitoApiClient {
  constructor({ clientId, clientSecret, refreshToken, apiUrl = DEFAULT_API_URL, fetchImpl }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl || global.fetch;
    if (!this.fetch) {
      throw new Error('fetch не найден. Используйте Node 18+ или передайте fetchImpl (например, из undici).');
    }
    this._accessToken = null;
    this._expiresAt = 0;
  }

  async _refreshAccessToken() {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const resp = await this.fetch(`${this.apiUrl}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.refreshToken)}`,
    });
    const json = await resp.json();
    if (!resp.ok) {
      const err = json && json.error ? `${json.error}: ${json.error_description || ''}` : resp.statusText;
      throw new Error(`Ошибка обновления токена: ${err}`);
    }
    const expiresIn = json.expires_in || 0;
    this._accessToken = json.access_token;
    this._expiresAt = Date.now() + expiresIn * 1000;
    return this._accessToken;
  }

  async _getAccessToken() {
    const now = Date.now();
    if (this._accessToken && now + TOKEN_SLACK_MS < this._expiresAt) {
      return this._accessToken;
    }
    return this._refreshAccessToken();
  }

  async request({ path, method = 'GET', headers = {}, body, query }) {
    const token = await this._getAccessToken();
    const url = new URL(this.apiUrl + path);
    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }
    const resp = await this.fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': body ? 'application/json' : undefined,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!resp.ok) {
      const errMsg = data && data.error ? `${data.error}: ${data.error_description || ''}` : resp.statusText;
      const error = new Error(`Avito API error ${resp.status}: ${errMsg}`);
      error.status = resp.status;
      error.body = data;
      throw error;
    }
    return data;
  }
}

module.exports = { AvitoApiClient, DEFAULT_API_URL };
