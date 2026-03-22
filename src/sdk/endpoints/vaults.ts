/**
 * Vaults API Client
 *
 * Handles operations related to vaults
 */

import { ApiClient } from '../client';
import { Vault, VaultApiResponse, VaultsListParams } from '../types';

/**
 * Normalize vault from API response (PascalCase) to internal format (snake_case)
 */
function normalizeVault(apiVault: VaultApiResponse): Vault {
  return {
    id: apiVault.ID,
    factory_id: apiVault.FactoryID,
    created_at: apiVault.CreatedAt,
    type: apiVault.Type,
    address: apiVault.RawAddress,
    jetton_minter_address: apiVault.JettonMinterAddress,
    jetton_wallet_code: apiVault.JettonWalletCode,
  };
}

export class VaultsClient {
  constructor(private client: ApiClient) {}

  /**
   * Get a list of vaults with pagination and sorting
   *
   * @param params - Query parameters for filtering and pagination
   * @returns List of vaults
   *
   * @example
   * ```ts
   * const vaults = await vaultsClient.list({
   *   limit: 10,
   *   sort: '-created_at', // Most recent first
   *   order: 'desc'
   * });
   * ```
   */
  async list(params?: VaultsListParams): Promise<Vault[]> {
    const response = await this.client.get<{ vaults: VaultApiResponse[] }>('/vaults', params);
    return (response.vaults || []).map(normalizeVault);
  }

  /**
   * Get a specific vault by ID
   *
   * @param id - Vault identifier
   * @returns Vault details
   *
   * @example
   * ```ts
   * const vault = await vaultsClient.get('vault-123');
   * console.log(vault.type, vault.balance);
   * ```
   */
  async get(id: string): Promise<Vault> {
    const response = await this.client.get<VaultApiResponse>(`/vaults/${id}`);
    return normalizeVault(response);
  }

  /**
   * Get vaults by type
   *
   * @param type - Vault type to filter by
   * @param params - Additional filtering parameters
   * @returns Vaults of the specified type
   *
   * @example
   * ```ts
   * // Note: Replace 'liquidity' with actual vault type from API
   * const liquidityVaults = await vaultsClient.getByType('liquidity');
   * ```
   */
  async getByType(
    type: string,
    params?: Omit<VaultsListParams, 'sort'>
  ): Promise<Vault[]> {
    // Note: The API doesn't have a type filter parameter in the docs
    // This is a client-side filter as a helper method
    const vaults = await this.list(params);
    return vaults.filter((vault) => vault.type === type);
  }

  /**
   * Get vaults by factory ID
   *
   * @param factoryId - Factory ID to filter by
   * @param params - Additional filtering parameters
   * @returns Vaults from the specified factory
   *
   * @example
   * ```ts
   * const factoryVaults = await vaultsClient.getByFactoryId('factory-123');
   * ```
   */
  async getByFactoryId(
    factoryId: number,
    params?: VaultsListParams
  ): Promise<Vault[]> {
    // Note: The API doesn't have a factory_id filter parameter in the docs
    // This is a client-side filter as a helper method
    const vaults = await this.list(params);
    return vaults.filter((vault) => vault.factory_id === factoryId);
  }

  /**
   * Get vaults with limit
   *
   * @param limit - Maximum number of results
   * @returns Vaults
   *
   * @example
   * ```ts
   * const vaults = await vaultsClient.getAll(10);
   * ```
   */
  async getAll(limit: number = 50): Promise<Vault[]> {
    return this.list({
      limit,
    });
  }
}
