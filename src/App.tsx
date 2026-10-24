import { useEffect, useMemo, useState } from 'react'
import { encodeAddress, encodeCall, encodeUint, MAX_UINT256, SELECTORS } from './engine/abi'
import { SIMULATED_CASES } from './engine/cases'
import { parseCustomInput } from './engine/custom'
import { DEMO_DISCLAIMER } from './engine/explain'
import { buildPermitTypedData, parsePermitInput, ZERO_ADDRESS } from './engine/permit'
import type { PermitParseResult } from './engine/permit'
import { analyze } from './engine/pipeline'
import type { AnalysisResult, Hex, ProposedTransaction, Severity, Verdict } from './engine/types'
import './App.css'

const STEP_MS = 650
const VERDICT_ICON: Record<Verdict, string> = { ALLOW: '✓', WARN: '!', BLOCK: '✕' }
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CUSTOM = 'custom'
const PERMIT = 'permit'
const SIGN_METHOD = 'eth_signTypedData_v4'

const SAMPLE_TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SAMPLE_ADDR = '0x1234567890abcdef1234567890abcdef12345678'
const SAMPLES = [
  { label: 'Unlimited approve', data: encodeCall(SELECTORS.approve, encodeAddress(SAMPLE_ADDR), encodeUint(MAX_UINT256)) },
  { label: 'Approve 50 USDC', data: encodeCall(SELECTORS.approve, encodeAddress(SAMPLE_ADDR), encodeUint(50_000_000n)) },
  { label: 'Transfer 10 USDC', data: encodeCall(SELECTORS.transfer, encodeAddress(SAMPLE_ADDR), encodeUint(10_000_000n)) },
]

const permitJson = (value: string) =>
  JSON.stringify(buildPermitTypedData({ token: SAMPLE_TOKEN as Hex, spender: SAMPLE_ADDR as Hex, value }), null, 2)
const UNSUPPORTED_SAMPLE = JSON.stringify(
  {
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle',
    domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
    message: {
      details: { token: SAMPLE_TOKEN, amount: '1461501637330902918203684832716283019655932542975', expiration: '1893456000', nonce: '0' },
      spender: SAMPLE_ADDR,
      sigDeadline: '1893456000',
    },
  },
  null,
  2,
)
const PERMIT_SAMPLES = [
  { label: 'Unlimited permit', json: permitJson(MAX_UINT256.toString()) },
  { label: 'Permit 50 USDC', json: permitJson('50000000') },
  { label: 'Unsupported type', json: UNSUPPORTED_SAMPLE },
]

const toJson = (tx: ProposedTransaction) =>
  JSON.stringify(tx, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)

export default function App() {
  const [mode, setMode] = useState(SIMULATED_CASES[0].id)
  const [runId, setRunId] = useState(0)
  const [stage, setStage] = useState(0)
  const [toInput, setToInput] = useState('')
  const [dataInput, setDataInput] = useState('')
  const [errors, setErrors] = useState<{ to?: string; data?: string }>({})
  const [customTx, setCustomTx] = useState<ProposedTransaction | null>(null)
  const [permitInput, setPermitInput] = useState('')
  const [permitError, setPermitError] = useState<string | null>(null)
  const [permit, setPermit] = useState<Extract<PermitParseResult, { ok: true }> | null>(null)

  const active = SIMULATED_CASES.find((c) => c.id === mode)
  const tx = mode === CUSTOM ? customTx : mode === PERMIT ? (permit?.tx ?? null) : active!.tx
  const result = mode === PERMIT ? (permit ? analyze(permit.tx, permit.decoded) : null) : tx ? analyze(tx) : null
  const verdictByCase = useMemo(
    () => Object.fromEntries(SIMULATED_CASES.map((c) => [c.id, analyze(c.tx).decision.verdict])),
    [],
  )

  const restart = () => {
    setRunId((r) => r + 1)
    setStage(0)
  }
  const select = (id: string) => {
    setMode(id)
    restart()
  }
  const submitCustom = () => {
    const parsed = parseCustomInput(toInput, dataInput)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setCustomTx(parsed.tx)
    restart()
  }
  const submitPermit = () => {
    const parsed = parsePermitInput(permitInput)
    if (!parsed.ok) {
      setPermitError(parsed.error)
      return
    }
    setPermitError(null)
    setPermit(parsed)
    restart()
  }
  const loadSample = (data: string) => {
    setToInput(SAMPLE_TOKEN)
    setDataInput(data)
    setErrors({})
  }

  useEffect(() => {
    const timers = [1, 2, 3].map((s) => setTimeout(() => setStage(s), s * STEP_MS))
    return () => timers.forEach(clearTimeout)
  }, [mode, runId])

  const customVerdict = customTx ? analyze(customTx).decision.verdict : null
  const permitVerdict = permit ? analyze(permit.tx, permit.decoded).decision.verdict : null

  const isPreset = mode !== CUSTOM && mode !== PERMIT
  const resultBlock =
    tx && result ? (
      <>
        <ResultCard tx={tx} result={result} stage={stage} />
        <TechnicalDetails tx={tx} result={result} stage={stage} onReplay={restart} />
      </>
    ) : (
      <section className="card empty">
        {mode === PERMIT ? (
          <>Paste EIP-712 permit typed data, then press Analyze.</>
        ) : (
          <>Enter a <code>to</code> address and <code>data</code>, then press Analyze.</>
        )}
      </section>
    )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <ShieldIcon />
          <div>
            <h1>AgentShield</h1>
            <p className="tagline">Understand what you’re approving before you sign.</p>
            <p className="subtag">Plain-language checks for AI-proposed Ethereum transactions</p>
          </div>
        </div>
        <div className="topbar-badges">
          <span className="badge badge-sim">Simulated demo</span>
          <span className="badge badge-muted">No wallet connected · nothing is signed or sent</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2 className="section-label">Simulated cases</h2>
          {SIMULATED_CASES.map((c, i) => {
            const v = verdictByCase[c.id]
            return (
              <button key={c.id} className={`case-card ${c.id === mode ? 'active' : ''}`} onClick={() => select(c.id)}>
                <span className="case-num">{i + 1}</span>
                <span className="case-text">
                  <span className="case-title">{c.title}</span>
                  <span className="case-sub">{c.subtitle}</span>
                </span>
                <span className={`pill pill-${v.toLowerCase()}`}>{v}</span>
              </button>
            )
          })}
          <h2 className="section-label spaced">Your own data</h2>
          <button className={`case-card ${mode === CUSTOM ? 'active' : ''}`} onClick={() => select(CUSTOM)}>
            <span className="case-num">+</span>
            <span className="case-text">
              <span className="case-title">Paste a transaction</span>
              <span className="case-sub">to · data</span>
            </span>
            {customVerdict && <span className={`pill pill-${customVerdict.toLowerCase()}`}>{customVerdict}</span>}
          </button>
          <button className={`case-card ${mode === PERMIT ? 'active' : ''}`} onClick={() => select(PERMIT)}>
            <span className="case-num">+</span>
            <span className="case-text">
              <span className="case-title">Paste a permit</span>
              <span className="case-sub">EIP-712 typed data</span>
            </span>
            {permitVerdict && <span className={`pill pill-${permitVerdict.toLowerCase()}`}>{permitVerdict}</span>}
          </button>
          <div className="sidebar-note">
            All transactions, addresses, contacts, and limits are simulated and hard-coded. Pasted data is only decoded locally. No RPC, API, wallet, or hardware is used.
          </div>
        </aside>

        <main className="main">
          {isPreset && resultBlock}
          {mode === CUSTOM ? (
            <section className="card">
              <div className="card-head">
                <h2>Paste transaction data</h2>
                <span className="badge badge-sim small">Simulated · read-only</span>
              </div>
              <form
                className="custom-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitCustom()
                }}
              >
                <label>
                  <span className="field-label">to <span className="muted">(contract address)</span></span>
                  <input
                    className={errors.to ? 'invalid' : ''}
                    value={toInput}
                    onChange={(e) => setToInput(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {errors.to && <span className="field-error">{errors.to}</span>}
                </label>
                <label>
                  <span className="field-label">data <span className="muted">(calldata hex)</span></span>
                  <textarea
                    className={errors.data ? 'invalid' : ''}
                    value={dataInput}
                    onChange={(e) => setDataInput(e.target.value)}
                    placeholder="0x095ea7b3…"
                    rows={4}
                    spellCheck={false}
                  />
                  {errors.data && <span className="field-error">{errors.data}</span>}
                </label>
                <div className="form-row">
                  <div className="samples">
                    <span className="muted">Fill sample:</span>
                    {SAMPLES.map((s) => (
                      <button type="button" key={s.label} className="chip" onClick={() => loadSample(s.data)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="primary">Analyze</button>
                </div>
                <p className="form-note">
                  Decodes ERC-20 <code>approve</code>, <code>transfer</code>, and <code>balanceOf</code>. Analyzed as if proposed from the simulated demo wallet on chain 1 with 0 ETH. {DEMO_DISCLAIMER}
                </p>
              </form>
            </section>
          ) : mode === PERMIT ? (
            <section className="card">
              <div className="card-head">
                <h2>Paste permit typed data</h2>
                <span className="badge badge-sim small">Simulated · read-only</span>
              </div>
              <form
                className="custom-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitPermit()
                }}
              >
                <label>
                  <span className="field-label">typed data <span className="muted">(EIP-712 JSON)</span></span>
                  <textarea
                    className={permitError ? 'invalid' : ''}
                    value={permitInput}
                    onChange={(e) => setPermitInput(e.target.value)}
                    placeholder='{ "types": …, "primaryType": "Permit", "domain": …, "message": … }'
                    rows={10}
                    spellCheck={false}
                  />
                  {permitError && <span className="field-error">{permitError}</span>}
                </label>
                <div className="form-row">
                  <div className="samples">
                    <span className="muted">Fill sample:</span>
                    {PERMIT_SAMPLES.map((s) => (
                      <button
                        type="button"
                        key={s.label}
                        className="chip"
                        onClick={() => {
                          setPermitInput(s.json)
                          setPermitError(null)
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="primary">Analyze</button>
                </div>
                <p className="form-note">
                  Decodes only standard EIP-2612 <code>Permit</code> fields: owner, spender, value, nonce, and deadline. Signatures are not verified. {DEMO_DISCLAIMER}
                </p>
              </form>
            </section>
          ) : (
            <section className="card">
              <div className="card-head">
                <h2>Agent proposal</h2>
                <span className="badge badge-sim small">Simulated</span>
              </div>
              <div className="chat">
                <div className="bubble user"><span className="who">User</span>{active!.userRequest}</div>
                <div className="bubble agent"><span className="who">AI agent</span>{active!.agentRationale}</div>
              </div>
              <details className="raw">
                <summary>Raw proposed transaction</summary>
                <pre>{toJson(active!.tx)}</pre>
              </details>
            </section>
          )}

          {!isPreset && resultBlock}
        </main>
      </div>
      <footer className="footer">
        {DEMO_DISCLAIMER} It can’t detect every scam or guarantee protection from losses.
      </footer>
    </div>
  )
}

const STAGE_TEXT = ['Decoding the data…', 'Reviewing risks…', 'Running the final safety check…']

function ResultCard({ tx, result, stage }: { tx: ProposedTransaction; result: AnalysisResult; stage: number }) {
  const { plain, decision } = result
  const done = stage >= 3
  const v = decision.verdict.toLowerCase()
  const signature = tx.method === SIGN_METHOD
  return (
    <section className={`card result ${done ? `edge-${v}` : ''}`} aria-live="polite">
      {done ? (
        <div className={`verdict verdict-${v}`}>
          <span className="verdict-icon" aria-hidden="true">{VERDICT_ICON[decision.verdict]}</span>
          <div className="verdict-text">
            <h2 className="verdict-label">
              {plain.verdictLabel} <span className="verdict-code">{decision.verdict}</span>
            </h2>
            <p className="verdict-headline">{decision.headline}</p>
          </div>
        </div>
      ) : (
        <div className="verdict verdict-pending">
          <span className="spinner" aria-hidden="true" />
          <div className="verdict-text">
            <h2 className="verdict-label">Analyzing…</h2>
            <p className="verdict-headline">Step {stage + 1} of 3: {STAGE_TEXT[stage]}</p>
          </div>
        </div>
      )}
      {done && (
        <>
          <div className="result-sections">
            <section className="result-section">
              <h3>{signature ? 'What this signature allows' : 'What this transaction allows'}</h3>
              <p className="lead">{plain.asksFor.title}</p>
              <p>{plain.asksFor.text}</p>
            </section>
            <section className="result-section">
              <h3>{plain.recipient.role}</h3>
              <p className="lead">{capitalize(plain.recipient.label)}</p>
              {plain.recipient.address && <code className="full-addr">{plain.recipient.address}</code>}
              <p className="secondary">{plain.recipient.note}</p>
            </section>
            <section className="result-section">
              <h3>{plain.reasonsTitle}</h3>
              <ul className="plain-list">
                {plain.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {plain.alsoNote.length > 0 && (
                <>
                  <p className="also-label">Also worth knowing</p>
                  <ul className="plain-list secondary">
                    {plain.alsoNote.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </>
              )}
            </section>
            <section className="result-section">
              <h3>What to do</h3>
              <div className={`next-step next-${v}`}>
                <span className="next-icon" aria-hidden="true">{VERDICT_ICON[decision.verdict]}</span>
                <p>{plain.nextStep}</p>
              </div>
            </section>
          </div>
          <details className="disclosure glossary">
            <summary>New to this? Key terms</summary>
            <dl>
              <dt>Signing</dt><dd>Approving a transaction or message with your wallet. Once a signed transaction is confirmed, it can’t be undone.</dd>
              <dt>Transfer</dt><dd>Sends tokens from your wallet to someone else right away.</dd>
              <dt>Approval</dt><dd>Gives another address (the “spender”) permission to move your tokens later, without asking you again, until you revoke it.</dd>
              <dt>Unlimited approval</dt><dd>An approval with no cap. The spender could move your entire balance of that token, including tokens you receive later.</dd>
              <dt>Permit (EIP-2612)</dt><dd>A signed message that grants an approval without sending a transaction. No tokens move when you sign, but the spender can use it to take them later.</dd>
              <dt>Unrecognized</dt><dd>Not in this demo’s saved contacts or known-contract lists. It isn’t proof of anything bad; it means AgentShield can’t vouch for it.</dd>
            </dl>
          </details>
          <p className="limits">
            {signature ? 'Token contract (verifyingContract)' : 'Contract called'}:{' '}
            <code>{tx.to === ZERO_ADDRESS && signature ? 'not provided' : tx.to}</code>. These are fixed demo rules, not a scam detector, and no verdict guarantees a transaction is safe.
          </p>
        </>
      )}
    </section>
  )
}

function TechnicalDetails({ tx, result, stage, onReplay }: { tx: ProposedTransaction; result: AnalysisResult; stage: number; onReplay: () => void }) {
  const done = stage >= 3
  const { decoded, risks, decision } = result
  const sortedRisks = [...risks].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const triggered = decision.rules.filter((r) => r.triggered).length
  const signature = tx.method === SIGN_METHOD
  return (
    <section className="card details-card">
      <h2 className="card-title">Technical details</h2>
      <details className="disclosure">
        <summary>
          Decoded {signature ? 'typed data' : 'calldata'}
          <span className="summary-meta">{decoded.functionSignature ? 'decoded' : 'not decoded'}</span>
        </summary>
        <div className="disclosure-body">
          <p className="summary">{decoded.summary}</p>
          <dl className="fields">
            <dt>Contract</dt><dd>{decoded.contractLabel} <code>{tx.to}</code></dd>
            <dt>{signature ? 'Typed data' : 'Function'}</dt><dd><code>{decoded.functionSignature ?? 'unknown'}</code></dd>
            {decoded.args.map((a) => (
              <FieldRow key={a.name} name={a.name} value={a.display} />
            ))}
          </dl>
          <pre className="raw-pre">{signature ? 'eth_signTypedData_v4 (simulated)' : tx.data}</pre>
        </div>
      </details>
      <details className="disclosure">
        <summary>
          Risk factors<span className="summary-meta">{risks.length} found</span>
        </summary>
        <ul className="risks disclosure-body">
          {sortedRisks.map((r) => (
            <li key={r.id} className={`risk sev-${r.severity}`}>
              <span className="sev">{r.severity}</span>
              <div>
                <div className="risk-title">{r.title}</div>
                <div className="risk-detail">{r.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <details className="disclosure">
        <summary>
          All rules<span className="summary-meta">{done ? `${triggered} of ${decision.rules.length} triggered` : 'running…'}</span>
        </summary>
        <table className="rules disclosure-body">
          <tbody>
            {decision.rules.map((r) => (
              <tr key={r.id} className={r.triggered ? 'triggered' : ''}>
                <td className="rule-id">{r.id}</td>
                <td>
                  <div className="rule-name">{r.name}</div>
                  {r.triggered && <div className="rule-reason">{r.explanation}</div>}
                </td>
                <td className="rule-out">
                  {r.triggered ? <span className={`pill pill-${r.outcome.toLowerCase()}`}>{r.outcome}</span> : <span className="muted">not triggered</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details className="disclosure">
        <summary>
          Activity trace<span className="summary-meta">Decode → Risk review → Final safety check</span>
        </summary>
        <div className="disclosure-body">
          <Trace result={result} stage={stage} onReplay={onReplay} />
        </div>
      </details>
    </section>
  )
}

function Trace({ result, stage, onReplay }: { result: AnalysisResult; stage: number; onReplay: () => void }) {
  const done = stage >= 3
  const { decision, trace } = result
  return (
    <>
      <div className="trace-head">
        <span className="muted">Simulated steps, in order</span>
        <button className="replay" onClick={onReplay} disabled={!done}>↻ Replay</button>
      </div>
      <ol className="trace">
        {trace.map((t, i) => {
          const status = stage > i ? 'done' : stage === i ? 'running' : 'pending'
          return (
            <li key={t.id} className={`trace-step ${status}`}>
              <span className="dot" />
              <div className="trace-body">
                <div className="trace-title">
                  {t.label}
                  <span className="trace-status">{status === 'done' ? `+${(i + 1) * STEP_MS} ms` : status}</span>
                </div>
                {status === 'done' && (
                  <>
                    <div className="trace-detail">{t.detail}</div>
                    <ul className="trace-items">
                      {t.items.map((it) => <li key={it}>{it}</li>)}
                    </ul>
                  </>
                )}
              </div>
            </li>
          )
        })}
        <li className={`trace-step final ${done ? 'done' : 'pending'}`}>
          <span className="dot" />
          <div className="trace-body">
            <div className="trace-title">
              Outcome
              {done && <span className={`pill pill-${decision.verdict.toLowerCase()}`}>{decision.verdict}</span>}
            </div>
            {done && <div className="trace-detail">Verdict only. No signature requested, nothing broadcast.</div>}
          </div>
        </li>
      </ol>
    </>
  )
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function FieldRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  )
}

function ShieldIcon() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 4 7v8c0 7.2 5.1 13.4 12 15 6.9-1.6 12-7.8 12-15V7L16 2Z" fill="url(#g)" />
      <path d="m11 16 3.5 3.5L21.5 12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d8bff" />
          <stop offset="1" stopColor="#3ccf91" />
        </linearGradient>
      </defs>
    </svg>
  )
}
