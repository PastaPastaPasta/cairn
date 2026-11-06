# @cairn/shares

Dash Core v24 shared-masternode logic for Cairn, in pure TypeScript (browser-safe, no Node APIs).
It ports Dash Core's own rules and formats so the browser can check, without trusting anyone,
what a co-owner is asked to sign.

Dash Core is the spec: every rule below cites the Core function it mirrors, and the tests compare
against Core's own outputs (see [Vectors](#vectors)). Runtime dependencies: `@noble/hashes`,
`@noble/curves` (secp256k1 recovery), `@scure/base` (base58).

All amounts are `bigint` duffs (1 DASH = `COIN` = 100 000 000 duffs). Networks use Core's names:
`"main" | "test" | "devnet" | "regtest"`.

```ts
import { parseSessionEnvelope, checkEnvelopeAgainstTerms, termsHash } from "@cairn/shares";
```

## API

### amounts
- `parseDash(text)`: exact decimal DASH → duffs (≤ 8 decimals; rejects floats, exponents, separators).
- `formatDash(duffs, { minDecimals?, groupSeparator?, unit? })`, `dash(whole)`, `moneyRange`, `COIN`.

### rules (consensus share-table rules plus matching helpers)
- Constants: `MIN_SHARES` 2, `MAX_SHARES` 8, `MIN_SHARE_AMOUNT` 100 DASH, `REGULAR_COLLATERAL`
  1000 DASH, `EVO_COLLATERAL` 4000 DASH (data only), `MAX_EARLY_PERIOD_BLOCKS` 420 480.
- `areShareAmountsValid(amounts, collateral?)`: `AreShareAmountsValid`.
- `isEarlyPenaltyValid(period, penalty, minShare)`: `IsEarlyPenaltyValid`.
- `isShareListTriviallyValid(shares, period, penalty, keyIDVoting, collateral?)`:
  `IsShareListTriviallyValid`, same check order and reject reasons (`bad-protx-shares-*`),
  including distinct owner keys and refund scripts and the payee-reuse rule.
- Matching: `remainingDuffs(roster)`, `isCompletable(count, remaining)`,
  `canAddShare(roster, amount)` (remainder must be 0 with ≥ 2 shares, or ≥ 100 DASH with a seat
  left under the 8-share cap), and `suggestCombos(remaining, candidateAmounts, maxPicks, opts?)`
  (index sets that sum exactly to `remaining`, fewest picks first, bounded search).
  These return `{ ok, reason, message }`.

### address
`decodeAddress`, `encodeAddress`, `isValidAddress`, `addressToScript`, `scriptToAddress`,
`addressToKeyId`, `keyIdToAddress`, `parseStandardScript`, `p2pkhScript`, `p2shScript`.
Prefixes: mainnet P2PKH 76 (`X…`), P2SH 16 (`7…`); test/devnet/regtest 140 (`y…`), 19 (`8…`).

### tx and proregtx
- `decodeTx` / `encodeTx` / `txid` (double-SHA256, byte-reversed as Core displays),
  `calcTxInputsHash`, `calcTxOutputsHash`.
- `decodeProRegTxPayload` / `encodeProRegTxPayload`: ProRegTx versions 1–3, Regular and Evo,
  ExtNetInfo, DIP-0026 payouts, the share table and `vchJoinSigs`, early terms.
- `decodeSharedProRegTx(hex)`: a shared registration with an internal collateral at the
  `04445348437551` template output (`isSharedCollateralScript`).
- ProDisTx (10), ProUpShareTx (11), ProUpSharedRegTx (12) codecs, and `identifySpecialTx(hex)`
  for the kind and proTxHash.
- `netinfo`: ExtNetInfo/MnNetInfo codec, `coreP2PEntries`, and `netInfoMatchesServiceList`
  (Dash-Qt's `NetInfoMatches`).

### consent
- `sharedRegConsentHash(tx, payload)`: `CProRegTx::MakeSharedRegConsentHash`. Returns
  `{ bytes, hex }`: `bytes` is the uint256 in internal order (what is signed), `hex` is Core's
  displayed form (the `consentHash` from `protx shared_register_prepare`).
- `proDisSignHash(tx, payload, sigCount)`, `proUpShareSignHash`, `proUpSharedRegSignHash`.
- `recoverCompact(digest, sig65)` and `verifyCompactCanonical(digest, keyId, sig65)`:
  `CHashSigner::VerifyHashCanonical` (65 bytes, header 27–34, low-S, recovered key ID).
- `verifyJoinSigs(tx, payload)`: every joinSig against its share's owner key.
- `decodeBase64Core`: Core's strict `DecodeBase64`.

### envelope (Dash-Qt messages)
- `parseSessionEnvelope(text, { network? })` → `SessionReport`. Validates
  `dash-shared-mn-session` v1 exactly as `MnShareSession::fromJson` and
  `payloadMatchesEnvelope` do (`ok` / `errorCode` / `error` mirror Core's verdict and message),
  and reports `stage`, `revision`, `sessionCode`, `fingerprint` (`ok` / `mismatch` / `absent`),
  `rows` (filled, bad addresses), `sigs` (present, valid), `fundingInputs` (scriptSig present),
  the decoded prepared transaction and whether its consent hash and payload match.
- `envelopeFingerprint(json)`: first 4 bytes of SHA256 over UniValue `write(2)` without the
  `fingerprint` key. `univalue.ts` is a byte-faithful port of UniValue's reader and writer (key
  order, duplicate keys, raw number tokens, `json_escape`, empty arrays as `[\n  ]`).
- `parseSigsEnvelope(text, { network?, proTxHash?, shares? })`: `dash-shared-mn-sigs` v1
  (dissolve / registrar). With the on-chain `shares` it recomputes the sign hash and verifies
  each approval, and refuses dissolutions that do not return every principal.
- `parseStandbyFile(text, shares?)`, `inspectProDisTx(hex, shares?)`, `readDissolution`:
  standby dissolution files and bare ProDisTx hex (mode, actor, payouts, penalty bonuses, fee,
  signature validity).
- `detectMessage(text)`: `SharedMnImport::Detect` (session, sigs, standby hex).

### terms (DESIGN.md §7)
- `TermSheet`: `network, groupId, revision, shares[{memberId, label, amount}], operatorPubKey,
  service, votingAddress, votingHolderId, rewardBps, earlyPeriodBlocks, earlyPenalty,
  coordinatorId`.
- `canonicalize(t)`: sorted keys at every level, no whitespace, bigints as decimal strings,
  only the fields above. `termsHash(t)` = hex `sha256("cairn-terms-v1\n" + canonical)`.
- `validateTermSheet(t)`: Core's rules plus Cairn's policy that a penalty is set exactly when
  there is an early period (`penalty-required`); mainnet services must be IPv4 port 9999.
- `parseTermSheet(json)`: back from canonical JSON.

### check
- `checkEnvelopeAgainstTerms(envelope, terms, { myLabel?, myOwnerAddress?, rowAddresses? })` →
  `{ verdict: "ok" | "warn" | "stop", stage, findings: [{ level, code, title, detail }] }`.
  Titles are plain language; `detail` holds the technical part. Shares are matched by label and
  amount (a different order is `info`). Any difference in amounts, operator key, service, voting
  address, operator reward, early terms or network is a `stop`, as is anything Dash Core itself
  would refuse. A zero early period warns "Anyone can leave at any time"; a fingerprint mismatch
  warns. Past the draft it also checks the prepared transaction's consent hash and that its
  share table and terms equal both the message and the term sheet. A BIP68 relative lock on any
  funding input is a `stop` (Core's `shared_sign` refuses those), and so is an invalid term sheet.
  Labels are free text the coordinator types, so a row is only tied to a person by its owner
  address: pass `myOwnerAddress` (and `rowAddresses` recorded from members' replies) to turn
  "my share" from `info` into a verified `ok`, and to stop when a member's addresses move to
  another row or change.
- `checkRegistrationAgainstTerms(proRegTxHex, terms, { proTxHash?, owners? })`: the on-chain
  check after broadcast (amounts order-insensitive, operator key, voting key ID, reward, early
  terms, service, share-table rules, fields consensus would reject, every joinSig; with `owners`,
  each member's owner key must hold their agreed amount).

### rewards
`splitOwnerReward(total, shares)` (`SplitAmountByShares`: floor per share, remainder to the
last), `operatorReward(mnReward, bps, payoutSet?)` (`mnReward * bps / 10000`, only once the
operator set a payout address), `splitMasternodePayment`, `earlyPeriodEndHeight(registered,
period)`, `isEarlyAt`, `penaltyBonuses`.

## What the checks cannot see

The term sheet deliberately has no addresses: Dash-Qt collects owner, refund, reward and change
addresses later, and only each member's wallet can tell whether they are theirs. The checker
shows them and Dash-Qt's own participant checks (`adoptLockedTerms`, `checkOwnFunding`) guard a
participant's row and coins. The checker never uploads a message.

## Vectors

- `test/vectors/testnet-d400c120.hex`: a real testnet shared ProRegTx built by the Qt wizard
  (500/300/200). The tests recompute its consent hash and recover all three owner key IDs from
  its joinSigs.
- `test/vectors/regtest/`: fixtures from a real `dashpay/dashd:24.0.0` regtest node, reproduced
  by `generate.sh` (one container, v24 activated by miner signalling as
  `feature_masternode_shares.py` does). Two masternodes go through prepare, sign, combine, funding
  signatures and broadcast, `protx info`, coinbase payouts, `shared_update_share`, a unanimous
  registrar update, standby and unanimous dissolutions, and a penalty-paying unilateral
  dissolution. Envelope fingerprints are produced by Core's own UniValue writer (`echojson`
  through `dash-cli`).
- `test/vectors/univalue/`: 54 UniValue edge cases (overlong and CESU UTF-8, surrogates, raw
  number tokens, duplicate keys) echoed through dashd 24.0.0 with `dash-cli -stdin echojson`;
  the port must accept and write exactly what Core does.
- The C++ `share_list_validation`, `canonical_signature_verification` and
  `split_amount_by_shares` cases are ported in `test/rules.test.ts`, `test/testnet-vector.test.ts`
  and `test/basics.test.ts`.

```sh
npm test            # vitest
npm run typecheck   # src without DOM/Node types, then tests
```
