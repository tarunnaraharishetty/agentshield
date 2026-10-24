import { formatUnits, KNOWN_FUNCTIONS } from './abi'
import { ADDRESS_BOOK, lookup, POLICY, TRUSTED_SPENDERS } from './context'
import type { DecodedTransaction, ProposedTransaction, RiskFactor } from './types'

export function assessRisks(tx: ProposedTransaction, d: DecodedTransaction): RiskFactor[] {
  const risks: RiskFactor[] = []

  if (!POLICY.allowedChainIds.includes(tx.chainId)) {
    risks.push({ id: 'wrong-chain', severity: 'critical', title: 'Unexpected network', detail: `Chain ID ${tx.chainId} is not on the allow list.` })
  }

  if (!d.writesState && d.kind === 'read') {
    risks.push({ id: 'read-only', severity: 'info', title: 'Read-only call', detail: 'eth_call does not create a transaction, cost gas, or change state.' })
  }

  if (tx.value > POLICY.maxNativeValueWei) {
    risks.push({ id: 'native-value', severity: 'high', title: 'Sends native ETH', detail: `Attaches ${formatUnits(tx.value, 18)} ETH to the call.` })
  }

  if (d.kind === 'unknown') {
    const malformed = d.selector ? KNOWN_FUNCTIONS[d.selector] : undefined
    risks.push({ id: 'unknown-function', severity: 'critical', title: malformed ? 'Malformed arguments' : 'Unrecognized function', detail: malformed ? `Selector matches ${malformed}, but the arguments do not decode cleanly.` : 'The calldata does not match any known, explainable function.' })
  }

  if (d.kind === 'transfer' && d.amount !== undefined) {
    risks.push({ id: 'irreversible', severity: 'medium', title: 'Moves funds irreversibly', detail: 'Token transfers cannot be undone once confirmed on-chain.' })
    const symbol = d.token?.symbol ?? ''
    const limit = POLICY.maxTransferPerTx[symbol]
    if (limit === undefined) {
      risks.push({ id: 'unlisted-token', severity: 'high', title: 'Token has no spending limit', detail: 'There is no per-transaction limit configured for this token, so the amount cannot be checked.' })
    } else if (d.amount > limit) {
      risks.push({ id: 'over-limit', severity: 'high', title: 'Above per-transaction limit', detail: `Exceeds the ${formatUnits(limit, d.token!.decimals)} ${symbol} limit.` })
    } else {
      risks.push({ id: 'within-limit', severity: 'low', title: 'Within per-transaction limit', detail: `${formatUnits(d.amount, d.token!.decimals)} ${symbol} is under the ${formatUnits(limit, d.token!.decimals)} ${symbol} limit.` })
    }
    if (d.counterparty && lookup(ADDRESS_BOOK, d.counterparty)) {
      risks.push({ id: 'known-recipient', severity: 'info', title: 'Recipient is a saved contact', detail: `${d.counterpartyLabel} is in the address book.` })
    } else {
      risks.push({ id: 'unknown-recipient', severity: 'medium', title: 'Unrecognized recipient', detail: 'The recipient is not in your saved contacts. That does not make it malicious, but it cannot be verified here.' })
    }
  }

  if ((d.kind === 'transfer' || d.kind === 'approve' || d.kind === 'read') && !d.token) {
    risks.push({ id: 'unrecognized-token', severity: 'medium', title: 'Unrecognized token contract', detail: 'The contract is not in the token registry, so symbol and decimals are unknown. Amounts are shown in raw base units.' })
  }

  if (d.kind === 'approve') {
    const trusted = d.counterparty ? lookup(TRUSTED_SPENDERS, d.counterparty) : undefined
    if (d.isUnlimited) {
      risks.push({ id: 'unlimited-approval', severity: 'critical', title: 'Unlimited token allowance', detail: 'The spender could move the entire balance, including future deposits, without asking again.' })
    }
    if (trusted) {
      risks.push({ id: 'trusted-spender', severity: 'info', title: 'Spender is on the trusted list', detail: `${trusted} is a recognized spender.` })
    } else {
      risks.push({ id: 'unrecognized-spender', severity: 'high', title: 'Unrecognized spender', detail: 'The spender is not a saved contact or a known protocol contract. That does not make it malicious, but it cannot be verified here.' })
    }
    risks.push({ id: 'persistent-permission', severity: 'medium', title: 'Permission persists', detail: 'Approvals stay active until explicitly revoked.' })
  }

  return risks
}
