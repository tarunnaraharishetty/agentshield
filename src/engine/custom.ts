import { SELECTORS } from './abi'
import { DEMO_WALLET, SIMULATED_CHAIN_ID } from './context'
import type { Hex, ProposedTransaction } from './types'

const READ_ONLY_SELECTORS: string[] = [SELECTORS.balanceOf]

export type ParseResult = { ok: true; tx: ProposedTransaction } | { ok: false; errors: { to?: string; data?: string } }

// Builds a simulated transaction from pasted fields. Nothing is sent; the result is only analyzed.
export function parseCustomInput(toInput: string, dataInput: string): ParseResult {
  const to = toInput.trim()
  const data = dataInput.replace(/\s+/g, '')
  const errors: { to?: string; data?: string } = {}

  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) errors.to = 'Enter a 20-byte hex address: 0x followed by 40 hex characters.'
  if (!/^0x[0-9a-fA-F]*$/.test(data)) errors.data = 'Data must be hex starting with 0x.'
  else if (data.length < 10) errors.data = 'Data must include at least a 4-byte function selector (0x + 8 hex characters).'
  else if (data.length % 2 !== 0) errors.data = 'Data has an odd number of hex characters.'

  if (errors.to || errors.data) return { ok: false, errors }

  const lower = data.toLowerCase() as Hex
  return {
    ok: true,
    tx: {
      method: READ_ONLY_SELECTORS.includes(lower.slice(0, 10)) ? 'eth_call' : 'eth_sendTransaction',
      chainId: SIMULATED_CHAIN_ID,
      from: DEMO_WALLET,
      to: to as Hex,
      value: 0n,
      data: lower,
    },
  }
}
