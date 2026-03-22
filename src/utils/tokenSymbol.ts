/**
 * Token symbol helpers
 *
 * Some UI symbols differ from API/coin-table symbols.
 * Normalize symbols for lookups and format them for display.
 */

const TOKEN_SYMBOL_ALIASES: Record<string, string> = {
  XAUT: 'XAUT0',
};

const TOKEN_DISPLAY_SYMBOLS: Record<string, string> = {
  XAUT0: 'XAUt',
};

/**
 * Normalize a token symbol for internal lookups.
 */
export function normalizeTokenSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return TOKEN_SYMBOL_ALIASES[upper] ?? upper;
}

/**
 * Format a token symbol for UI display.
 */
export function formatTokenSymbol(symbol: string): string {
  const normalized = normalizeTokenSymbol(symbol);
  return TOKEN_DISPLAY_SYMBOLS[normalized] ?? normalized;
}
