import { request, type Dispatcher } from 'undici';
import type { HackerOneConfig } from './types.ts';
import {
  authenticationError,
  notFoundError,
  rateLimitError,
  apiError,
} from './errors.ts';

export class HackerOneClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly dispatcher?: Dispatcher;

  constructor(config: HackerOneConfig, dispatcher?: Dispatcher) {
    this.baseUrl = config.baseUrl ?? 'https://api.hackerone.com/v1';
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.apiIdentifier}:${config.apiToken}`).toString(
        'base64'
      );
    this.dispatcher = dispatcher;
  }

  async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | string[]>
  ): Promise<T> {
    const url = this.buildUrl(path, params);

    const { statusCode, body, headers } = await request(url, {
      method: method as Dispatcher.HttpMethod,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
      dispatcher: this.dispatcher,
    });

    if (statusCode === 401) throw authenticationError();
    if (statusCode === 404) throw notFoundError(path);
    if (statusCode === 429) {
      const retryAfter = headers['retry-after'];
      throw rateLimitError(
        retryAfter ? parseInt(String(retryAfter), 10) : undefined
      );
    }
    if (statusCode >= 400) {
      throw apiError(`Request failed: ${statusCode}`, statusCode);
    }

    return (await body.json()) as T;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | string[]>
  ): URL {
    // Ensure baseUrl ends without slash and path starts with slash
    const base = this.baseUrl.endsWith('/')
      ? this.baseUrl.slice(0, -1)
      : this.baseUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(base + normalizedPath);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            url.searchParams.append(key, v);
          }
        } else {
          url.searchParams.set(key, value);
        }
      }
    }
    return url;
  }
}
