import TonConnect, { IStorage, WalletConnectionSource } from '@tonconnect/sdk';
import QRCode from 'qrcode';
import { config } from '../utils/config';
import { getRedisClient } from './redisService';

// Global shared Map for ALL storage operations (static across all instances)
const GLOBAL_STORAGE_MAP = new Map<string, string>();

// In-memory Node.js storage implementation for TonConnect with shared storage
// Each user should have their own namespace to isolate their connection data
class NodeStorage implements IStorage {
  private namespace: string;

  constructor(namespace: string = 'global') {
    this.namespace = namespace;
  }

  private getKey(key: string): string {
    // Use namespace prefix to isolate storage per user
    return this.namespace ? `${this.namespace}:${key}` : key;
  }

  async removeItem(key: string): Promise<void> {
    GLOBAL_STORAGE_MAP.delete(this.getKey(key));
  }

  async setItem(key: string, value: string): Promise<void> {
    GLOBAL_STORAGE_MAP.set(this.getKey(key), value);
  }

  async getItem(key: string): Promise<string | null> {
    return GLOBAL_STORAGE_MAP.get(this.getKey(key)) ?? null;
  }
}

// Redis-backed storage (optional, controlled by env TONCONNECT_STORAGE=redis or TONCONNECT_USE_REDIS=true)
class RedisStorage implements IStorage {
  private namespace: string;

  constructor(namespace: string = 'tonconnect') {
    this.namespace = namespace;
  }

  private key(k: string): string {
    return this.namespace ? `${this.namespace}:${k}` : k;
  }

  async removeItem(key: string): Promise<void> {
    try {
      // Use getRedisClient() directly - it handles initialization and ioredis handles reconnection
      const client = getRedisClient();
      await client.del(this.key(key));
    } catch (error) {
      console.error('[RedisStorage] removeItem error:', error);
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const client = getRedisClient();
      await client.set(this.key(key), value);
    } catch (error) {
      console.error('[RedisStorage] setItem error:', error);
    }
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const client = getRedisClient();
      return await client.get(this.key(key)) ?? null;
    } catch (error) {
      console.error('[RedisStorage] getItem error:', error);
      return null;
    }
  }
}

// Choose storage implementation
// Each user should have their own namespaced storage to isolate connection sessions
function createStorage(telegramId: number): IStorage {
  const namespace = `user_${telegramId}`;
  const useRedis =
    process.env.TONCONNECT_STORAGE === 'redis' ||
    String(process.env.TONCONNECT_USE_REDIS).toLowerCase() === 'true';
  return useRedis ? new RedisStorage(namespace) : new NodeStorage(namespace);
}

interface WalletConnectionData {
  universalLink: string;
  qrCodeDataUrl: string;
  tcLink: string;
}

// Storage for TonConnect instances per user
const tonConnectInstances = new Map<number, TonConnect>();

// Storage for listener unsubscribe functions
const listenerUnsubscribers = new Map<number, () => void>();

// Storage for connection polling intervals
const connectionPollers = new Map<number, NodeJS.Timeout>();

// Storage for connection callbacks (for manual triggering)
const connectionCallbacks = new Map<number, {
  onConnected: (address: string) => void;
  onDisconnected: () => void;
}>();

// Track last restore attempt to avoid redundant slow restores
const lastRestoreAttempt = new Map<number, number>();
const RESTORE_COOLDOWN_MS = 30000; // 30 seconds

// Heartbeat intervals for keeping connections alive
const connectionHeartbeats = new Map<number, NodeJS.Timeout>();
const HEARTBEAT_INTERVAL_MS = 20000; // 20 seconds - keep connection fresh
const HEARTBEAT_RESTORE_TIMEOUT_MS = 8000; // 8 seconds for background restore

// Track ongoing warmup promises to avoid duplicate restores
const warmupPromises = new Map<number, Promise<void>>();

// Track users with active SSE connections (confirmed working)
const activeConnections = new Set<number>();

/**
 * Get or create TonConnect instance for a user
 */
export function getTonConnectInstance(telegramId: number): TonConnect {
  let connector = tonConnectInstances.get(telegramId);

  if (!connector) {
    connector = new TonConnect({
      manifestUrl: config.tonConnectManifestUrl,
      storage: createStorage(telegramId),
    });
    tonConnectInstances.set(telegramId, connector);
  }

  return connector;
}

/**
 * Reset stored TonConnect RPC request counter for a user.
 *
 * Some wallets (notably MyTonWallet in some bridge states) can desync request IDs.
 * Forcing the counter to 0 makes the next request deterministic and avoids id mismatch timeouts.
 */
export async function resetTonConnectRpcRequestCounter(telegramId: number): Promise<void> {
  try {
    const storage = createStorage(telegramId);
    const key = 'ton-connect-storage_bridge-connection';
    const stored = await storage.getItem(key);
    if (!stored) return;

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (parsed.type !== 'http') return;

    if (typeof parsed.nextRpcRequestId === 'number' && parsed.nextRpcRequestId !== 0) {
      parsed.nextRpcRequestId = 0;
      await storage.setItem(key, JSON.stringify(parsed));
      console.log(`[TonConnect] Reset RPC request counter for user ${telegramId}`);
    }
  } catch (error) {
    console.warn(`[TonConnect] Failed to reset RPC request counter for user ${telegramId}:`, error);
  }
}

/**
 * Get TonConnect instance and restore connection from storage if needed
 */
export async function getOrRestoreTonConnect(telegramId: number): Promise<TonConnect> {
  const startTime = Date.now();
  const connector = getTonConnectInstance(telegramId);

  // If already connected and confirmed active, return immediately
  if (connector.connected && activeConnections.has(telegramId)) {
    console.log(`[TonConnect] Already connected (${Date.now() - startTime}ms)`);
    if (!connectionHeartbeats.has(telegramId)) {
      startConnectionHeartbeat(telegramId);
    }
    return connector;
  }

  // If warmup is in progress, wait for it
  const existingWarmup = warmupPromises.get(telegramId);
  if (existingWarmup) {
    console.log(`[TonConnect] Waiting for existing warmup...`);
    await existingWarmup;
    console.log(`[TonConnect] Warmup completed (${Date.now() - startTime}ms)`);
    return connector;
  }

  // Check cooldown to avoid redundant slow restores
  const lastAttempt = lastRestoreAttempt.get(telegramId) || 0;
  const now = Date.now();
  if (now - lastAttempt < RESTORE_COOLDOWN_MS) {
    console.log(`[TonConnect] Cooldown active, skipping restore (${Date.now() - startTime}ms)`);
    return connector;
  }

  // Try to restore connection
  lastRestoreAttempt.set(telegramId, now);
  try {
    console.log(`[TonConnect] Restoring connection...`);
    await connector.restoreConnection({ openingDeadlineMS: 5000 });
    console.log(`[TonConnect] Restore completed (${Date.now() - startTime}ms)`);

    if (connector.connected) {
      activeConnections.add(telegramId);
      startConnectionHeartbeat(telegramId);
    }
  } catch (error) {
    console.log(`[TonConnect] Restore failed (${Date.now() - startTime}ms):`, error);
  }

  return connector;
}

/**
 * Pre-warm TonConnect connection in background (non-blocking)
 * Call this early in user flow (e.g., when they start creating an order)
 * By the time they need to sign, connection should be ready
 */
export function warmupConnection(telegramId: number): void {
  const connector = tonConnectInstances.get(telegramId);

  // Already connected and active - nothing to do
  if (connector?.connected && activeConnections.has(telegramId)) {
    return;
  }

  // Warmup already in progress
  if (warmupPromises.has(telegramId)) {
    return;
  }

  // Check cooldown
  const lastAttempt = lastRestoreAttempt.get(telegramId) || 0;
  if (Date.now() - lastAttempt < RESTORE_COOLDOWN_MS) {
    return;
  }

  console.log(`[TonConnect] Starting background warmup for user ${telegramId}`);

  const warmupPromise = (async () => {
    const startTime = Date.now();
    const conn = getTonConnectInstance(telegramId);
    lastRestoreAttempt.set(telegramId, Date.now());

    try {
      // Use longer timeout for background warmup since it's non-blocking
      await conn.restoreConnection({ openingDeadlineMS: 15000 });

      if (conn.connected) {
        activeConnections.add(telegramId);
        startConnectionHeartbeat(telegramId);
        console.log(`[TonConnect] Background warmup completed for user ${telegramId} (${Date.now() - startTime}ms)`);
      }
    } catch (error) {
      console.log(`[TonConnect] Background warmup failed for user ${telegramId}:`, error);
    } finally {
      warmupPromises.delete(telegramId);
    }
  })();

  warmupPromises.set(telegramId, warmupPromise);
}

/**
 * Wait for connection to be ready (with timeout)
 * Use this before sending transaction
 */
export async function waitForConnection(telegramId: number, timeoutMs: number = 20000): Promise<boolean> {
  const startTime = Date.now();
  const connector = getTonConnectInstance(telegramId);

  // Already connected
  if (connector.connected && activeConnections.has(telegramId)) {
    return true;
  }

  // Wait for warmup if in progress
  const warmup = warmupPromises.get(telegramId);
  if (warmup) {
    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime > 0) {
      await Promise.race([
        warmup,
        new Promise(resolve => setTimeout(resolve, remainingTime))
      ]);
    }
  }

  // Check again
  if (connector.connected) {
    activeConnections.add(telegramId);
    return true;
  }

  // Last resort: try quick restore
  if (Date.now() - startTime < timeoutMs) {
    try {
      const remainingTime = Math.min(timeoutMs - (Date.now() - startTime), 10000);
      await connector.restoreConnection({ openingDeadlineMS: remainingTime });
      if (connector.connected) {
        activeConnections.add(telegramId);
        startConnectionHeartbeat(telegramId);
        return true;
      }
    } catch {
      // Ignore
    }
  }

  return connector.connected;
}

/**
 * Check if connection is ready (instant, no waiting)
 */
export function isConnectionReady(telegramId: number): boolean {
  const connector = tonConnectInstances.get(telegramId);
  return connector?.connected === true && activeConnections.has(telegramId);
}

/**
 * Generate wallet connection link and QR code
 */
export async function generateWalletConnection(
  telegramId: number,
  walletType: string,
  onConnected: (address: string) => void,
  onDisconnected: () => void
): Promise<WalletConnectionData> {
  const connector = getTonConnectInstance(telegramId);

  // Clean up any existing connection, listener, and heartbeat
  try {
    stopConnectionPolling(telegramId);
    stopConnectionHeartbeat(telegramId);
    const oldUnsubscribe = listenerUnsubscribers.get(telegramId);
    if (oldUnsubscribe) {
      oldUnsubscribe();
      listenerUnsubscribers.delete(telegramId);
    }
    if (connector.connected) {
      await connector.disconnect();
    }
  } catch {
    // Cleanup errors are non-critical
  }

  // Setup listener BEFORE calling connect()
  setupWalletListener(telegramId, onConnected, onDisconnected);

  // Get wallet configuration and initiate connection
  const walletConfig = getWalletConfig(walletType);
  let tcLink: string;
  try {
    const linkOrPromise = connector.connect(walletConfig) as unknown;
    tcLink = typeof linkOrPromise === 'string' ? linkOrPromise : await (linkOrPromise as Promise<string>);
  } catch (error) {
    console.error(`[TonConnect] connect() failed for ${walletType}:`, error);
    throw error;
  }

  // Start polling connection status (fallback for Node.js environments)
  startConnectionPolling(telegramId, onConnected, onDisconnected);

  // Convert tc:// link to HTTPS universal link for Telegram compatibility
  const universalLink = convertToUniversalLink(tcLink, walletType);

  // Generate QR code
  const qrCodeDataUrl = await QRCode.toDataURL(tcLink, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  return { universalLink, qrCodeDataUrl, tcLink };
}

/**
 * Convert tc:// protocol link to HTTPS universal link for Telegram inline buttons
 */
function convertToUniversalLink(tcLink: string, walletType: string): string {
  // Extract parameters from tc:// link
  const url = new URL(tcLink);
  const params = url.searchParams;

  // Build query string from tc:// parameters
  const queryParams = new URLSearchParams();
  params.forEach((value, key) => {
    queryParams.append(key, value);
  });

  // Convert to wallet-specific universal link
  switch (walletType) {
    case 'Tonkeeper':
      // Tonkeeper uses the same query parameters
      return `https://app.tonkeeper.com/ton-connect?${queryParams.toString()}`;

    case 'MyTonWallet':
      // MyTonWallet deepLink format
      return tcLink.replace('tc://', 'mytonwallet-tc://');

    case 'Telegram Wallet':
      // SDK already generates correct Telegram URL - use it directly
      return tcLink;

    default:
      // Fallback to Tonkeeper format
      return `https://app.tonkeeper.com/ton-connect?${queryParams.toString()}`;
  }
}

/**
 * Get wallet configuration for TonConnect
 */
function getWalletConfig(walletType: string): WalletConnectionSource {
  const walletConfigs: Record<string, WalletConnectionSource> = {
    'Tonkeeper': {
      bridgeUrl: 'https://bridge.tonapi.io/bridge',
      universalLink: 'https://app.tonkeeper.com/ton-connect',
    },
    'MyTonWallet': {
      bridgeUrl: 'https://tonconnectbridge.mytonwallet.org/bridge/',
      universalLink: 'https://connect.mytonwallet.org',
    },
    'Telegram Wallet': {
      bridgeUrl: 'https://walletbot.me/tonconnect-bridge/bridge',
      universalLink: 'https://t.me/wallet?attach=wallet',
    },
  };

  return walletConfigs[walletType] || walletConfigs['Tonkeeper'];
}

/**
 * Check if wallet is connected (sync - only checks in-memory state)
 */
export function isWalletConnected(telegramId: number): boolean {
  const connector = tonConnectInstances.get(telegramId);
  return connector ? connector.connected : false;
}

/**
 * Check if wallet is connected (async - tries to restore connection first)
 */
export async function isWalletConnectedAsync(telegramId: number): Promise<boolean> {
  const connector = await getOrRestoreTonConnect(telegramId);
  return connector.connected;
}

/**
 * Get connected wallet address
 */
export function getWalletAddress(telegramId: number): string | null {
  const connector = tonConnectInstances.get(telegramId);
  if (!connector || !connector.connected) {
    return null;
  }
  return connector.account?.address || null;
}

/**
 * Disconnect wallet
 */
export async function disconnectWallet(telegramId: number): Promise<void> {
  try {
    // Stop polling and heartbeat first
    stopConnectionPolling(telegramId);
    stopConnectionHeartbeat(telegramId);

    // Remove listener
    const unsubscribe = listenerUnsubscribers.get(telegramId);
    if (unsubscribe) {
      try { unsubscribe(); } catch { /* ignore */ }
      listenerUnsubscribers.delete(telegramId);
    }

    // Clear callbacks
    connectionCallbacks.delete(telegramId);

    // Disconnect and remove connector
    const connector = tonConnectInstances.get(telegramId);
    if (connector) {
      // Only call disconnect() if the wallet is actually connected
      // Otherwise TonConnect SDK throws WalletNotConnectedError
      if (connector.connected) {
        try {
          await connector.disconnect();
        } catch (error) {
          console.error(`[TonConnect] Error during disconnect for user ${telegramId}:`, error);
        }
      }
      tonConnectInstances.delete(telegramId);
    }

    // Clean up other maps
    lastRestoreAttempt.delete(telegramId);
  } catch (error) {
    console.error(`[TonConnect] Unexpected error in disconnectWallet for user ${telegramId}:`, error);
  }
}

/**
 * Start polling connection status (fallback for Node.js environments)
 */
function startConnectionPolling(
  telegramId: number,
  onConnected: (address: string) => void,
  onDisconnected: () => void
): void {
  stopConnectionPolling(telegramId);

  const connector = tonConnectInstances.get(telegramId);
  if (!connector) return;

  let lastStatus: boolean = connector.connected || !!connector.wallet;
  let pollCount = 0;
  const maxPolls = 120; // Poll for 2 minutes

  const pollInterval = setInterval(async () => {
    pollCount++;
    const currentConnector = tonConnectInstances.get(telegramId);

    if (!currentConnector) {
      stopConnectionPolling(telegramId);
      return;
    }

    try {
      const isConnected = currentConnector.connected || !!currentConnector.wallet;
      const currentAddress = currentConnector.account?.address || currentConnector.wallet?.account?.address;

      // Status changed from disconnected to connected
      if (isConnected && currentAddress && !lastStatus) {
        console.log(`[TonConnect] Connection detected for user ${telegramId}: ${currentAddress.slice(0, 10)}...`);
        stopConnectionPolling(telegramId);
        onConnected(currentAddress);
        return;
      }

      // Status changed from connected to disconnected
      if (!isConnected && lastStatus) {
        stopConnectionPolling(telegramId);
        onDisconnected();
        return;
      }

      lastStatus = isConnected;

      if (pollCount >= maxPolls) {
        stopConnectionPolling(telegramId);
      }
    } catch {
      // Polling errors are non-critical
    }
  }, 1000);

  connectionPollers.set(telegramId, pollInterval);
}

/**
 * Stop connection polling for a user
 */
function stopConnectionPolling(telegramId: number): void {
  const poller = connectionPollers.get(telegramId);
  if (poller) {
    clearInterval(poller);
    connectionPollers.delete(telegramId);
  }
}

/**
 * Start heartbeat to keep TonConnect bridge connection alive
 * This prevents the SSE connection from timing out and avoids slow restores
 */
export function startConnectionHeartbeat(telegramId: number): void {
  // Stop existing heartbeat if any
  stopConnectionHeartbeat(telegramId);

  console.log(`[TonConnect] Starting heartbeat for user ${telegramId}`);

  const heartbeat = setInterval(async () => {
    try {
      // Check if heartbeat was stopped (interval may fire once more after clearInterval)
      if (!connectionHeartbeats.has(telegramId)) {
        return;
      }

      const connector = tonConnectInstances.get(telegramId);
      if (!connector) {
        console.log(`[TonConnect] Heartbeat: no connector for user ${telegramId}, stopping`);
        stopConnectionHeartbeat(telegramId);
        return;
      }

      // If not connected, try to restore in background
      if (!connector.connected) {
        console.log(`[TonConnect] Heartbeat: connection lost for user ${telegramId}, restoring...`);
        try {
          await connector.restoreConnection({ openingDeadlineMS: HEARTBEAT_RESTORE_TIMEOUT_MS });
          console.log(`[TonConnect] Heartbeat: connection restored for user ${telegramId}`);
        } catch (error) {
          console.log(`[TonConnect] Heartbeat: restore failed for user ${telegramId}:`, error);
        }
      }
    } catch (error) {
      console.error(`[TonConnect] Heartbeat error for user ${telegramId}:`, error);
    }
  }, HEARTBEAT_INTERVAL_MS);

  connectionHeartbeats.set(telegramId, heartbeat);
}

/**
 * Stop heartbeat for a user
 */
export function stopConnectionHeartbeat(telegramId: number): void {
  const heartbeat = connectionHeartbeats.get(telegramId);
  if (heartbeat) {
    clearInterval(heartbeat);
    connectionHeartbeats.delete(telegramId);
    console.log(`[TonConnect] Stopped heartbeat for user ${telegramId}`);
  }
  activeConnections.delete(telegramId);
}

/**
 * Setup wallet connection listener with error handling
 */
export function setupWalletListener(
  telegramId: number,
  onConnected: (address: string) => void,
  onDisconnected: () => void
): void {
  const connector = getTonConnectInstance(telegramId);

  // Store callbacks for manual triggering
  connectionCallbacks.set(telegramId, { onConnected, onDisconnected });

  // Remove old listener if exists
  const oldUnsubscribe = listenerUnsubscribers.get(telegramId);
  if (oldUnsubscribe) {
    oldUnsubscribe();
    listenerUnsubscribers.delete(telegramId);
  }

  // Setup new listener with error handling
  const unsubscribe = connector.onStatusChange(
    (wallet) => {
      try {
        if (wallet) {
          stopConnectionPolling(telegramId);
          // Mark as active and start heartbeat to keep connection alive
          activeConnections.add(telegramId);
          startConnectionHeartbeat(telegramId);
          onConnected(wallet.account.address);
        } else {
          stopConnectionPolling(telegramId);
          stopConnectionHeartbeat(telegramId);
          activeConnections.delete(telegramId);
          onDisconnected();
        }
      } catch (error) {
        console.error(`[TonConnect] Callback error for user ${telegramId}:`, error);
      }
    },
    (error) => {
      console.error(`[TonConnect] Connection error for user ${telegramId}:`, error);
      try {
        stopConnectionPolling(telegramId);
        stopConnectionHeartbeat(telegramId);
        onDisconnected();
      } catch {
        // Error handling errors are non-critical
      }
    }
  );

  listenerUnsubscribers.set(telegramId, unsubscribe);
}

/**
 * Generate QR code buffer for Telegram
 */
export async function generateQRCodeBuffer(universalLink: string): Promise<Buffer> {
  const buffer = await QRCode.toBuffer(universalLink, {
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  return buffer;
}

// Track last activity time for each user (for cleanup purposes)
const userLastActivity = new Map<number, number>();

/**
 * Update user's last activity timestamp
 * Call this when user interacts with wallet features
 */
export function updateUserActivity(telegramId: number): void {
  userLastActivity.set(telegramId, Date.now());
}

/**
 * Clean up resources for a specific user
 * Removes all Maps entries and stops polling/heartbeat
 */
export function cleanupUserResources(telegramId: number): void {
  stopConnectionPolling(telegramId);
  stopConnectionHeartbeat(telegramId);

  const unsubscribe = listenerUnsubscribers.get(telegramId);
  if (unsubscribe) {
    try { unsubscribe(); } catch { /* ignore */ }
    listenerUnsubscribers.delete(telegramId);
  }

  connectionCallbacks.delete(telegramId);
  tonConnectInstances.delete(telegramId);
  userLastActivity.delete(telegramId);
  lastRestoreAttempt.delete(telegramId);
  warmupPromises.delete(telegramId);
  activeConnections.delete(telegramId);

  // Clean up storage keys for this user
  const namespace = `user_${telegramId}`;
  for (const key of GLOBAL_STORAGE_MAP.keys()) {
    if (key.startsWith(namespace + ':')) {
      GLOBAL_STORAGE_MAP.delete(key);
    }
  }
}

/**
 * Clean up resources for inactive users
 * Users with no activity for the specified timeout will have their resources freed
 *
 * @param inactivityTimeoutMs - Milliseconds of inactivity before cleanup (default: 30 minutes)
 */
export function cleanupInactiveUsers(inactivityTimeoutMs: number = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [telegramId, lastActivity] of userLastActivity.entries()) {
    if (now - lastActivity > inactivityTimeoutMs) {
      cleanupUserResources(telegramId);
    }
  }
}

// Start periodic cleanup every 10 minutes
setInterval(() => {
  try { cleanupInactiveUsers(); } catch { /* ignore */ }
}, 10 * 60 * 1000);
