import { encodeAddress, encodeCall, encodeUint, MAX_UINT256, SELECTORS } from './abi'
import { DEMO_WALLET, SIMULATED_CHAIN_ID } from './context'
import type { Hex, SimulatedCase } from './types'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ALICE = '0xa0f5034c04fd9ed0ec40b1a64ddb86076d885ab8'
const UNFAMILIAR_SPENDER = '0x9b1e0c4f7a2d38e65c0f1a7d4e2b96c3d8a5f017'
// Same shortened form as Alice (0xa0f5…5ab8) but a different full address.
export const ALICE_LOOKALIKE = ('0xa0f503' + '1'.repeat(30) + '5ab8') as Hex

export const SIMULATED_CASES: SimulatedCase[] = [
  {
    id: 'balance-check',
    title: 'Read-only balance check',
    subtitle: 'balanceOf · eth_call',
    userRequest: 'How much USDC is in my wallet?',
    agentRationale:
      'I will query the USDC contract for the wallet balance. This is a read-only call.',
    tx: {
      method: 'eth_call',
      chainId: SIMULATED_CHAIN_ID,
      from: DEMO_WALLET,
      to: USDC,
      value: 0n,
      data: encodeCall(SELECTORS.balanceOf, encodeAddress(DEMO_WALLET)),
    },
  },
  {
    id: 'small-transfer',
    title: 'Small token transfer',
    subtitle: 'transfer · 25 USDC',
    userRequest: 'Send Alice 25 USDC for lunch.',
    agentRationale:
      'Alice is in the saved contacts. I will call transfer() on USDC for 25 tokens.',
    tx: {
      method: 'eth_sendTransaction',
      chainId: SIMULATED_CHAIN_ID,
      from: DEMO_WALLET,
      to: USDC,
      value: 0n,
      data: encodeCall(SELECTORS.transfer, encodeAddress(ALICE), encodeUint(25_000_000n)),
    },
  },
  {
    id: 'unlimited-approval',
    title: 'Unlimited approval',
    subtitle: 'approve · unrecognized spender',
    userRequest: 'Claim the bonus rewards from that airdrop site.',
    agentRationale:
      'The claim page asks for a USDC approval first. I will approve the claim contract so it can proceed.',
    tx: {
      method: 'eth_sendTransaction',
      chainId: SIMULATED_CHAIN_ID,
      from: DEMO_WALLET,
      to: USDC,
      value: 0n,
      data: encodeCall(SELECTORS.approve, encodeAddress(UNFAMILIAR_SPENDER), encodeUint(MAX_UINT256)),
    },
  },
  {
    id: 'lookalike-recipient',
    title: 'Lookalike recipient',
    subtitle: 'transfer · 10 USDC · looks like Alice',
    userRequest: 'Send Alice 10 USDC.',
    agentRationale:
      'I found an address starting 0xa0f5 and ending 5ab8, like Alice’s. I will call transfer() on USDC for 10 tokens.',
    tx: {
      method: 'eth_sendTransaction',
      chainId: SIMULATED_CHAIN_ID,
      from: DEMO_WALLET,
      to: USDC,
      value: 0n,
      data: encodeCall(SELECTORS.transfer, encodeAddress(ALICE_LOOKALIKE), encodeUint(10_000_000n)),
    },
  },
]
