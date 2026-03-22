/**
 * Open4Dev API SDK Types
 *
 * Type definitions for the Open4Dev API
 * Base URL: https://api.open4dev.xyz/api/v1
 */

// Common pagination and sorting parameters
export interface PaginationParams {
  offset?: number;
  limit?: number;
}

export interface SortParams {
  sort?: string;
  order?: 'asc' | 'desc';
}

// API Response wrapper
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    offset?: number;
    limit?: number;
  };
}

// Coins
export interface Coin {
  id: number;
  name: string;
  symbol: string;
  cnt_orders?: number;
  address?: string; // Normalized field (mapped from ton_raw_address)
  ton_raw_address?: string; // Raw field from API
  decimals?: number;
  image?: string;
  hex_jetton_wallet_code?: string | null;
  jetton_content?: string | null;
  [key: string]: any;
}

export interface CoinsListParams extends PaginationParams, SortParams {
  // Available sort fields: id, name, symbol, cnt_orders
}

// Orders
export type OrderStatus =
  | 'created'
  | 'deployed'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'pending_match';

export interface Order {
  id: string;
  created_at?: string;
  deployed_at?: string;
  status: OrderStatus;
  type?: string;
  amount?: number;
  initial_amount?: number;
  price_rate?: number;
  from_coin_id?: number;
  to_coin_id?: number;
  slippage?: number;
  user_address?: string;
  raw_address?: string; // User's wallet address from API (snake_case)
  order_address?: string; // Order contract address (snake_case)
  // PascalCase fields (as returned by API)
  RawAddress?: string; // Order contract address (PascalCase)
  OwnerRawAddress?: string; // User's wallet address (PascalCase)
  user_id?: number;
  wallet_id?: number;
  vault_id?: number;
  title?: string;
  [key: string]: any;
}

export interface OrdersListParams extends PaginationParams, SortParams {
  // Available sort fields: id, created_at, deployed_at, status, type, amount, price_rate
  from_coin_id?: number;
  to_coin_id?: number;
  owner_raw_address?: string;
  status?: OrderStatus;
  min_amount?: number;
  max_amount?: number;
  min_price_rate?: number;
  max_price_rate?: number;
  min_slippage?: number;
  max_slippage?: number;
}

// Vaults
// API returns PascalCase fields
export interface VaultApiResponse {
  ID: number;
  FactoryID?: number;
  RawAddress: string;
  CreatedAt?: string;
  JettonMinterAddress?: string | null;
  Type: string;
  JettonWalletCode?: string | null;
  Factory?: any;
}

// Normalized vault interface for internal use
export interface Vault {
  id: number;
  factory_id?: number;
  created_at?: string;
  type: string;
  address: string;
  jetton_minter_address?: string | null;
  jetton_wallet_code?: string | null;
  [key: string]: any;
}

export interface VaultsListParams extends PaginationParams {
  // Note: Sorting is not supported by the vaults API
}

// Error types
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string = 'Invalid request parameters') {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}
