import { describe, expect, it } from 'vitest'
import { ALICE_LOOKALIKE, SIMULATED_CASES } from './cases'
import { analyze } from './pipeline'
import { encodeAddress, encodeCall, encodeUint, MAX_UINT256, SELECTORS } from './abi'
import { parseCustomInput } from './custom'
import { DEMO_DISCLAIMER } from './explain'
import { buildPermitTypedData, parsePermitInput } from './permit'
import { DEMO_WALLET } from './context'
import type { AnalysisResult, Hex, ProposedTransaction } from './types'

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

describe('plain-language explanation for beginners', () => {
  const all = () => SIMULATED_CASES.map((c) => analyze(c.tx))
  const text = (r: ReturnType<typeof analyze>) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

  it('read-only: asks for nothing and sends to no one', () => {
    const { plain } = byId('balance-check')
    expect(plain.asksFor.title).toMatch(/read-only/)
    expect(plain.recipient.label).toBe('No one')
    expect(plain.reasons[0]).toContain('only reads data')
  })

  it('transfer: names the amount and the recipient with full address', () => {
    const r = byId('small-transfer')
    expect(r.plain.asksFor.text).toContain('25 USDC')
    expect(r.plain.recipient.label).toContain('Alice')
    expect(r.plain.recipient.address).toBe(r.decoded.counterparty)
    expect(r.plain.reasons.join(' ')).toContain('moves 25 USDC')
    expect(r.plain.verdictLabel).toBe('Review before signing')
  })

  it('unlimited approval: explains the permission, the spender, and the specific block reason', () => {
    const r = byId('unlimited-approval')
    expect(r.plain.asksFor.title).toContain('unlimited spending permission')
    expect(r.plain.recipient.role).toContain('spender')
    expect(r.plain.recipient.address).toBe(r.decoded.counterparty)
    expect(r.plain.reasons).toHaveLength(1)
    expect(r.plain.reasons[0]).toContain("can't verify who controls")
    expect(r.plain.reasons[0]).toContain('take all of your USDC')
    expect(r.plain.alsoNote.length).toBeGreaterThan(0)
    expect(r.plain.nextStep).toMatch(/^Don’t sign unless you independently verify the spender and the permission\./)
    expect(r.plain.nextStep).not.toMatch(/Don.t sign this/)
    expect(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/pass(ed)? (it )?on for signing/)
  })

  it('gives every triggered rule a specific explanation', () => {
    for (const r of all()) for (const rule of r.decision.rules.filter((x) => x.triggered)) expect(rule.explanation.length).toBeGreaterThan(20)
  })

  it('never overclaims protection or labels anything a scam', () => {
    for (const r of all()) expect(text(r)).not.toMatch(/safe to proceed|you are protected|guaranteed|scam/i)
  })

  it('ends every next step with the same general demo disclaimer', () => {
    const pasted = parseCustomInput('0x1234567890abcdef1234567890abcdef12345678', '0x095ea7b3' + 'ff'.repeat(32))
    if (!pasted.ok) throw new Error('expected ok')
    const txs = [...SIMULATED_CASES.map((c) => c.tx), pasted.tx]
    for (const tx of txs) {
      const step = analyze(tx).plain.nextStep
      expect(step.endsWith(DEMO_DISCLAIMER)).toBe(true)
      expect(step).not.toMatch(/pasted data|Don.t sign this/)
    }
  })
})

describe('lookalike of a saved address', () => {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const ALICE_ADDR = '0xa0f5034c04fd9ed0ec40b1a64ddb86076d885ab8'
  const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
  const PERMIT2_LOOKALIKE = '0x000000' + 'f'.repeat(30) + '8ba3'
  const UNRELATED = '0x' + 'deadbeef'.repeat(5)
  const run = (data: string) => {
    const p = parseCustomInput(USDC, data)
    if (!p.ok) throw new Error('expected valid input')
    return analyze(p.tx)
  }
  const transferTo = (addr: string) => run(encodeCall(SELECTORS.transfer, encodeAddress(addr as Hex), encodeUint(10_000_000n)))
  const approve = (addr: string) => run(encodeCall(SELECTORS.approve, encodeAddress(addr as Hex), encodeUint(10_000_000n)))
  const r12 = (r: AnalysisResult) => r.decision.rules.find((x) => x.id === 'R12')!
  const ids = (r: AnalysisResult) => r.risks.map((x) => x.id)

  it('exact saved-address match stays on the saved-contact path', () => {
    const r = transferTo(ALICE_ADDR)
    expect(r.decision.verdict).toBe('WARN')
    expect(ids(r)).toContain('known-recipient')
    expect(ids(r)).not.toContain('lookalike-address')
    expect(r12(r).triggered).toBe(false)
  })

  it('blocks a lookalike recipient and shows both full addresses with copy advice', () => {
    const r = transferTo(ALICE_LOOKALIKE)
    expect(r.decision.verdict).toBe('BLOCK')
    expect(ids(r)).toContain('lookalike-address')
    expect(r12(r).triggered).toBe(true)
    const why = r.plain.reasons.join(' ')
    expect(why).toContain(ALICE_LOOKALIKE)
    expect(why).toContain(ALICE_ADDR)
    expect(why).toContain('full addresses are different')
    expect(r.plain.recipient.address).toBe(ALICE_LOOKALIKE)
    expect(r.plain.recipient.note).toContain(ALICE_ADDR)
    expect(r.plain.recipient.note).toMatch(/Copy the address from your saved contact/)
    expect(r.plain.nextStep).toMatch(/Copy the address from your saved contact/)
    const text = JSON.stringify([r.plain, r12(r), r.risks.find((x) => x.id === 'lookalike-address')])
    expect(text).not.toMatch(/malicious|scam|every/i)
  })

  it('blocks a lookalike approval spender, but not the exact trusted spender', () => {
    const look = approve(PERMIT2_LOOKALIKE)
    expect(look.decision.verdict).toBe('BLOCK')
    expect(r12(look).triggered).toBe(true)
    expect(look.plain.recipient.note).toContain(PERMIT2)
    const exact = approve(PERMIT2)
    expect(ids(exact)).toContain('trusted-spender')
    expect(r12(exact).triggered).toBe(false)
    expect(exact.decision.verdict).not.toBe('BLOCK')
  })

  it('keeps an unrelated unrecognized address on its existing path', () => {
    const r = transferTo(UNRELATED)
    expect(r.decision.verdict).toBe('WARN')
    expect(ids(r)).toContain('unknown-recipient')
    expect(ids(r)).not.toContain('lookalike-address')
    expect(r12(r).triggered).toBe(false)
  })

  it('leaves the original presets unchanged', () => {
    const original = SIMULATED_CASES.slice(0, 3)
    expect(original.map((c) => analyze(c.tx).decision.verdict)).toEqual(['ALLOW', 'WARN', 'BLOCK'])
    for (const c of original) expect(r12(analyze(c.tx)).triggered).toBe(false)
  })

  it('lookalike recipient sample is blocked by the existing lookalike rule', () => {
    const r = byId('lookalike-recipient')
    expect(r.decoded.kind).toBe('transfer')
    expect(r.decoded.counterparty).toBe(ALICE_LOOKALIKE)
    expect(r.decoded.args.find((a) => a.name === 'amount')?.display).toBe('10 USDC')
    expect(r.decision.verdict).toBe('BLOCK')
    expect(r12(r).triggered).toBe(true)
    expect(r.decision.rules.filter((x) => x.triggered && x.outcome === 'BLOCK').map((x) => x.id)).toEqual(['R12'])
    const why = r.plain.reasons.join(' ')
    expect(why).toContain(ALICE_LOOKALIKE)
    expect(why).toContain(ALICE_ADDR)
    expect(why).toContain('full addresses are different')
    expect(r.plain.recipient.note).toMatch(/Copy the address from your saved contact/)
    expect(r.plain.nextStep).toMatch(/Copy the address from your saved contact/)
  })
})

describe('EIP-2612 permit input', () => {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Hex
  const UNKNOWN_TOKEN = '0x1234567890abcdef1234567890abcdef12345678' as Hex
  const STRANGER = '0x' + 'deadbeef'.repeat(5)
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
  const MAX = MAX_UINT256.toString()
  type Typed = ReturnType<typeof buildPermitTypedData>
  const typed = (spender: string, value: string, token: Hex = USDC) => buildPermitTypedData({ token, spender: spender as Hex, value })
  const analyzeTyped = (t: Typed | object) => {
    const p = parsePermitInput(JSON.stringify(t))
    if (!p.ok) throw new Error(p.error)
    return analyze(p.tx, p.decoded)
  }
  const rule = (r: AnalysisResult, id: string) => r.decision.rules.find((x) => x.id === id)!
  const arg = (r: AnalysisResult, name: string) => r.decoded.args.find((a) => a.name === name)?.display

  it('decodes the five standard Permit fields', () => {
    const r = analyzeTyped(typed(STRANGER, '50000000'))
    expect(r.decoded.kind).toBe('permit')
    expect(r.decoded.args.map((a) => a.name)).toEqual(['owner', 'spender', 'value', 'nonce', 'deadline'])
    expect(arg(r, 'value')).toBe('50 USDC')
    expect(arg(r, 'nonce')).toBe('0')
    expect(arg(r, 'deadline')).toContain('2030-01-01 00:00 UTC')
    expect(r.plain.recipient.address).toBe(STRANGER)
  })

  it('explains that signing grants permission without sending tokens', () => {
    const r = analyzeTyped(typed(STRANGER, '50000000'))
    expect(r.plain.asksFor.text).toContain("doesn't send a transaction or move tokens right away")
    expect(r.plain.asksFor.text).toContain('the signature itself grants the permission')
    expect(rule(r, 'R13').explanation).toContain('no tokens move when you sign')
  })

  it('applies the existing unlimited-approval rule: unlimited permit to unrecognized spender is BLOCK', () => {
    const r = analyzeTyped(typed(STRANGER, MAX))
    expect(r.decision.verdict).toBe('BLOCK')
    expect(rule(r, 'R3').triggered).toBe(true)
  })

  it('unlimited permit to a trusted spender is held for review', () => {
    const r = analyzeTyped(typed(PERMIT2, MAX))
    expect(r.decision.verdict).toBe('WARN')
    expect(rule(r, 'R4').triggered).toBe(true)
  })

  it('finite permits are labeled for review, even to a trusted spender', () => {
    expect(analyzeTyped(typed(STRANGER, '50000000')).decision.verdict).toBe('WARN')
    const trusted = analyzeTyped(typed(PERMIT2, '50000000'))
    expect(trusted.decision.verdict).toBe('WARN')
    expect(rule(trusted, 'R13').triggered).toBe(true)
  })

  it('shows raw amounts when token decimals are unknown', () => {
    const r = analyzeTyped(typed(STRANGER, '50000000', UNKNOWN_TOKEN))
    expect(arg(r, 'value')).toBe('50,000,000 base units of an unrecognized token')
    expect(r.decoded.contractLabel).toBe('Unrecognized contract')
    expect(r.decision.verdict).toBe('WARN')
  })

  it('holds malformed typed data for review instead of decoding it', () => {
    const base = typed(STRANGER, '50000000')
    const cases: object[] = [
      { ...base, message: { ...base.message, spender: '0x123' } },
      { ...base, message: { ...base.message, value: '-1' } },
      { ...base, message: { ...base.message, value: (MAX_UINT256 + 1n).toString() } },
      { ...base, message: { owner: base.message.owner, spender: STRANGER, value: '1', nonce: '0' } },
      { ...base, message: { ...base.message, extra: '1' } },
      { ...base, types: { Permit: base.types.Permit.slice(0, 4) } },
      { ...base, domain: { ...base.domain, verifyingContract: 'nope' } },
    ]
    for (const c of cases) {
      const r = analyzeTyped(c)
      expect(r.decoded.kind).toBe('unsupported-typed-data')
      expect(r.decision.verdict).toBe('WARN')
      expect(rule(r, 'R14').triggered).toBe(true)
      expect(rule(r, 'R2').triggered).toBe(false)
      expect(r.plain.verdictLabel).toBe('Review before signing')
    }
  })

  it('holds unsupported typed data (e.g. Permit2 PermitSingle) for review', () => {
    const r = analyzeTyped({ primaryType: 'PermitSingle', types: {}, domain: { chainId: 1, verifyingContract: PERMIT2 }, message: {} })
    expect(r.decision.verdict).toBe('WARN')
    expect(rule(r, 'R14').explanation).toContain('PermitSingle')
    expect(r.plain.asksFor.title).toBe('Unknown signature request')
  })

  it('rejects input that is not a JSON object', () => {
    expect(parsePermitInput('not json').ok).toBe(false)
    expect(parsePermitInput('[1,2]').ok).toBe(false)
  })

  it('never claims to verify signatures or detect scams, and keeps presets unchanged', () => {
    for (const t of [typed(STRANGER, MAX), typed(STRANGER, '1'), { primaryType: 'Other' }]) {
      const text = JSON.stringify(analyzeTyped(t), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      expect(text).not.toMatch(/scam|signature is valid|verified signature/i)
    }
    expect(SIMULATED_CASES.map((c) => analyze(c.tx).decision.verdict)).toEqual(['ALLOW', 'WARN', 'BLOCK', 'BLOCK'])
  })
})
