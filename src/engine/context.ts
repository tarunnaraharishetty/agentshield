import type { Hex, TokenInfo } from './types'

// Static, simulated context. No RPC, wallet, or network access is used anywhere.
export const SIMULATED_CHAIN_ID = 1

export const DEMO_WALLET: Hex = '0x5a99e905ed42f14f44cfe55bf9eeaee7d480e1b3'

export const TOKENS: Record<string, TokenInfo> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
}

export const ADDRESS_BOOK: Record<string, string> = {
  '0xa0f5034c04fd9ed0ec40b1a64ddb86076d885ab8': 'Alice (saved contact)',
}

export const TRUSTED_SPENDERS: Record<string, string> = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Uniswap Permit2',
}

export const POLICY = {
  maxTransferPerTx: { USDC: 100n * 10n ** 6n } as Record<string, bigint>,
  maxNativeValueWei: 0n,
  allowedChainIds: [SIMULATED_CHAIN_ID],
}

export const lookup = (table: Record<string, string>, addr: string) =>
  table[addr.toLowerCase()]
