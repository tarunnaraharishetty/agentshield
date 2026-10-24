import { formatUnits } from './abi'
import { ADDRESS_BOOK, lookup, TRUSTED_SPENDERS } from './context'
import type { DecodedTransaction, PlainExplanation, ProposedTransaction, SafetyDecision, Verdict } from './types'

export const VERDICT_LABEL: Record<Verdict, string> = {
  ALLOW: 'Allowed',
  WARN: 'Review before signing',
  BLOCK: 'Blocked',
}

const REASONS_TITLE: Record<Verdict, string> = {
  ALLOW: 'Why it was allowed',
  WARN: 'Why it needs review',
  BLOCK: 'Why it was blocked',
}

const UNVERIFIED = "AgentShield can't verify who controls it."

function asksFor(tx: ProposedTransaction, d: DecodedTransaction): PlainExplanation['asksFor'] {
  const amount = d.args.find((a) => a.name === 'amount')?.display
  const token = d.token?.symbol ?? 'this token'
  switch (d.kind) {
    case 'read':
      return {
        title: 'Nothing: a read-only check',
        text: `It only looks up the ${d.token?.symbol ?? 'token'} balance of ${d.counterpartyLabel}. No permission is granted, nothing is sent, and there is nothing to sign.`,
      }
    case 'transfer':
      return {
        title: 'A token transfer',
        text: `Move ${amount} out of your wallet. Once confirmed on-chain, a transfer can't be undone.`,
      }
    case 'approve':
      return d.isUnlimited
        ? {
            title: 'An unlimited spending permission (token approval)',
            text: `Let the spender take any amount of your ${token} (your whole balance, including tokens you receive later) whenever it wants, without asking you again, until you revoke the permission. No tokens move when you sign, but the spender can move them afterward.`,
          }
        : {
            title: 'A limited spending permission (token approval)',
            text: `Let the spender take up to ${amount} from your wallet whenever it wants, until it is used up or you revoke it. No tokens move when you sign, but the spender can move them afterward.`,
          }
    case 'native-transfer':
      return { title: 'An ETH transfer', text: `Send ${formatUnits(tx.value, 18)} ETH out of your wallet. This can't be undone.` }
    default:
      return {
        title: 'Unknown',
        text: `AgentShield couldn't decode this call, so it can't tell you what it asks for. ${d.summary}`,
      }
  }
}

function recipient(tx: ProposedTransaction, d: DecodedTransaction): PlainExplanation['recipient'] {
  const label = d.counterpartyLabel ?? 'unrecognized address'
  const address = d.counterparty ?? null
  switch (d.kind) {
    case 'read':
      return { role: 'Who receives something', label: 'No one', address: null, note: 'A read-only check sends nothing to anyone.' }
    case 'transfer':
    case 'native-transfer':
      return {
        role: 'Who receives the tokens',
        label,
        address,
        note: address && lookup(ADDRESS_BOOK, address)
          ? 'Saved in your contacts. Still compare the full address before signing.'
          : `Not in your saved contacts, so ${UNVERIFIED}`,
      }
    case 'approve':
      return {
        role: 'Who receives the permission (the spender)',
        label,
        address,
        note: address && lookup(TRUSTED_SPENDERS, address)
          ? "On AgentShield's list of known protocol contracts. Still compare the full address before signing."
          : `Not a saved contact or known protocol contract, so ${UNVERIFIED}`,
      }
    default:
      return { role: 'Who receives it', label: 'Unknown', address: tx.to, note: "Can't be determined from the data. The address shown is the contract being called." }
  }
}

function nextStep(d: DecodedTransaction, decision: SafetyDecision): string {
  const fired = (id: string) => decision.rules.some((r) => r.id === id && r.triggered)
  if (decision.verdict === 'ALLOW') {
    return d.kind === 'read'
      ? 'Nothing to sign. This only reads data.'
      : "No rule flagged this, but that isn't a guarantee. Read the details before signing."
  }
  if (decision.verdict === 'WARN') {
    return 'Review before signing. Check the full address and the amount against a source you trust, and only sign if they match what you intended.'
  }
  let tip = ''
  if (fired('R3')) tip = ' If you really need this service, approve only the amount you need, and only to a spender you can verify.'
  else if (fired('R2')) tip = ' Ask the agent to rebuild the transaction from a source you trust.'
  else if (fired('R6')) tip = ' Send a smaller amount, or change the limit yourself only if you really intend this.'
  return `Don't sign this. AgentShield will not pass it on for signing.${tip}`
}

export function explainPlainly(tx: ProposedTransaction, d: DecodedTransaction, decision: SafetyDecision): PlainExplanation {
  const triggered = decision.rules.filter((r) => r.triggered)
  const primary = triggered.filter((r) => r.outcome === decision.verdict)
  const others = triggered.filter((r) => r.outcome !== decision.verdict && r.outcome !== 'ALLOW')
  return {
    verdictLabel: VERDICT_LABEL[decision.verdict],
    asksFor: asksFor(tx, d),
    recipient: recipient(tx, d),
    reasonsTitle: REASONS_TITLE[decision.verdict],
    reasons: primary.length
      ? primary.map((r) => r.explanation)
      : ["None of AgentShield's rules cover this kind of transaction, so it is held for review by default."],
    alsoNote: others.map((r) => r.explanation),
    nextStep: nextStep(d, decision),
  }
}
