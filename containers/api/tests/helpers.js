/**
 * LINBO Docker - Test Helpers
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * Einfacher HTTP-Client für Tests
 */
class TestClient {
  constructor(baseUrl = API_URL) {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  /**
   * HTTP Request ausführen
   */
  async request(method, path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token && !options.skipAuth) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const fetchOptions = {
      method,
      headers,
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type');

    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      status: response.status,
      headers: response.headers,
      data,
      ok: response.ok,
    };
  }

  // HTTP Methods
  async get(path, options = {}) {
    return this.request('GET', path, options);
  }

  async post(path, body, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  async patch(path, body, options = {}) {
    return this.request('PATCH', path, { ...options, body });
  }

  async delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  /**
   * Login und Token speichern
   */
  async login(username = 'admin', password = 'admin') {
    const response = await this.post('/api/v1/auth/login', { username, password }, { skipAuth: true });
    if (response.ok && response.data?.data?.token) {
      this.token = response.data.data.token;
    }
    return response;
  }

  /**
   * Token setzen
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * Token löschen
   */
  clearToken() {
    this.token = null;
  }
}

/**
 * Zufällige Daten generieren
 */
const generateTestData = {
  hostname: () => `test-pc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
  mac: () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  },
  ip: () => `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  name: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
};

/**
 * Warten
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  TestClient,
  generateTestData,
  sleep,
  API_URL,
};
