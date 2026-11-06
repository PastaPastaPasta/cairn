# @cairn/verify

> **Vendored** from [govhub](https://github.com/PastaPastaPasta/govhub) `packages/verify` at `fa04bea` (see the repo's `VENDORED.md`).
> Only the modules Cairn and the vendored `@cairn/auth` use were copied; the governance modules (proposal data, gov hash,
> collateral, tally, superblocks, claims) stay in govhub.

Pure, network-free TypeScript (ESM, Node >= 22, browser-safe). No I/O. Crypto: `@noble/curves`, `@noble/hashes`, `@scure/base`.

| Module | What it does |
|---|---|
| `address.ts` | base58check addresses (P2PKH/P2SH), WIF, `Network = 'mainnet' \| 'testnet' \| 'regtest'` |
| `bytes.ts` | hex, sha256d, hash160, little-endian integers, CompactSize, a byte `Reader`, display/raw uint256 order |
| `message.ts` | Dash `signmessage`: `dashMessageHash`, `signMessage`, `recoverMessageSigner`, `verifyMessage` (P2PKH only, like Core) |
| `tx.ts` | `parseTransaction` for Dash special transactions |
| `vote.ts`, `mnvote.ts` | masternode vote signing/recovery and `parseProRegTx` (collateral, payout, voting key at registration); `mnvote.ts` also keeps govhub's relay-cancel message (`govhub-relay-cancel-v1`), unchanged because it is govhub's wire format |

Every format was checked upstream against Dash Core and a real `dashd`; the tests here are govhub's, with the recorded fixtures.
