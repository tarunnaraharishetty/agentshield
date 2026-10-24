import type { Hex } from './types'

export const MAX_UINT256 = (1n << 256n) - 1n
export const UNLIMITED_THRESHOLD = 1n << 255n

export const SELECTORS = {
  balanceOf: '0x70a08231',
  transfer: '0xa9059cbb',
  approve: '0x095ea7b3',
} as const

export const KNOWN_FUNCTIONS: Record<string, string> = {
  [SELECTORS.balanceOf]: 'balanceOf(address)',
  [SELECTORS.transfer]: 'transfer(address,uint256)',
  [SELECTORS.approve]: 'approve(address,uint256)',
}

export const selectorOf = (data: string): string | null =>
  /^0x[0-9a-fA-F]{8}/.test(data) ? data.slice(0, 10).toLowerCase() : null

export const isAddressWord = (w: string) => /^0{24}[0-9a-f]{40}$/.test(w)

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

export const encodeAddress = (addr: Hex) => word(addr)
export const encodeUint = (n: bigint) => word(n.toString(16))

export const encodeCall = (selector: string, ...words: string[]): Hex =>
  `0x${selector.slice(2)}${words.join('')}`

export function splitCalldata(data: Hex): { selector: string; words: string[] } | null {
  const body = data.slice(2)
  if (body.length < 8) return null
  const rest = body.slice(8)
  if (rest.length % 64 !== 0) return null
  const words: string[] = []
  for (let i = 0; i < rest.length; i += 64) words.push(rest.slice(i, i + 64))
  return { selector: `0x${body.slice(0, 8).toLowerCase()}`, words }
}

export const wordToAddress = (w: string): Hex => `0x${w.slice(24)}`
export const wordToUint = (w: string) => BigInt(`0x${w}`)

export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  const wholeStr = whole.toLocaleString('en-US')
  return frac ? `${wholeStr}.${frac}` : wholeStr
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
