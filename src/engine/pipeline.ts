import { decodeTransaction } from './decoder'
import { explainPlainly } from './explain'
import { evaluatePolicy } from './policy'
import { assessRisks } from './risk'
import type { AnalysisResult, DecodedTransaction, ProposedTransaction } from './types'

// `preDecoded` is used for pasted EIP-712 permits, which are decoded from typed data instead of calldata.
export function analyze(tx: ProposedTransaction, preDecoded?: DecodedTransaction): AnalysisResult {
  const decoded = preDecoded ?? decodeTransaction(tx)
  const risks = assessRisks(tx, decoded)
  const decision = evaluatePolicy(tx, decoded, risks)
  const triggered = decision.rules.filter((r) => r.triggered)

  return {
    plain: explainPlainly(tx, decoded, decision),
    decoded,
    risks,
    decision,
    trace: [
      {
        id: 'decode',
        label: 'Decode',
        detail: decoded.functionSignature
          ? decoded.selector
            ? `Matched selector ${decoded.selector} → ${decoded.functionSignature}`
            : `Matched EIP-712 type ${decoded.functionSignature}`
          : tx.method === 'eth_signTypedData_v4'
            ? 'Typed data is not a standard EIP-2612 Permit'
            : 'No known function signature matched',
        items: [
          `Method: ${tx.method} on ${decoded.contractLabel}`,
          ...decoded.args.map((a) => `${a.name} = ${a.display}`),
        ],
      },
      {
        id: 'risk',
        label: 'Risk review',
        detail: `${risks.length} factor${risks.length === 1 ? '' : 's'} identified`,
        items: risks.map((r) => `[${r.severity}] ${r.title}`),
      },
      {
        id: 'safety',
        label: 'Final safety check',
        detail: `${triggered.length} of ${decision.rules.length} rules triggered → ${decision.verdict}`,
        items: triggered.map((r) => `${r.id} ${r.name} → ${r.outcome}`),
      },
    ],
  }
}
