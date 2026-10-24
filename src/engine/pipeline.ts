import { decodeTransaction } from './decoder'
import { evaluatePolicy } from './policy'
import { assessRisks } from './risk'
import type { AnalysisResult, ProposedTransaction } from './types'

export function analyze(tx: ProposedTransaction): AnalysisResult {
  const decoded = decodeTransaction(tx)
  const risks = assessRisks(tx, decoded)
  const decision = evaluatePolicy(decoded, risks)
  const triggered = decision.rules.filter((r) => r.triggered)

  return {
    decoded,
    risks,
    decision,
    trace: [
      {
        id: 'decode',
        label: 'Decode',
        detail: decoded.functionSignature
          ? `Matched selector ${decoded.selector} → ${decoded.functionSignature}`
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
