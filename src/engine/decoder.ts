import { formatUnits, isAddressWord, KNOWN_FUNCTIONS, MAX_UINT256, selectorOf, SELECTORS, shortAddr, splitCalldata, UNLIMITED_THRESHOLD, wordToAddress, wordToUint } from './abi'
import { ADDRESS_BOOK, DEMO_WALLET, lookup, TOKENS, TRUSTED_SPENDERS } from './context'
import type { DecodedTransaction, Hex, ProposedTransaction } from './types'

const labelFor = (addr: Hex): string => {
  if (addr.toLowerCase() === DEMO_WALLET.toLowerCase()) return 'your wallet'
  return lookup(ADDRESS_BOOK, addr) ?? lookup(TRUSTED_SPENDERS, addr) ?? 'unrecognized address'
}

export function decodeTransaction(tx: ProposedTransaction): DecodedTransaction {
  const token = TOKENS[tx.to.toLowerCase()]
  const contractLabel = token ? `${token.name} (${token.symbol})` : 'Unrecognized contract'
  const writesState = tx.method === 'eth_sendTransaction'
  const parts = splitCalldata(tx.data)

  if (!parts) {
    if (tx.data === '0x' && tx.value > 0n) {
      return {
        kind: 'native-transfer',
        functionSignature: null,
        selector: null,
        contractLabel,
        args: [],
        summary: `Send ${formatUnits(tx.value, 18)} ETH to ${shortAddr(tx.to)}.`,
        writesState,
        amount: tx.value,
        counterparty: tx.to,
        counterpartyLabel: labelFor(tx.to),
      }
    }
    return unknown(tx, contractLabel, writesState, selectorOf(tx.data))
  }

  const { selector, words } = parts
  const symbol = token?.symbol ?? 'tokens'
  const fmtAmount = (n: bigint) =>
    token ? `${formatUnits(n, token.decimals)} ${token.symbol}` : `${n.toLocaleString('en-US')} base units of an unrecognized token`
  const addressWordsValid = (idx: number[]) => idx.every((i) => isAddressWord(words[i]))

  if (selector === SELECTORS.balanceOf && words.length === 1 && addressWordsValid([0])) {
    const owner = wordToAddress(words[0])
    return {
      kind: 'read',
      functionSignature: 'balanceOf(address owner)',
      selector,
      contractLabel,
      args: [{ name: 'owner', type: 'address', raw: owner, display: `${shortAddr(owner)} (${labelFor(owner)})` }],
      summary: `Read the ${token ? symbol : 'token'} balance of ${labelFor(owner)}. No funds move and nothing changes on-chain.`,
      writesState,
      token,
      counterparty: owner,
      counterpartyLabel: labelFor(owner),
    }
  }

  if (selector === SELECTORS.transfer && words.length === 2 && addressWordsValid([0])) {
    const to = wordToAddress(words[0])
    const amount = wordToUint(words[1])
    const label = labelFor(to)
    return {
      kind: 'transfer',
      functionSignature: 'transfer(address to, uint256 amount)',
      selector,
      contractLabel,
      args: [
        { name: 'to', type: 'address', raw: to, display: `${shortAddr(to)} (${label})` },
        { name: 'amount', type: 'uint256', raw: amount.toString(), display: fmtAmount(amount) },
      ],
      summary: `Send ${fmtAmount(amount)} from your wallet to ${label} (${shortAddr(to)}).${token ? '' : " The token and amount can't be verified here, so review before signing."}`,
      writesState,
      token,
      amount,
      counterparty: to,
      counterpartyLabel: label,
    }
  }

  if (selector === SELECTORS.approve && words.length === 2 && addressWordsValid([0])) {
    const spender = wordToAddress(words[0])
    const amount = wordToUint(words[1])
    const isUnlimited = amount >= UNLIMITED_THRESHOLD
    const label = labelFor(spender)
    const amountText = isUnlimited ? `an UNLIMITED amount of ${token ? symbol : 'this unrecognized token'}` : `up to ${fmtAmount(amount)}`
    return {
      kind: 'approve',
      functionSignature: 'approve(address spender, uint256 amount)',
      selector,
      contractLabel,
      args: [
        { name: 'spender', type: 'address', raw: spender, display: `${shortAddr(spender)} (${label})` },
        {
          name: 'amount',
          type: 'uint256',
          raw: amount.toString(),
          display: isUnlimited ? `Unlimited (${amount === MAX_UINT256 ? '2²⁵⁶ − 1' : '≥ 2²⁵⁵'})` : fmtAmount(amount),
        },
      ],
      summary: `Give ${label} (${shortAddr(spender)}) permission to move ${amountText} out of your wallet, at any time, until revoked.`,
      writesState,
      token,
      amount,
      isUnlimited,
      counterparty: spender,
      counterpartyLabel: label,
    }
  }

  return unknown(tx, contractLabel, writesState, selector)
}

function unknown(tx: ProposedTransaction, contractLabel: string, writesState: boolean, selector: string | null): DecodedTransaction {
  return {
    kind: 'unknown',
    functionSignature: null,
    selector,
    contractLabel,
    args: [],
    summary: summarizeUnknown(contractLabel, selector),
    writesState,
    amount: tx.value,
  }
}

function summarizeUnknown(contractLabel: string, selector: string | null): string {
  if (!selector) return `The calldata is too short to contain a function selector, so its effect on ${contractLabel} cannot be explained.`
  const known = KNOWN_FUNCTIONS[selector]
  if (known) return `The data starts with the ${known} selector, but its arguments are malformed, so it cannot be explained safely.`
  return `Call an unrecognized function (${selector}) on ${contractLabel}. Its effect cannot be explained.`
}
