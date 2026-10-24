import { formatUnits, KNOWN_FUNCTIONS, shortAddr } from './abi'
import { findLookalike, POLICY } from './context'
import type { DecodedTransaction, ProposedTransaction, RiskFactor, RuleResult, SafetyDecision, Verdict } from './types'

const RANK: Record<Verdict, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 }

interface Rule {
  id: string
  name: string
  outcome: Verdict
  test: (d: DecodedTransaction, has: (id: string) => boolean) => boolean
  reason: string
  explain: (c: Ctx) => string
}

interface Ctx {
  d: DecodedTransaction
  tx: ProposedTransaction
  has: (id: string) => boolean
}

const who = (d: DecodedTransaction) =>
  d.counterparty ? `${d.counterpartyLabel ?? 'unrecognized address'} (${shortAddr(d.counterparty)})` : 'the recipient'
const amountOf = (d: DecodedTransaction) => d.args.find((a) => a.name === 'amount' || a.name === 'value')?.display ?? 'this amount'
const tokenOf = (d: DecodedTransaction) => d.token?.symbol ?? 'this token'

const EXPLAIN: Record<string, (c: Ctx) => string> = {
  R1: ({ tx }) => `It targets network ID ${tx.chainId}, which this agent is not allowed to use.`,
  R2: ({ d }) => {
    const known = d.selector ? KNOWN_FUNCTIONS[d.selector] : undefined
    return known
      ? `The data looks like ${known}, but its contents are malformed, so AgentShield can't tell you what it would really do.`
      : `It calls a function AgentShield doesn't recognize${d.selector ? ` (${d.selector})` : ''}, so it can't explain what it would do.`
  },
  R3: ({ d }) =>
    `It would give ${who(d)} permission to take all of your ${tokenOf(d)}, including tokens you receive later, at any time, and AgentShield can't verify who controls that address.`,
  R4: () => 'The permission has no limit. Approving only the amount you need caps what could be taken later.',
  R5: ({ d }) => `The spender, ${who(d)}, isn't a saved contact or a known protocol contract, so AgentShield can't verify who controls it.`,
  R6: ({ d, has }) => {
    const limit = POLICY.maxTransferPerTx[d.token?.symbol ?? '']
    return has('over-limit') && d.token && limit !== undefined
      ? `${amountOf(d)} is more than this agent's ${formatUnits(limit, d.token.decimals)} ${d.token.symbol} per-transaction limit.`
      : `There's no spending limit set for ${tokenOf(d)}, so the amount can't be checked.`
  },
  R7: ({ tx }) => `The token contract (${shortAddr(tx.to)}) isn't one AgentShield recognizes, so the token and the amount can't be verified here.`,
  R8: ({ tx }) => `It also sends ${formatUnits(tx.value, 18)} ETH, and this agent isn't allowed to send ETH.`,
  R9: ({ d }) => `The recipient, ${who(d)}, isn't in your saved contacts.`,
  R10: ({ d }) => `It moves ${amountOf(d)} out of your wallet, and transfers can't be undone once confirmed.`,
  R11: () => 'It only reads data. Nothing is approved and nothing is sent.',
  R12: ({ d }) => {
    const saved = d.counterparty ? findLookalike(d.counterparty) : undefined
    const role = d.kind === 'transfer' ? 'recipient' : 'spender'
    return saved
      ? `The ${role} address ${d.counterparty} is not the saved address for ${saved.label} (${saved.address}). They start and end with the same characters, so they look identical when shortened, but the full addresses are different.`
      : `The ${role} address looks like a saved address when shortened, but the full address is different.`
  },
  R13: ({ d }) =>
    `Signing this permit gives ${who(d)} permission to spend ${d.isUnlimited ? `any amount of your ${tokenOf(d)}` : amountOf(d)}, even though no tokens move when you sign.`,
  R14: ({ d }) => `AgentShield couldn't decode this as a standard EIP-2612 permit. ${d.problem ?? ''}`.trim(),
}

// Deterministic: same input always yields the same verdict. Most severe triggered outcome wins.
export const RULES: Rule[] = [
  { id: 'R1', name: 'Allowed network', outcome: 'BLOCK', test: (_d, has) => has('wrong-chain'), reason: 'Transaction targets a network outside the allow list.', explain: EXPLAIN.R1 },
  { id: 'R2', name: 'Explainable call', outcome: 'BLOCK', test: (_d, has) => has('unknown-function'), reason: 'Calls that cannot be decoded are never allowed.', explain: EXPLAIN.R2 },
  { id: 'R3', name: 'No unlimited approvals to unrecognized spenders', outcome: 'BLOCK', test: (_d, has) => has('unlimited-approval') && has('unrecognized-spender'), reason: 'An unlimited allowance to an address that cannot be verified puts the whole balance at risk.', explain: EXPLAIN.R3 },
  { id: 'R4', name: 'Unlimited approvals need review', outcome: 'WARN', test: (_d, has) => has('unlimited-approval'), reason: 'Even trusted spenders should get a bounded allowance where possible.', explain: EXPLAIN.R4 },
  { id: 'R5', name: 'Unrecognized spender', outcome: 'WARN', test: (_d, has) => has('unrecognized-spender'), reason: 'Approving an unrecognized spender requires human review.', explain: EXPLAIN.R5 },
  { id: 'R6', name: 'Per-transaction transfer limit', outcome: 'BLOCK', test: (_d, has) => has('over-limit') || has('unlisted-token'), reason: 'Transfer exceeds the limit, or the token has no configured limit to check against.', explain: EXPLAIN.R6 },
  { id: 'R7', name: 'Unrecognized token transfer', outcome: 'WARN', test: (d, has) => d.kind === 'transfer' && has('unrecognized-token'), reason: "The token and amount can't be verified here, so review before signing.", explain: EXPLAIN.R7 },
  { id: 'R8', name: 'Native ETH value', outcome: 'BLOCK', test: (_d, has) => has('native-value'), reason: 'This agent is not permitted to send native ETH.', explain: EXPLAIN.R8 },
  { id: 'R9', name: 'Unrecognized recipient', outcome: 'WARN', test: (_d, has) => has('unknown-recipient'), reason: 'Recipient is not in the address book.', explain: EXPLAIN.R9 },
  { id: 'R10', name: 'Human confirms value movement', outcome: 'WARN', test: (d) => d.writesState && (d.kind === 'transfer' || d.kind === 'native-transfer'), reason: 'Any irreversible movement of funds needs explicit human confirmation.', explain: EXPLAIN.R10 },
  { id: 'R11', name: 'Read-only calls pass', outcome: 'ALLOW', test: (d) => !d.writesState && d.kind === 'read', reason: 'Read-only queries cannot move funds or change state.', explain: EXPLAIN.R11 },
  { id: 'R12', name: 'Lookalike of a saved address', outcome: 'BLOCK', test: (_d, has) => has('lookalike-address'), reason: 'An address that only matches a saved address in its shortened form must not be used in its place.', explain: EXPLAIN.R12 },
  { id: 'R13', name: 'Permit signatures need review', outcome: 'WARN', test: (d) => d.kind === 'permit', reason: 'A signed permit grants spending permission, so a human must review it.', explain: EXPLAIN.R13 },
  { id: 'R14', name: 'Supported typed data', outcome: 'WARN', test: (_d, has) => has('unsupported-typed-data'), reason: 'Typed data that is not a standard EIP-2612 Permit cannot be explained, so it is held for review.', explain: EXPLAIN.R14 },
]

const HEADLINES: Record<Verdict, string> = {
  ALLOW: 'No rule flagged this transaction.',
  WARN: 'Needs your review before signing.',
  BLOCK: 'Blocked by a safety rule.',
}

export function evaluatePolicy(tx: ProposedTransaction, d: DecodedTransaction, risks: RiskFactor[]): SafetyDecision {
  const ids = new Set(risks.map((r) => r.id))
  const has = (id: string) => ids.has(id)
  const rules: RuleResult[] = RULES.map((r) => {
    const triggered = r.test(d, has)
    return { id: r.id, name: r.name, outcome: r.outcome, triggered, reason: r.reason, explanation: triggered ? r.explain({ d, tx, has }) : '' }
  })
  const triggered = rules.filter((r) => r.triggered)
  // Writes with no triggered rule default to WARN (fail closed); only explicit ALLOW rules can allow.
  const verdict: Verdict = triggered.length
    ? triggered.reduce<Verdict>((acc, r) => (RANK[r.outcome] > RANK[acc] ? r.outcome : acc), 'ALLOW')
    : 'WARN'
  return { verdict, headline: HEADLINES[verdict], rules }
}
