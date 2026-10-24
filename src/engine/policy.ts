import type { DecodedTransaction, RiskFactor, RuleResult, SafetyDecision, Verdict } from './types'

const RANK: Record<Verdict, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 }

interface Rule {
  id: string
  name: string
  outcome: Verdict
  test: (d: DecodedTransaction, has: (id: string) => boolean) => boolean
  reason: string
}

// Deterministic: same input always yields the same verdict. Most severe triggered outcome wins.
export const RULES: Rule[] = [
  { id: 'R1', name: 'Allowed network', outcome: 'BLOCK', test: (_d, has) => has('wrong-chain'), reason: 'Transaction targets a network outside the allow list.' },
  { id: 'R2', name: 'Explainable call', outcome: 'BLOCK', test: (_d, has) => has('unknown-function'), reason: 'Calls that cannot be decoded are never allowed.' },
  { id: 'R3', name: 'No unlimited approvals to unrecognized spenders', outcome: 'BLOCK', test: (_d, has) => has('unlimited-approval') && has('unrecognized-spender'), reason: 'An unlimited allowance to an address that cannot be verified puts the whole balance at risk.' },
  { id: 'R4', name: 'Unlimited approvals need review', outcome: 'WARN', test: (_d, has) => has('unlimited-approval'), reason: 'Even trusted spenders should get a bounded allowance where possible.' },
  { id: 'R5', name: 'Unrecognized spender', outcome: 'WARN', test: (_d, has) => has('unrecognized-spender'), reason: 'Approving an unrecognized spender requires human review.' },
  { id: 'R6', name: 'Per-transaction transfer limit', outcome: 'BLOCK', test: (_d, has) => has('over-limit') || has('unlisted-token'), reason: 'Transfer exceeds the limit, or the token has no configured limit to check against.' },
  { id: 'R7', name: 'Unrecognized token transfer', outcome: 'WARN', test: (d, has) => d.kind === 'transfer' && has('unrecognized-token'), reason: "The token and amount can't be verified here, so review before signing." },
  { id: 'R8', name: 'Native ETH value', outcome: 'BLOCK', test: (_d, has) => has('native-value'), reason: 'This agent is not permitted to send native ETH.' },
  { id: 'R9', name: 'Unrecognized recipient', outcome: 'WARN', test: (_d, has) => has('unknown-recipient'), reason: 'Recipient is not in the address book.' },
  { id: 'R10', name: 'Human confirms value movement', outcome: 'WARN', test: (d) => d.writesState && (d.kind === 'transfer' || d.kind === 'native-transfer'), reason: 'Any irreversible movement of funds needs explicit human confirmation.' },
  { id: 'R11', name: 'Read-only calls pass', outcome: 'ALLOW', test: (d) => !d.writesState && d.kind === 'read', reason: 'Read-only queries cannot move funds or change state.' },
]

const HEADLINES: Record<Verdict, string> = {
  ALLOW: 'Safe to proceed. No state change or fund movement.',
  WARN: 'Paused for human confirmation before it could be signed.',
  BLOCK: 'Blocked. This transaction will not be passed on for signing.',
}

export function evaluatePolicy(d: DecodedTransaction, risks: RiskFactor[]): SafetyDecision {
  const ids = new Set(risks.map((r) => r.id))
  const has = (id: string) => ids.has(id)
  const rules: RuleResult[] = RULES.map((r) => ({ id: r.id, name: r.name, outcome: r.outcome, triggered: r.test(d, has), reason: r.reason }))
  const triggered = rules.filter((r) => r.triggered)
  // Writes with no triggered rule default to WARN (fail closed); only explicit ALLOW rules can allow.
  const verdict: Verdict = triggered.length
    ? triggered.reduce<Verdict>((acc, r) => (RANK[r.outcome] > RANK[acc] ? r.outcome : acc), 'ALLOW')
    : 'WARN'
  return { verdict, headline: HEADLINES[verdict], rules }
}
