import { formatUnits, MAX_UINT256, shortAddr, UNLIMITED_THRESHOLD } from './abi'
import { DEMO_WALLET, SIMULATED_CHAIN_ID, TOKENS } from './context'
import { labelFor } from './decoder'
import type { DecodedArg, DecodedTransaction, Hex, ProposedTransaction } from './types'

export const PERMIT_FIELDS = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] as const

export const PERMIT_TYPE = 'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'
export const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000'
const FIELD_NAMES = PERMIT_FIELDS.map((f) => f.name).join(', ')

export type PermitParseResult =
  | { ok: true; tx: ProposedTransaction; decoded: DecodedTransaction }
  | { ok: false; error: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isAddress = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)

function parseUint(v: unknown): bigint | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null
  if (typeof v === 'string' && (/^\d+$/.test(v) || /^0x[0-9a-fA-F]+$/.test(v))) {
    const n = BigInt(v)
    return n <= MAX_UINT256 ? n : null
  }
  return null
}

function deadlineDisplay(n: bigint): string {
  if (n >= UNLIMITED_THRESHOLD) return 'No expiry (maximum value)'
  if (n > 253402300799n) return `${n} (no practical expiry)`
  return `${n} (${new Date(Number(n) * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC)`
}

// Parses pasted EIP-712 typed data. Only the standard EIP-2612 Permit is decoded; anything else is
// returned as unsupported so it is held for review. Signatures are never created or verified.
export function parsePermitInput(input: string): PermitParseResult {
  let json: unknown
  try {
    json = JSON.parse(input)
  } catch {
    return { ok: false, error: 'Not valid JSON. Paste the full EIP-712 typed data object (domain, types, primaryType, message).' }
  }
  if (!isObj(json)) return { ok: false, error: 'Typed data must be a JSON object with domain, types, primaryType, and message.' }

  const domain = isObj(json.domain) ? json.domain : {}
  const contract = isAddress(domain.verifyingContract) ? domain.verifyingContract : null
  const chain = parseUint(domain.chainId)
  const token = contract ? TOKENS[contract.toLowerCase()] : undefined
  const contractLabel = token ? `${token.name} (${token.symbol})` : contract ? 'Unrecognized contract' : 'Not provided'
  const message = isObj(json.message) ? json.message : null

  const problem = findProblem(json, contract, chain, message)
  const owner = !problem && isAddress(message!.owner) ? message!.owner : DEMO_WALLET
  const tx: ProposedTransaction = {
    method: 'eth_signTypedData_v4',
    chainId: chain !== null && chain <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(chain) : SIMULATED_CHAIN_ID,
    from: owner,
    to: contract ?? ZERO_ADDRESS,
    value: 0n,
    data: '0x',
  }

  if (problem) {
    return {
      ok: true,
      tx,
      decoded: {
        kind: 'unsupported-typed-data',
        functionSignature: null,
        selector: null,
        contractLabel,
        args: [],
        summary: `Not decoded. ${problem} AgentShield only decodes standard EIP-2612 Permit messages.`,
        writesState: true,
        problem,
      },
    }
  }

  const m = message!
  const spender = m.spender as Hex
  const value = parseUint(m.value)!
  const nonce = parseUint(m.nonce)!
  const deadline = parseUint(m.deadline)!
  const isUnlimited = value >= UNLIMITED_THRESHOLD
  const fmtAmount = (n: bigint) =>
    token ? `${formatUnits(n, token.decimals)} ${token.symbol}` : `${n.toLocaleString('en-US')} base units of an unrecognized token`
  const label = labelFor(spender)
  const amountText = isUnlimited ? `an UNLIMITED amount of ${token ? token.symbol : 'this unrecognized token'}` : `up to ${fmtAmount(value)}`
  const args: DecodedArg[] = [
    { name: 'owner', type: 'address', raw: owner, display: `${shortAddr(owner)} (${labelFor(owner)})` },
    { name: 'spender', type: 'address', raw: spender, display: `${shortAddr(spender)} (${label})` },
    {
      name: 'value',
      type: 'uint256',
      raw: value.toString(),
      display: isUnlimited ? `Unlimited (${value === MAX_UINT256 ? '2²⁵⁶ − 1' : '≥ 2²⁵⁵'})` : fmtAmount(value),
    },
    { name: 'nonce', type: 'uint256', raw: nonce.toString(), display: nonce.toString() },
    { name: 'deadline', type: 'uint256', raw: deadline.toString(), display: deadlineDisplay(deadline) },
  ]

  return {
    ok: true,
    tx,
    decoded: {
      kind: 'permit',
      functionSignature: PERMIT_TYPE,
      selector: null,
      contractLabel,
      args,
      summary: `Sign a permit that gives ${label} (${shortAddr(spender)}) permission to move ${amountText} out of ${labelFor(owner)}. No tokens move when you sign, but the spender can use the signature to take them later.`,
      writesState: true,
      token,
      amount: value,
      isUnlimited,
      counterparty: spender,
      counterpartyLabel: label,
      owner,
    },
  }
}

function findProblem(json: Obj, contract: Hex | null, chain: bigint | null, message: Obj | null): string | null {
  if (json.primaryType !== 'Permit') {
    return typeof json.primaryType === 'string'
      ? `Unsupported typed data: primaryType "${json.primaryType}" is not the standard EIP-2612 Permit.`
      : 'Unsupported typed data: primaryType is missing.'
  }
  const fields = isObj(json.types) ? json.types.Permit : undefined
  const standard =
    Array.isArray(fields) &&
    fields.length === PERMIT_FIELDS.length &&
    PERMIT_FIELDS.every((f, i) => isObj(fields[i]) && fields[i].name === f.name && fields[i].type === f.type)
  if (!standard) return `Malformed typed data: types.Permit doesn't match the standard EIP-2612 fields (${FIELD_NAMES}).`
  if (!isObj(json.domain)) return 'Malformed typed data: domain is missing.'
  if (!contract) return 'Malformed typed data: domain.verifyingContract must be a 20-byte hex address.'
  if (chain === null || chain === 0n || chain > BigInt(Number.MAX_SAFE_INTEGER)) return 'Malformed typed data: domain.chainId must be a positive integer.'
  if (!message) return 'Malformed typed data: message is missing.'
  const extra = Object.keys(message).filter((k) => !PERMIT_FIELDS.some((f) => f.name === k))
  if (extra.length) return `Malformed typed data: message has unsupported field(s): ${extra.join(', ')}.`
  for (const f of PERMIT_FIELDS) {
    const v = message[f.name]
    if (v === undefined) return `Malformed typed data: message.${f.name} is missing.`
    if (f.type === 'address' && !isAddress(v)) return `Malformed typed data: message.${f.name} must be a 20-byte hex address.`
    if (f.type === 'uint256' && parseUint(v) === null) return `Malformed typed data: message.${f.name} must be a non-negative integer that fits in uint256.`
  }
  return null
}

// Builds standard EIP-2612 typed data for samples and tests.
export function buildPermitTypedData(opts: { token: Hex; spender: Hex; value: string; owner?: Hex; chainId?: number }) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: PERMIT_FIELDS.map((f) => ({ ...f })),
    },
    primaryType: 'Permit',
    domain: { name: 'USD Coin', version: '2', chainId: opts.chainId ?? SIMULATED_CHAIN_ID, verifyingContract: opts.token },
    message: { owner: opts.owner ?? DEMO_WALLET, spender: opts.spender, value: opts.value, nonce: '0', deadline: '1893456000' },
  }
}
