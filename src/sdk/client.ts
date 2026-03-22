/**
 * Open4Dev API Base Client
 *
 * Handles HTTP requests, authentication, and error handling
 */

import { ApiError, AuthenticationError, ValidationError, NotFoundError } from './types';

export interface ClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl || 'https://api.open4dev.xyz/api/v1';
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000; // 30 seconds default
  }

  /**
   * Build query string from parameters
   */
  private buildQueryString(params?: Record<string, any>): string {
    if (!params) return '';

    const filtered = Object.entries(params)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

    return filtered.length > 0 ? `?${filtered.join('&')}` : '';
  }

  /**
   * Handle API errors and create appropriate error instances
   */
  private handleError(status: number, data: any): never {
    const message = data?.message || data?.error || 'An error occurred';

    switch (status) {
      case 400:
        throw new ValidationError(message);
      case 401:
      case 403:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      default:
        throw new ApiError(message, status, data);
    }
  }

  /**
   * Make HTTP request to the API
   */
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers = {}, body, params } = options;

    const url = `${this.baseUrl}${endpoint}${this.buildQueryString(params)}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Only add Authorization header if API key is provided
    if (this.apiKey) {
      requestHeaders['Authorization'] = this.apiKey;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);

      // Parse response
      let data: any;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle errors
      if (!response.ok) {
        this.handleError(response.status, data);
      }

      return data as T;
    } catch (error) {
      // Re-throw API errors
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle network errors
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          throw new ApiError('Request timeout', 408);
        }
        throw new ApiError(`Network error: ${error.message}`, 0);
      }

      throw new ApiError('Unknown error occurred', 0);
    }
  }

  /**
   * GET request helper
   */
  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  /**
   * POST request helper
   */
  async post<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body, params });
  }

  /**
   * PUT request helper
   */
  async put<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body, params });
  }

  /**
   * DELETE request helper
   */
  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', params });
  }
}
