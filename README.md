# AgentShield (simulated demo)

A safety firewall for AI-proposed Ethereum transactions. Three built-in **simulated** cases are decoded into plain language, reviewed for risk factors, and passed through deterministic rules that return ALLOW, WARN, or BLOCK.

**Paste a transaction** lets you enter your own `to` and `data`. It decodes ERC-20 `approve`, `transfer`, and `balanceOf` locally, flags unlimited approvals, and labels unknown addresses "unrecognized".

Nothing connects to a wallet, RPC, or API. Nothing is signed or broadcast.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # engine unit tests
```

- `src/engine/` — ABI decoding, risk factors, policy rules, pipeline (pure, deterministic)
- `src/engine/custom.ts` — validates pasted `to`/`data` into a simulated transaction
- `src/engine/context.ts` — simulated token registry, address book, trusted spenders, limits
- `src/App.tsx` — UI and activity trace
