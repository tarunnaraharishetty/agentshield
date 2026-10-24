import { describe, expect, it } from 'vitest'
import { SIMULATED_CASES } from './cases'
import { analyze } from './pipeline'
import { encodeAddress, encodeCall, encodeUint, MAX_UINT256, SELECTORS } from './abi'
import { parseCustomInput } from './custom'
import { DEMO_WALLET } from './context'
import type { ProposedTransaction } from './types'

const byId = (id: string) => analyze(SIMULATED_CASES.find((c) => c.id === id)!.tx)
const ALICE = SIMULATED_CASES[1].tx.data.slice(34, 74)

describe('built-in simulated cases', () => {
  it('allows the read-only balance check', () => {
    const r = byId('balance-check')
    expect(r.decoded.kind).toBe('read')
    expect(r.decoded.writesState).toBe(false)
    expect(r.decision.verdict).toBe('ALLOW')
  })

  it('warns on the small transfer and decodes 25 USDC to Alice', () => {
    const r = byId('small-transfer')
    expect(r.decoded.kind).toBe('transfer')
    expect(r.decoded.summary).toContain('25 USDC')
    expect(r.decoded.summary).toContain('Alice')
    expect(r.decision.verdict).toBe('WARN')
  })

  it('blocks the unlimited approval to an unrecognized spender', () => {
    const r = byId('unlimited-approval')
    expect(r.decoded.kind).toBe('approve')
    expect(r.decoded.isUnlimited).toBe(true)
    expect(r.risks.map((x) => x.id)).toEqual(expect.arrayContaining(['unlimited-approval', 'unrecognized-spender']))
    expect(r.decision.verdict).toBe('BLOCK')
    expect(r.decision.rules.find((x) => x.id === 'R3')?.triggered).toBe(true)
  })

  it('produces a three-step trace for every case', () => {
    for (const c of SIMULATED_CASES) {
      expect(analyze(c.tx).trace.map((t) => t.id)).toEqual(['decode', 'risk', 'safety'])
    }
  })

  it('is deterministic', () => {
    for (const c of SIMULATED_CASES) expect(analyze(c.tx)).toEqual(analyze(c.tx))
  })
})

describe('policy edges', () => {
  const base = SIMULATED_CASES[1].tx
  const withData = (data: ProposedTransaction['data']): ProposedTransaction => ({ ...base, data })

  it('blocks transfers above the per-tx limit', () => {
    const tx = withData(encodeCall(SELECTORS.transfer, ALICE, encodeUint(500_000_000n)))
    expect(analyze(tx).decision.verdict).toBe('BLOCK')
  })

  it('blocks undecodable calldata', () => {
    expect(analyze(withData('0xdeadbeef')).decision.verdict).toBe('BLOCK')
  })

  it('blocks the wrong chain', () => {
    expect(analyze({ ...SIMULATED_CASES[0].tx, chainId: 56 }).decision.verdict).toBe('BLOCK')
  })

  it('warns (does not block) on a bounded approval to a trusted spender', () => {
    const tx = withData(encodeCall(SELECTORS.approve, encodeAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'), encodeUint(10_000_000n)))
    const r = analyze(tx)
    expect(r.decoded.counterpartyLabel).toBe('Uniswap Permit2')
    expect(r.decision.verdict).toBe('WARN')
  })

  it('decodes the wallet as "your wallet"', () => {
    expect(byId('balance-check').decoded.counterparty?.toLowerCase()).toBe(DEMO_WALLET.toLowerCase())
    expect(byId('balance-check').decoded.summary).toContain('your wallet')
  })
})

describe('pasted transaction input', () => {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const STRANGER = '0x1234567890abcdef1234567890abcdef12345678'
  const parse = (to: string, data: string) => {
    const r = parseCustomInput(to, data)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return analyze(r.tx)
  }

  it('rejects malformed fields', () => {
    const r = parseCustomInput('0x123', 'hello')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.to).toBeDefined()
      expect(r.errors.data).toBeDefined()
    }
    expect(parseCustomInput(USDC, '0x1234').ok).toBe(false)
  })

  it('decodes a pasted unlimited approve, labels spender unrecognized, and blocks', () => {
    const data = encodeCall(SELECTORS.approve, encodeAddress(STRANGER), encodeUint(MAX_UINT256))
    const r = parse(USDC, `  ${data.toUpperCase().replace('0X', '0x')}\n`)
    expect(r.decoded.kind).toBe('approve')
    expect(r.decoded.isUnlimited).toBe(true)
    expect(r.decoded.counterpartyLabel).toBe('unrecognized address')
    expect(r.decoded.summary).toContain('UNLIMITED')
    expect(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).toLowerCase()).not.toContain('scam')
    expect(r.decision.verdict).toBe('BLOCK')
  })

  it('decodes a pasted bounded approve as WARN', () => {
    const data = encodeCall(SELECTORS.approve, encodeAddress(STRANGER), encodeUint(50_000_000n))
    const r = parse(USDC, data)
    expect(r.decoded.isUnlimited).toBe(false)
    expect(r.decoded.summary).toContain('up to 50 USDC')
    expect(r.decision.verdict).toBe('WARN')
  })

  it('decodes a pasted transfer to an unrecognized recipient', () => {
    const data = encodeCall(SELECTORS.transfer, encodeAddress(STRANGER), encodeUint(10_000_000n))
    const r = parse(USDC, data)
    expect(r.decoded.summary).toContain('10 USDC')
    expect(r.decoded.summary).toContain('unrecognized address')
    expect(r.risks.map((x) => x.id)).toContain('unknown-recipient')
    expect(r.decision.verdict).toBe('WARN')
  })

  it('shows raw base units for an unrecognized token contract', () => {
    const data = encodeCall(SELECTORS.transfer, encodeAddress(STRANGER), encodeUint(1000n))
    const r = parse(STRANGER, data)
    expect(r.decoded.summary).toContain('1,000 base units of an unrecognized token')
    expect(r.risks.map((x) => x.id)).toContain('unrecognized-token')
  })

  it('warns (does not block) on a transfer from an unrecognized token contract', () => {
    const data = encodeCall(SELECTORS.transfer, encodeAddress(STRANGER), encodeUint(10n ** 30n))
    const r = parse(STRANGER, data)
    const triggered = r.decision.rules.filter((x) => x.triggered).map((x) => x.id)
    expect(r.decision.verdict).toBe('WARN')
    expect(triggered).toContain('R7')
    expect(triggered).not.toContain('R6')
    expect(r.decoded.summary).toContain("can't be verified here")
    expect(r.decision.rules.find((x) => x.id === 'R7')?.reason).toContain('review before signing')
    expect(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).toLowerCase()).not.toContain('scam')
  })

  it('still blocks an unlimited approval to an unrecognized spender on an unrecognized token', () => {
    const data = encodeCall(SELECTORS.approve, encodeAddress(STRANGER), encodeUint(MAX_UINT256))
    expect(parse(STRANGER, data).decision.verdict).toBe('BLOCK')
  })

  it('flags known selectors with malformed arguments', () => {
    const r = parse(USDC, `${SELECTORS.approve}${'ff'.repeat(32)}${'00'.repeat(32)}`)
    expect(r.decoded.kind).toBe('unknown')
    expect(r.decoded.summary).toContain('malformed')
    expect(r.risks[0].title).toBe('Malformed arguments')
    expect(r.decision.verdict).toBe('BLOCK')
  })

  it('treats balanceOf as a read-only eth_call', () => {
    const r = parseCustomInput(USDC, encodeCall(SELECTORS.balanceOf, encodeAddress(DEMO_WALLET)))
    expect(r.ok && r.tx.method).toBe('eth_call')
  })
})
