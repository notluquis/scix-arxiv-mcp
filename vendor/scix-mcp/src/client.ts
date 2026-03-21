import { getAPIKey, SCIX_API_BASE, REQUEST_TIMEOUT } from './config.js';

export class SciXAPIClient {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = getAPIKey();
    this.baseURL = SCIX_API_BASE;
  }

  async get(endpoint: string, params?: Record<string, any>): Promise<any> {
    const url = new URL(`${this.baseURL}/${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 401) {
        throw new Error('Authentication failed. Check SCIX_API_TOKEN environment variable. Get your key from https://scixplorer.org/user/settings/token');
      }

      if (response.status === 404) {
        throw new Error('Resource not found. Check bibcode format or search query.');
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded (5000 requests/day). Please try again later.');
      }

      if (!response.ok) {
        throw new Error(`SciX API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after 30 seconds');
      }
      throw error;
    }
  }

  async post(endpoint: string, data: any): Promise<any> {
    const url = `${this.baseURL}/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 401) {
        throw new Error('Authentication failed. Check SCIX_API_TOKEN environment variable.');
      }

      if (response.status === 404) {
        throw new Error('Resource not found.');
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded (5000 requests/day).');
      }

      if (!response.ok) {
        throw new Error(`SciX API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after 30 seconds');
      }
      throw error;
    }
  }

  async put(endpoint: string, data: any): Promise<any> {
    const url = `${this.baseURL}/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 401) {
        throw new Error('Authentication failed. Check SCIX_API_TOKEN environment variable.');
      }

      if (response.status === 404) {
        throw new Error('Resource not found.');
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded (5000 requests/day).');
      }

      if (!response.ok) {
        throw new Error(`SciX API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after 30 seconds');
      }
      throw error;
    }
  }

  async delete(endpoint: string): Promise<any> {
    const url = `${this.baseURL}/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 401) {
        throw new Error('Authentication failed. Check SCIX_API_TOKEN environment variable.');
      }

      if (response.status === 404) {
        throw new Error('Resource not found.');
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded (5000 requests/day).');
      }

      if (!response.ok) {
        throw new Error(`SciX API error: ${response.status} ${response.statusText}`);
      }

      // Some endpoints (e.g., library delete) may return 204/empty bodies
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after 30 seconds');
      }
      throw error;
    }
  }
}
