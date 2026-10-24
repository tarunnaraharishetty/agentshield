import { describe, expect, it } from 'vitest'
import { SIMULATED_CASES } from './cases'
import { analyze } from './pipeline'
import { encodeAddress, encodeCall, encodeUint, SELECTORS } from './abi'
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

  it('blocks the unlimited approval to an unfamiliar spender', () => {
    const r = byId('unlimited-approval')
    expect(r.decoded.kind).toBe('approve')
    expect(r.decoded.isUnlimited).toBe(true)
    expect(r.risks.map((x) => x.id)).toEqual(expect.arrayContaining(['unlimited-approval', 'unfamiliar-spender']))
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
