import { useEffect, useMemo, useRef, useState } from 'react'
import { encodeAddress, encodeCall, encodeUint, formatUnits, MAX_UINT256, SELECTORS, shortAddr } from './engine/abi'
import { SIMULATED_CASES } from './engine/cases'
import { SIMULATED_CHAIN_ID } from './engine/context'
import { parseCustomInput } from './engine/custom'
import { DEMO_DISCLAIMER } from './engine/explain'
import { buildPermitTypedData, parsePermitInput, ZERO_ADDRESS } from './engine/permit'
import type { PermitParseResult } from './engine/permit'
import { analyze } from './engine/pipeline'
import type { AnalysisResult, DecodedTransaction, Hex, ProposedTransaction, RuleResult, Severity, Verdict } from './engine/types'
import ethLogo from './assets/eth-logo.png'
import usdcLogo from './assets/usdc-logo.png'
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
  { label: 'Unlimited permit', json: permitJson(MAX_UINT256.toString()), usdc: true },
  { label: 'Permit 50 USDC', json: permitJson('50000000'), usdc: true },
  { label: 'Unsupported type', json: UNSUPPORTED_SAMPLE, usdc: false },
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
      setCustomTx(null)
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
      setPermit(null)
      return
    }
    setPermitError(null)
    setPermit(parsed)
    restart()
  }

  useEffect(() => {
    const timers = [1, 2, 3].map((s) => setTimeout(() => setStage(s), s * STEP_MS))
    return () => timers.forEach(clearTimeout)
  }, [mode, runId])

  const customVerdict = customTx ? analyze(customTx).decision.verdict : null
  const permitVerdict = permit ? analyze(permit.tx, permit.decoded).decision.verdict : null
  const isPreset = mode !== CUSTOM && mode !== PERMIT

  const pasteForm =
    mode === CUSTOM ? (
      <form
        className="paste-form"
        onSubmit={(e) => {
          e.preventDefault()
          submitCustom()
        }}
      >
        <h2 className="paste-title">Paste transaction data</h2>
        <label>
          <span className="field-label">to <span className="hint">(contract address)</span></span>
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
          <span className="field-label">data <span className="hint">(calldata hex)</span></span>
          <textarea
            className={errors.data ? 'invalid' : ''}
            value={dataInput}
            onChange={(e) => setDataInput(e.target.value)}
            placeholder="0x095ea7b3…"
            rows={3}
            spellCheck={false}
          />
          {errors.data && <span className="field-error">{errors.data}</span>}
        </label>
        <div className="samples">
          <span className="hint">Fill sample:</span>
          {SAMPLES.map((s) => (
            <button
              type="button"
              key={s.label}
              className="chip"
              onClick={() => {
                setToInput(SAMPLE_TOKEN)
                setDataInput(s.data)
                setErrors({})
              }}
            >
              <img className="chip-logo" src={usdcLogo} alt="" aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary">Analyze</button>
          <p className="hint">
            Decodes ERC-20 <code>approve</code>, <code>transfer</code>, and <code>balanceOf</code>. Analyzed as if proposed from the simulated demo wallet on chain 1 with 0 ETH.
          </p>
        </div>
      </form>
    ) : mode === PERMIT ? (
      <form
        className="paste-form"
        onSubmit={(e) => {
          e.preventDefault()
          submitPermit()
        }}
      >
        <h2 className="paste-title">Paste permit typed data</h2>
        <label>
          <span className="field-label">typed data <span className="hint">(EIP-712 JSON)</span></span>
          <textarea
            className={permitError ? 'invalid' : ''}
            value={permitInput}
            onChange={(e) => setPermitInput(e.target.value)}
            placeholder='{ "types": …, "primaryType": "Permit", "domain": …, "message": … }'
            rows={6}
            spellCheck={false}
          />
          {permitError && <span className="field-error">{permitError}</span>}
        </label>
        <div className="samples">
          <span className="hint">Fill sample:</span>
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
              {s.usdc && <img className="chip-logo" src={usdcLogo} alt="" aria-hidden="true" />}
              {s.label}
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary">Analyze</button>
          <p className="hint">
            Decodes only standard EIP-2612 <code>Permit</code> fields: owner, spender, value, nonce, and deadline. Signatures are not verified.
          </p>
        </div>
      </form>
    ) : null

  const ownRows = [
    { id: CUSTOM, title: 'Paste a transaction', verdict: customVerdict },
    { id: PERMIT, title: 'Paste a permit', verdict: permitVerdict },
  ]
  const pickItems: PickItem[] = [
    ...SIMULATED_CASES.map((c) => ({ id: c.id, title: c.title, sub: c.subtitle, verdict: verdictByCase[c.id] as Verdict })),
    ...ownRows.map((r) => ({ id: r.id, title: r.title, sub: r.id === CUSTOM ? 'to · data' : 'EIP-712 typed data', verdict: r.verdict })),
  ]
  const signature = mode === PERMIT || tx?.method === SIGN_METHOD
  const chainId = tx?.chainId ?? SIMULATED_CHAIN_ID

  const reviews: ReviewItem[] = [
    ...SIMULATED_CASES.map((c) => ({ id: c.id, title: c.title, result: analyze(c.tx) })),
    ...(customTx ? [{ id: CUSTOM, title: 'Pasted transaction', result: analyze(customTx) }] : []),
    ...(permit ? [{ id: PERMIT, title: 'Pasted permit', result: analyze(permit.tx, permit.decoded) }] : []),
  ]

  return (
    <div className="app">
      <header className="dash-top">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>Overview</span> <span aria-hidden="true">/</span> <strong>{isPreset ? active!.title : mode === PERMIT ? 'Paste a permit' : 'Paste a transaction'}</strong>
        </nav>
        <span className="dash-badge">Simulated · no wallet connected</span>
      </header>
      <div className="shell">
        <aside className="side">
          <div className="brand">
            <ShieldIcon />
            <div>
              <h1>AgentShield</h1>
              <p className="tagline">Understand what you’re approving before you sign.</p>
            </div>
          </div>

          <SamplePicker items={pickItems} value={mode} onSelect={select} />

          <h2 className="side-label">Simulated cases</h2>
          <div className="case-list">
            {SIMULATED_CASES.map((c) => (
              <button key={c.id} className={`case-card ${c.id === mode ? 'active' : ''}`} onClick={() => select(c.id)} aria-pressed={c.id === mode}>
                <span className={`dot dot-${verdictByCase[c.id].toLowerCase()}`} aria-hidden="true" />
                <span className="case-text">
                  <span className="case-title">{c.title}</span>
                  <span className="case-sub">{c.subtitle}</span>
                </span>
                <VerdictTag verdict={verdictByCase[c.id]} />
              </button>
            ))}
          </div>

          <h2 className="side-label">Your own data</h2>
          <div className="case-list">
            {ownRows.map((r) => (
              <button key={r.id} className={`case-card own ${mode === r.id ? 'active' : ''}`} onClick={() => select(r.id)} aria-pressed={mode === r.id}>
                <span className="case-text">
                  <span className="case-title">{r.title} <span aria-hidden="true">→</span></span>
                </span>
                {r.verdict && <VerdictTag verdict={r.verdict} />}
              </button>
            ))}
          </div>
        </aside>

        <div className="main-col">
        <DashboardCards reviews={reviews} />
        <main className="review result" aria-live="polite">
          <header className="review-head">
            <h2>{signature ? 'Review signature' : 'Review transaction'}</h2>
            <span className="network">
              {chainId === 1 && <img className="network-logo" src={ethLogo} alt="" aria-hidden="true" />}
              {chainId === 1 ? 'Ethereum Mainnet' : `Chain ${chainId}`} · simulated
            </span>
          </header>

          <div className="review-body">
            {pasteForm}

            {tx && result ? (
              <ReviewContent tx={tx} result={result} stage={stage} onReplay={restart} proposal={isPreset ? active : undefined} />
            ) : (
              <p className="empty">{mode === PERMIT ? 'Paste EIP-712 permit typed data, then press Analyze.' : 'Enter a to address and data, then press Analyze.'}</p>
            )}

            <p className="notice">
              <strong>Simulated only.</strong> {DEMO_DISCLAIMER} It can’t detect every scam or guarantee protection from losses. All transactions, addresses, contacts, and limits are simulated and hard-coded; no RPC, API, wallet, or hardware is used.
            </p>
          </div>
        </main>
        <RecentReviews reviews={reviews} active={mode} onSelect={select} />
        </div>
      </div>
    </div>
  )
}

const STAGE_TEXT = ['Decoding the data…', 'Reviewing risks…', 'Running the final safety check…']
const VERDICT_SHORT: Record<Verdict, string> = { ALLOW: 'Allowed', WARN: 'Review', BLOCK: 'Blocked' }

function VerdictTag({ verdict }: { verdict: Verdict }) {
  return <span className={`vtag vtag-${verdict.toLowerCase()}`}>{VERDICT_SHORT[verdict]}</span>
}

interface Row {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}

function TokenBadge({ symbol }: { symbol?: string }) {
  if (symbol === 'ETH') {
    return (
      <span className="token-badge eth" aria-hidden="true">
        <img src={ethLogo} alt="" />
      </span>
    )
  }
  if (symbol === 'USDC') {
    return (
      <span className="token-badge logo" aria-hidden="true">
        <img src={usdcLogo} alt="" />
      </span>
    )
  }
  return <span className={`token-badge ${symbol ? '' : 'unknown'}`} aria-hidden="true">{symbol ? symbol.slice(0, 4) : '?'}</span>
}

// Deterministic 5×5 mirrored pattern derived from the address; decorative only.
function Identicon({ address }: { address: string }) {
  const hex = address.toLowerCase().replace(/^0x/, '')
  const hue = parseInt(hex.slice(0, 6), 16) % 360
  const cells: [number, number][] = []
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if (parseInt(hex[(y * 3 + x) % hex.length], 16) % 2 === 0) {
        cells.push([x, y])
        if (x < 2) cells.push([4 - x, y])
      }
    }
  return (
    <svg className="identicon" viewBox="0 0 5 5" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="5" height="5" fill={`hsl(${hue} 40% 94%)`} />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={`hsl(${hue} 45% 38%)`} />)}
    </svg>
  )
}

function buildRows(tx: ProposedTransaction, d: DecodedTransaction, plain: AnalysisResult['plain']): Row[] {
  const tokenName = d.token ? d.token.name : 'Unrecognized token'
  const tokenSub = d.token
    ? d.token.symbol === 'USDC'
      ? 'USDC · Designed to track $1 USD; market price can vary. No live price shown.'
      : d.token.symbol
    : `Contract ${shortAddr(tx.to)}`
  const amount = d.args.find((a) => a.name === 'amount' || a.name === 'value')?.display
  const asset: Row = { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Asset', value: tokenName, sub: tokenSub }
  const who: Row = {
    icon: plain.recipient.address ? <Identicon address={plain.recipient.address} /> : <span className="icon-box" aria-hidden="true">—</span>,
    label: d.kind === 'approve' || d.kind === 'permit' || d.kind === 'unsupported-typed-data' ? 'Spender' : 'Recipient',
    value: capitalize(plain.recipient.label),
    sub: (
      <>
        {plain.recipient.address && <AddressField key={plain.recipient.address} address={plain.recipient.address} />}
        <span>{plain.recipient.note}</span>
      </>
    ),
  }
  const perm = (value: string, sub: string): Row => ({ icon: <KeyIcon />, label: 'Permission granted', value, sub })
  const unknown = "Can't be determined"

  switch (d.kind) {
    case 'read':
      return [asset, { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Amount', value: 'None', sub: 'Read-only check. Nothing moves.' }, who, perm('None', 'Read-only. Nothing is approved or sent.')]
    case 'transfer':
      return [asset, { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Amount', value: rollable(amount ?? unknown), sub: 'One-time transfer' }, who, perm('None', 'One-time transfer. Nothing can be taken later.')]
    case 'native-transfer':
      return [
        { icon: <TokenBadge symbol="ETH" />, label: 'Asset', value: 'Ether', sub: 'ETH' },
        { icon: <TokenBadge symbol="ETH" />, label: 'Amount', value: rollable(d.amount !== undefined ? `${formatUnits(d.amount, 18)} ETH` : unknown), sub: 'One-time transfer' },
        who,
        perm('None', 'One-time transfer. Nothing can be taken later.'),
      ]
    case 'approve':
    case 'permit': {
      const how = d.kind === 'permit' ? 'Granted by signature; no tokens move when you sign.' : 'No tokens move when you approve.'
      return [
        asset,
        d.isUnlimited
          ? { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Amount', value: 'Unlimited — no spending cap' }
          : { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Amount', value: rollable(amount ?? unknown), sub: 'Spending cap' },
        who,
        perm(
          d.isUnlimited ? `Unlimited ${d.token?.symbol ?? 'token'} spending` : `Spend up to ${amount}`,
          `The spender can move these tokens later without asking again, until revoked. ${how}`,
        ),
      ]
    }
    case 'unsupported-typed-data':
      return [
        { icon: <TokenBadge />, label: 'Asset', value: unknown, sub: d.contractLabel },
        { icon: <TokenBadge />, label: 'Amount', value: unknown },
        who,
        perm(unknown, "AgentShield couldn't decode what this signature would allow."),
      ]
    default:
      return [
        { icon: <TokenBadge symbol={d.token?.symbol} />, label: 'Asset', value: d.token ? tokenName : unknown, sub: `Contract ${shortAddr(tx.to)}` },
        { icon: <TokenBadge />, label: 'Amount', value: unknown },
        who,
        perm(unknown, "AgentShield couldn't decode what this call would do."),
      ]
  }
}

function KeyIcon() {
  return (
    <span className="icon-box key" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="15" r="4" />
        <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
      </svg>
    </span>
  )
}

function AddressField({ address }: { address: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    setTimeout(() => setStatus('idle'), 1500)
  }
  return (
    <span className="addr-field">
      <code>{address}</code>
      <button type="button" className={`copy-btn ${status}`} onClick={copy} aria-label={`Copy address ${address}`}>
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Failed' : 'Copy'}
      </button>
    </span>
  )
}

function ReviewContent({
  tx,
  result,
  stage,
  onReplay,
  proposal,
}: {
  tx: ProposedTransaction
  result: AnalysisResult
  stage: number
  onReplay: () => void
  proposal?: { userRequest: string; agentRationale: string }
}) {
  const { plain, decision, decoded } = result
  const done = stage >= 3
  const v = decision.verdict.toLowerCase()
  const signature = tx.method === SIGN_METHOD

  if (!done) {
    return (
      <div className="verdict verdict-pending">
        <span className="spinner" aria-hidden="true" />
        <div className="verdict-text">
          <h3 className="verdict-label">Analyzing…</h3>
          <p className="verdict-headline">Step {stage + 1} of 3: {STAGE_TEXT[stage]}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`verdict verdict-${v}`}>
        <span className="verdict-icon" aria-hidden="true">{VERDICT_ICON[decision.verdict]}</span>
        <div className="verdict-text">
          <h3 className="verdict-label">
            {plain.verdictLabel} <span className="verdict-code">{decision.verdict}</span>
          </h3>
          <p className="verdict-headline">
            {decision.headline} {plain.asksFor.title}.
          </p>
        </div>
      </div>

      <RiskMeter rules={decision.rules} />

      <dl className="rows">
        {buildRows(tx, decoded, plain).map((r) => (
          <div className="row" key={r.label}>
            <span className="row-icon">{r.icon}</span>
            <div className="row-main">
              <dt>{r.label}</dt>
              <dd>
                <span className="row-value">{r.value}</span>
                {r.sub && <span className="row-sub">{r.sub}</span>}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <section className="explain">
        <h3>{plain.reasonsTitle}</h3>
        <ul>
          {plain.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {plain.alsoNote.length > 0 && (
          <>
            <p className="also-label">Also worth knowing</p>
            <ul className="secondary">
              {plain.alsoNote.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </>
        )}
      </section>

      <section className="explain">
        <h3>What to do</h3>
        <p className={`next-step next-${v}`}>
          <span className="next-icon" aria-hidden="true">{VERDICT_ICON[decision.verdict]}</span>
          <span>{plain.nextStep}</span>
        </p>
      </section>

      <section className="explain">
        <h3>{signature ? 'What signing does' : 'What this does'}</h3>
        <p className="secondary">{plain.asksFor.text}</p>
      </section>

      {proposal && (
        <section className="proposal">
          <h3>Agent proposal</h3>
          <p className="turn"><span className="who">You</span><span>{proposal.userRequest}</span></p>
          <p className="turn"><span className="who">AI agent</span><span>{proposal.agentRationale}</span></p>
        </section>
      )}

      <details className="tech">
        <summary>Technical details</summary>
        <TechnicalDetails tx={tx} result={result} stage={stage} onReplay={onReplay} raw={proposal ? toJson(tx) : undefined} />
        <p className="limits">
          {signature ? 'Token contract (verifyingContract)' : 'Contract called'}:{' '}
          <code>{tx.to === ZERO_ADDRESS && signature ? 'not provided' : tx.to}</code>. These are fixed demo rules, not a scam detector, and no verdict guarantees a transaction is safe.
        </p>
      </details>
    </>
  )
}

interface ReviewItem {
  id: string
  title: string
  result: AnalysisResult
}

function DashboardCards({ reviews }: { reviews: ReviewItem[] }) {
  const count = (v: Verdict) => reviews.filter((r) => r.result.decision.verdict === v).length
  const fired = reviews.reduce((n, r) => n + r.result.decision.rules.filter((x) => x.triggered).length, 0)
  const cards: { label: string; value: number; tone: string; part: number }[] = [
    { label: 'Reviewed', value: reviews.length, tone: 'neutral', part: reviews.length },
    { label: 'Allowed', value: count('ALLOW'), tone: 'allow', part: count('ALLOW') },
    { label: 'Review before signing', value: count('WARN'), tone: 'warn', part: count('WARN') },
    { label: 'Blocked', value: count('BLOCK'), tone: 'block', part: count('BLOCK') },
  ]
  return (
    <section className="dash-cards" aria-label="Summary">
      {cards.map((c) => (
        <div key={c.label} className={`kpi kpi-${c.tone}`}>
          <p className="kpi-label">{c.label}</p>
          <p className="kpi-value"><RollingText key={`${c.label}-${c.value}`} text={String(c.value)} /></p>
          <span className="kpi-bar" aria-hidden="true">
            {reviews.map((_, i) => <span key={i} className={i < c.part ? 'on' : ''} />)}
          </span>
        </div>
      ))}
      <div className="kpi kpi-rate">
        <p className="kpi-label">Reference rate (fixed, not live)</p>
        <p className="kpi-value rate"><img src={ethLogo} alt="" aria-hidden="true" />1 ETH = 2,329.37 USD</p>
        <p className="kpi-note">≈ 2,329 USDC. Provided for context; not used in any verdict. {fired} rules fired across reviews.</p>
      </div>
    </section>
  )
}

const FILTERS: (Verdict | 'ALL')[] = ['ALL', 'ALLOW', 'WARN', 'BLOCK']

function RecentReviews({ reviews, active, onSelect }: { reviews: ReviewItem[]; active: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Verdict | 'ALL'>('ALL')
  const shown = reviews.filter((r) => filter === 'ALL' || r.result.decision.verdict === filter)
  const amountOf = (r: AnalysisResult) => {
    const d = r.decoded
    if (d.isUnlimited) return 'Unlimited — no spending cap'
    if (d.kind === 'read') return 'None'
    return d.args.find((a) => a.name === 'amount' || a.name === 'value')?.display ?? "Can't be determined"
  }
  return (
    <section className="recent" aria-label="Recent reviews">
      <div className="recent-head">
        <h2>Recent reviews</h2>
        <div className="filters" role="group" aria-label="Filter by verdict">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`filter ${filter === f ? 'active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'ALL' ? 'All' : VERDICT_SHORT[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="recent-scroll">
        <table className="recent-table">
          <thead>
            <tr><th>#</th><th>Review</th><th>Amount</th><th>To / spender</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id} className={r.id === active ? 'active' : ''}>
                <td className="num">{i + 1}</td>
                <td>
                  <button type="button" className="recent-link" onClick={() => onSelect(r.id)}>
                    <TokenBadge symbol={r.result.decoded.token?.symbol} />
                    <span>{r.title}</span>
                  </button>
                </td>
                <td>{amountOf(r.result)}</td>
                <td>
                  {capitalize(r.result.plain.recipient.label)}
                  {r.result.plain.recipient.address && <code> {shortAddr(r.result.plain.recipient.address)}</code>}
                </td>
                <td><VerdictTag verdict={r.result.decision.verdict} /></td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={5} className="hint">No reviews with this verdict.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const TABS = ['Decoded', 'Risks', 'Rules', 'Trace'] as const

function TechnicalDetails({ tx, result, stage, onReplay, raw }: { tx: ProposedTransaction; result: AnalysisResult; stage: number; onReplay: () => void; raw?: string }) {
  const [tab, setTab] = useState(0)
  const { decoded, risks, decision } = result
  const sortedRisks = [...risks].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const triggered = decision.rules.filter((r) => r.triggered).length
  const signature = tx.method === SIGN_METHOD
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    const next = (i + delta + TABS.length) % TABS.length
    setTab(next)
    ;(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus()
  }
  const meta = [decoded.functionSignature ? 'decoded' : 'not decoded', `${risks.length}`, `${triggered}/${decision.rules.length}`, '3 steps']
  return (
    <div className="tech-body">
      <div className="tabs" role="tablist" aria-label="Technical details" style={{ '--n': TABS.length, '--i': tab } as React.CSSProperties}>
        <span className="tab-glider" aria-hidden="true" />
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === i}
            aria-controls={`panel-${t}`}
            tabIndex={tab === i ? 0 : -1}
            className={`tab ${tab === i ? 'active' : ''}`}
            onClick={() => setTab(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t}
            <span className="tab-meta">{meta[i]}</span>
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${TABS[tab]}`} aria-labelledby={`tab-${TABS[tab]}`} key={tab}>
        {tab === 0 && (
          <>
            <p className="summary">{decoded.summary}</p>
            <dl className="fields">
              <dt>Contract</dt><dd>{decoded.contractLabel} <code>{tx.to}</code></dd>
              <dt>{signature ? 'Typed data' : 'Function'}</dt><dd><code>{decoded.functionSignature ?? 'unknown'}</code></dd>
              {decoded.args.map((a) => (
                <FieldRow key={a.name} name={a.name} value={a.display} />
              ))}
            </dl>
            <p className="raw-label">{signature ? 'Request' : 'Calldata'}</p>
            <pre className="raw-pre">{signature ? 'eth_signTypedData_v4 (simulated)' : tx.data}</pre>
            {raw && (
              <>
                <p className="raw-label">Raw proposed transaction</p>
                <pre className="raw-pre">{raw}</pre>
              </>
            )}
          </>
        )}
        {tab === 1 && (
          <ul className="risks">
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
        )}
        {tab === 2 && (
          <table className="rules">
            <tbody>
              {decision.rules.map((r) => (
                <tr key={r.id} className={r.triggered ? 'triggered' : ''}>
                  <td className="rule-id">{r.id}</td>
                  <td>
                    <div className="rule-name">{r.name}</div>
                    {r.triggered && <div className="rule-reason">{r.explanation}</div>}
                  </td>
                  <td className="rule-out">
                    {r.triggered ? <VerdictTag verdict={r.outcome} /> : <span className="hint">Not triggered</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 3 && <Trace result={result} stage={stage} onReplay={onReplay} />}
      </div>
      <details className="disclosure">
        <summary>New to this? Key terms</summary>
        <dl className="glossary disclosure-body">
          <dt>Signing</dt><dd>Approving a transaction or message with your wallet. Once a signed transaction is confirmed, it can’t be undone.</dd>
          <dt>Transfer</dt><dd>Sends tokens from your wallet to someone else right away.</dd>
          <dt>Approval</dt><dd>Gives another address (the “spender”) permission to move your tokens later, without asking you again, until you revoke it.</dd>
          <dt>Unlimited approval</dt><dd>An approval with no cap. The spender could move your entire balance of that token, including tokens you receive later.</dd>
          <dt>Permit (EIP-2612)</dt><dd>A signed message that grants an approval without sending a transaction. No tokens move when you sign, but the spender can use it to take them later.</dd>
          <dt>Unrecognized</dt><dd>Not in this demo’s saved contacts or known-contract lists. It isn’t proof of anything bad; it means AgentShield can’t vouch for it.</dd>
        </dl>
      </details>
    </div>
  )
}

const rollable = (t: string): React.ReactNode => (/\d/.test(t) ? <RollingText key={t} text={t} /> : t)

// Digits roll up from 0 to their value on mount; the plain text stays available to screen readers.
function RollingText({ text }: { text: string }) {
  return (
    <span className="roll">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {[...text].map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={i} className="roll-col">
              <span className="roll-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)`, animationDelay: `${i * 35}ms` }}>
                {'0123456789'.split('').map((d) => <span key={d}>{d}</span>)}
              </span>
            </span>
          ) : (
            <span key={i}>{ch}</span>
          ),
        )}
      </span>
    </span>
  )
}

function RiskMeter({ rules }: { rules: RuleResult[] }) {
  const lit = (r: RuleResult) => (!r.triggered ? 0 : r.outcome === 'BLOCK' ? 4 : r.outcome === 'WARN' ? 3 : 2)
  const count = (v: Verdict) => rules.filter((r) => r.triggered && r.outcome === v).length
  const triggered = rules.filter((r) => r.triggered).length
  return (
    <div className="meter" role="img" aria-label={`Safety rules: ${triggered} of ${rules.length} triggered. Block ${count('BLOCK')}, review ${count('WARN')}, allow ${count('ALLOW')}.`}>
      <div className="meter-head">
        <span className="meter-title">Safety rules</span>
        <span className="hint">{triggered} of {rules.length} triggered</span>
      </div>
      <div className="meter-bars" aria-hidden="true">
        {rules.map((r, i) => (
          <span key={r.id} className={`meter-bar ${r.triggered ? `on-${r.outcome.toLowerCase()}` : ''}`} title={`${r.id} ${r.name}: ${r.triggered ? VERDICT_SHORT[r.outcome] : 'not triggered'}`}>
            {[0, 1, 2, 3].map((k) => (
              <span key={k} className={`seg ${k < lit(r) ? 'lit' : ''}`} style={{ animationDelay: `${i * 30 + k * 40}ms` }} />
            ))}
          </span>
        ))}
      </div>
      <div className="meter-legend" aria-hidden="true">
        <span><i className="sw sw-block" />Blocked {count('BLOCK')}</span>
        <span><i className="sw sw-warn" />Review {count('WARN')}</span>
        <span><i className="sw sw-allow" />Allowed {count('ALLOW')}</span>
        <span><i className="sw" />Not triggered</span>
      </div>
    </div>
  )
}

interface PickItem {
  id: string
  title: string
  sub: string
  verdict: Verdict | null
}

function SamplePicker({ items, value, onSelect }: { items: PickItem[]; value: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])
  const current = items.find((i) => i.id === value) ?? items[0]
  const choose = (id: string) => {
    onSelect(id)
    setOpen(false)
  }
  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${current.verdict ? `dot-${current.verdict.toLowerCase()}` : 'dot-none'}`} aria-hidden="true" />
        <span className="picker-label">{current.title}</span>
        {current.verdict && <VerdictTag verdict={current.verdict} />}
        <span className={`chev ${open ? 'up' : ''}`} aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" aria-label="Choose a sample">
          {items.map((i) => (
            <li
              key={i.id}
              role="option"
              aria-selected={i.id === value}
              tabIndex={0}
              className={`picker-option ${i.id === value ? 'active' : ''}`}
              onClick={() => choose(i.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  choose(i.id)
                }
              }}
            >
              <span className={`dot ${i.verdict ? `dot-${i.verdict.toLowerCase()}` : 'dot-none'}`} aria-hidden="true" />
              <span className="case-text">
                <span className="case-title">{i.title}</span>
                <span className="case-sub">{i.sub}</span>
              </span>
              {i.verdict && <VerdictTag verdict={i.verdict} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Trace({ result, stage, onReplay }: { result: AnalysisResult; stage: number; onReplay: () => void }) {
  const done = stage >= 3
  const { decision, trace } = result
  return (
    <>
      <div className="trace-head">
        <span className="hint">Simulated steps, in order</span>
        <button className="replay" onClick={onReplay} disabled={!done}>↻ Replay</button>
      </div>
      <ol className="trace">
        {trace.map((t, i) => {
          const status = stage > i ? 'done' : stage === i ? 'running' : 'pending'
          return (
            <li key={t.id} className={`trace-step ${status}`}>
              <span className="tdot" />
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
          <span className="tdot" />
          <div className="trace-body">
            <div className="trace-title">
              Outcome
              {done && <VerdictTag verdict={decision.verdict} />}
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
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M16 3 6 7.2v7.3c0 6.4 4.3 11.9 10 13.5 5.7-1.6 10-7.1 10-13.5V7.2L16 3Z" fill="#fff" fillOpacity=".14" stroke="#fff" strokeWidth="1.6" />
        <path d="m11.5 16 3.2 3.2 6-6.4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
