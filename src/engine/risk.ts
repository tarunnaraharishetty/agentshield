import { formatUnits } from './abi'
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
    risks.push({ id: 'unknown-function', severity: 'critical', title: 'Unrecognized function', detail: 'The calldata does not match any known, explainable function.' })
  }

  if (d.kind === 'transfer' && d.amount !== undefined) {
    risks.push({ id: 'irreversible', severity: 'medium', title: 'Moves funds irreversibly', detail: 'Token transfers cannot be undone once confirmed on-chain.' })
    const symbol = d.token?.symbol ?? ''
    const limit = POLICY.maxTransferPerTx[symbol]
    if (limit === undefined) {
      risks.push({ id: 'unlisted-token', severity: 'high', title: 'Token has no spending limit', detail: 'This token is not in the policy limit table.' })
    } else if (d.amount > limit) {
      risks.push({ id: 'over-limit', severity: 'high', title: 'Above per-transaction limit', detail: `Exceeds the ${formatUnits(limit, d.token!.decimals)} ${symbol} limit.` })
    } else {
      risks.push({ id: 'within-limit', severity: 'low', title: 'Within per-transaction limit', detail: `${formatUnits(d.amount, d.token!.decimals)} ${symbol} is under the ${formatUnits(limit, d.token!.decimals)} ${symbol} limit.` })
    }
    if (d.counterparty && lookup(ADDRESS_BOOK, d.counterparty)) {
      risks.push({ id: 'known-recipient', severity: 'info', title: 'Recipient is a saved contact', detail: `${d.counterpartyLabel} is in the address book.` })
    } else {
      risks.push({ id: 'unknown-recipient', severity: 'medium', title: 'Recipient not in address book', detail: 'Funds would go to an address you have not saved.' })
    }
  }

  if (d.kind === 'approve') {
    const trusted = d.counterparty ? lookup(TRUSTED_SPENDERS, d.counterparty) : undefined
    if (d.isUnlimited) {
      risks.push({ id: 'unlimited-approval', severity: 'critical', title: 'Unlimited token allowance', detail: 'The spender could drain the entire balance, including future deposits, without asking again.' })
    }
    if (trusted) {
      risks.push({ id: 'trusted-spender', severity: 'info', title: 'Spender is on the trusted list', detail: `${trusted} is a recognized spender.` })
    } else {
      risks.push({ id: 'unfamiliar-spender', severity: 'high', title: 'Unfamiliar spender', detail: 'The spender is not a saved contact or a recognized protocol contract.' })
    }
    risks.push({ id: 'persistent-permission', severity: 'medium', title: 'Permission persists', detail: 'Approvals stay active until explicitly revoked.' })
  }

  return risks
}
