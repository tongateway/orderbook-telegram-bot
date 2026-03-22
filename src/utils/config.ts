import dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

export const config: Config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  tonNetwork: process.env.TON_NETWORK || 'testnet',
  tonApiKey: process.env.TON_API_KEY || '',
  orderBookApiUrl: process.env.ORDER_BOOK_API_URL || 'https://api.open4dev.com',
  orderBookContractAddress: process.env.ORDER_BOOK_CONTRACT_ADDRESS || '',
  tonConnectManifestUrl: process.env.TONCONNECT_MANIFEST_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  jwtSecret: process.env.JWT_SECRET || '',
  maxOrderAmount: Number(process.env.MAX_ORDER_AMOUNT) || 10000,
  minOrderAmount: Number(process.env.MIN_ORDER_AMOUNT) || 0.1,
  apiRateLimit: Number(process.env.API_RATE_LIMIT) || 60,
  open4devApiKey: process.env.OPEN4DEV_API_KEY || '',
  open4devApiUrl: process.env.OPEN4DEV_API_URL || 'https://api.open4dev.xyz/api/v1',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: Number(process.env.REDIS_PORT) || 6379,
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisTls: process.env.REDIS_TLS === 'true',
  redisTtl: Number(process.env.REDIS_TTL) || 300, // 5 minutes default
  webhookDomain: process.env.WEBHOOK_DOMAIN || undefined,
  webhookPort: Number(process.env.WEBHOOK_PORT) || 3000,
  webhookSecret: process.env.WEBHOOK_SECRET || undefined,
};

export function validateConfig(): void {
  const requiredFields: (keyof Config)[] = ['telegramBotToken', 'tonConnectManifestUrl'];

  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Missing required configuration: ${field}`);
    }
  }

  // Ensure manifest URL uses HTTPS (required by TonConnect wallets)
  if (!config.tonConnectManifestUrl.startsWith('https://')) {
    throw new Error(
      `Invalid TONCONNECT_MANIFEST_URL: must start with https:// (got "${config.tonConnectManifestUrl}")`
    );
  }

  // Warn about missing secrets (required in production)
  if (!config.sessionSecret) {
    console.warn('WARNING: SESSION_SECRET not set. Using empty secret (insecure in production).');
  }
  if (!config.jwtSecret) {
    console.warn('WARNING: JWT_SECRET not set. Using empty secret (insecure in production).');
  }

  // In production, require secrets to be set
  if (process.env.NODE_ENV === 'production') {
    if (!config.sessionSecret || !config.jwtSecret) {
      throw new Error('SESSION_SECRET and JWT_SECRET must be set in production');
    }
  }
}
