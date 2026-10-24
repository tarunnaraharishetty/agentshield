# AgentShield (simulated demo)

**Understand what you're approving before you sign.**

A safety firewall for AI-proposed Ethereum transactions. Three built-in **simulated** cases are decoded into plain language, reviewed for risk factors, and passed through deterministic rules that return ALLOW, WARN, or BLOCK.

**Paste a transaction** lets you enter your own `to` and `data`. It decodes ERC-20 `approve`, `transfer`, and `balanceOf` locally, flags unlimited approvals, and labels unknown addresses "unrecognized". A recipient or spender that matches a saved address only in its shortened form (same `0x` + first 4 and last 4 hex characters, different full address) is blocked as a lookalike.

Nothing connects to a wallet, RPC, or API. Nothing is signed or broadcast.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # engine unit tests
```

- `src/engine/` — ABI decoding, risk factors, policy rules, pipeline (pure, deterministic)
- `src/engine/custom.ts` — validates pasted `to`/`data` into a simulated transaction
- `src/engine/explain.ts` — beginner summary: what it asks for, who receives it, specific reasons, what to do
- `src/engine/context.ts` — simulated token registry, address book, trusted spenders, limits
- `src/App.tsx` — UI and activity trace

AgentShield applies a fixed set of rules. It can't detect every scam or guarantee protection from losses.
