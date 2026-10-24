export type Hex = `0x${string}`

export interface ProposedTransaction {
  method: 'eth_call' | 'eth_sendTransaction'
  chainId: number
  from: Hex
  to: Hex
  value: bigint
  data: Hex
}

export interface SimulatedCase {
  id: string
  title: string
  subtitle: string
  userRequest: string
  agentRationale: string
  tx: ProposedTransaction
}

export interface DecodedArg {
  name: string
  type: 'address' | 'uint256'
  raw: string
  display: string
}

export interface DecodedTransaction {
  kind: 'read' | 'transfer' | 'approve' | 'native-transfer' | 'unknown'
  functionSignature: string | null
  selector: string | null
  contractLabel: string
  args: DecodedArg[]
  summary: string
  writesState: boolean
  token?: TokenInfo
  amount?: bigint
  isUnlimited?: boolean
  counterparty?: Hex
  counterpartyLabel?: string
}

export interface TokenInfo {
  address: Hex
  symbol: string
  name: string
  decimals: number
}

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export interface RiskFactor {
  id: string
  severity: Severity
  title: string
  detail: string
}

export type Verdict = 'ALLOW' | 'WARN' | 'BLOCK'

export interface RuleResult {
  id: string
  name: string
  triggered: boolean
  outcome: Verdict
  reason: string
}

export interface SafetyDecision {
  verdict: Verdict
  headline: string
  rules: RuleResult[]
}

export interface TraceStep {
  id: 'decode' | 'risk' | 'safety'
  label: string
  detail: string
  items: string[]
}

export interface AnalysisResult {
  decoded: DecodedTransaction
  risks: RiskFactor[]
  decision: SafetyDecision
  trace: TraceStep[]
}
