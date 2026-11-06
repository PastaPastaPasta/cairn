# Dash Core shared masternodes: research notes for a co-owner matching site

Source: `~/workspace/dash` detached at `origin/develop` @ `714b7f5d404` (includes the v24.0.0
merge-back, #8064). All `file:line` citations are against that tree. DIP text:
dashpay/dips#187 (open, head `PastaPastaPasta/dips@8a0836e`, file
`dip-pasta-shared-masternode-collateral.md`, saved at
`dip-shares.md`), and `dip-0026.md` from dips master (saved
alongside). Research only; nothing in the repo was changed.

Relevant PRs (from `git log origin/develop --merges --grep`):
#7340 (DIP-0026 multi-payouts), #7437 (shared MN DIP implementation), #7701 (Qt GUI),
#7705/#7706 (follow-ups), #7721 (typed interfaces), #7771 (docs: consent is per share, not per
input), #7807 (`evo_shares` deployment), #7881 (refuse registrar updates that move the funder's
coins), #7957, #7991, #8019, #8020 (shared_sign only signs principal-returning dissolutions), #8021,
#8024, #8026, #8027, #8032, #8034, #8035, #8036 (participant can follow a revised invitation that
keeps their share). All of #8019–#8036 landed for v24.0.0-rc.7 / final.

---

## 1. Activation

### Deployments

| Deployment | Name | Bit | Gates |
| --- | --- | --- | --- |
| `DEPLOYMENT_V24` | `v24` | 13 | Shared collateral (regular MNs), ProDisTx (type 10), ProUpShareTx (11), ProUpSharedRegTx (12), DIP-0026 multi-payouts for regular MNs, ProTx v3 / extended addresses, coinbase payment multiplicity |
| `DEPLOYMENT_EVO_SHARES` | `evo_shares` | 14 | Additionally required for an **EvoNode** to use shared collateral or >1 owner payout |

- Enum: `src/consensus/params.h:45-46`; names `src/deploymentinfo.cpp:17,21`.
- Both are EHF (DIP-0023) deployments: an LLMQ_400_85 quorum must sign an MNHF signal after
  start time, then miner signaling in 4032-block windows; lock-in, then activation one window later
  (`doc/release-notes.md:134-171`).
- Gate plumbing: `SpecialTxRules{.v24, .evo_shares}` built in `src/validation.cpp:7006-7007`.
  `CheckProRegTx` rejects shared EvoNodes with `bad-protx-shares-evo` and multi-payout EvoNodes with
  `bad-protx-payouts-evo` unless `rules.evo_shares` (`src/evo/specialtxman.cpp:1275-1282`; also
  ProUpRegTx `:1597-1598`). Types 10/11/12 are rejected `bad-prodis-too-early` /
  `bad-proupshare-too-early` / `bad-proupsharedreg-too-early` before v24
  (`src/evo/specialtxman.cpp:1686-1688, 1743-1745, 1912-1914`). Shared registration needs ProTx v3
  (`CurrentProviderTxVersion >= ExtAddr`), which only exists after v24
  (`src/evo/providertx_service.cpp:1140-1146`; RPC check `src/rpc/evo.cpp:2266-2268`).
- The RPC for shared EvoNodes refuses until `evo_shares` is active
  (`src/evo/providertx_service.cpp:1130-1133`, `EvoSharesActive` at `:103-109`).
- The Qt wizard only builds **regular** masternodes (`payloadMatchesEnvelope` requires
  `nType == Regular`, `src/qt/mnsharesession.cpp:1047-1052`) and refuses to start until v24 is active
  (`src/qt/sharedmncreatedialog.cpp:2346-2349`, message `src/qt/sharedmnwidgets.cpp:92-97`).

### Parameters (`src/kernel/chainparams.cpp`)

| Network | Lines | Start | Timeout | Window | Thresholds |
| --- | --- | --- | --- | --- | --- |
| mainnet | 224-240 | `1794182400` = 2026-11-09 00:00 UTC (both) | `1857340800` (2028-11-09) | 4032 | 3226 (80%) → 2420 (60%), falloff 5 |
| testnet | 435-451 | `1790208000` = 2026-09-24 00:00 UTC (both) | none | 100 | 80 → 60 |
| devnet | 619-635 | `1751328000` = 2025-07-01 (both) | none | 120 | 96 → 72 |
| regtest | 915-931 | 0 (both) | none | 250 | 200 → 150 |

Both deployments have identical parameters on every network so that a later release can activate
`evo_shares` without a param change (`doc/release-notes.md:173-178`).

### Is anything signing bit 14?

No. `CEHFSignalsHandler::UpdatedBlockTip` skips it unconditionally:
`if (pos == Consensus::DEPLOYMENT_EVO_SHARES) continue;` with comment "v24 follows evo_shares
without signing it; a later release signs it once Platform supports EvoNode shares and payouts"
(`src/llmq/ehf_signals.cpp:53-55`, commit `68a9144d50c`). That is still true on develop HEAD, so
neither 24.0.0 nor current develop nightlies (24.1.0-nightly) sign it. Release notes:
"v24.0.0 does **not** sign the `evo_shares` signal ... A later release (v24.1) is expected to sign it
once Dash Platform supports EvoNode shares and payouts" (`doc/release-notes.md:173-178`).
(The DIP draft itself still says shared registration is Regular-only "in this version",
`dip-shares.md:614-638`.)

### Live state (checked 2026-11-06)

Verified via `https://nodes.dashhq.org/api/v1/{mainnet,testnet}/activation` (DashHQ Radar,
backed by a 24.0.0 node):

- **Testnet**: `v24` **active since height 1,578,000** (EHF signal mined at 1,565,132, 2026-10-03;
  activation 2026-10-23 16:10 UTC). `evo_shares`: `defined`, phase `not_signed`.
  Corroboration: the public `trpc.digitalcash.dev` node runs 22.1.3 and is stuck at height 1,577,999
  (`initialblockdownload: true`), i.e. it cannot follow the v24 chain past the activation block.
- **Testnet has real shared MNs already.** Two post-activation ProRegTx with the template output
  `04445348437551` exist, e.g. `d400c120…74e6` (registered 1,583,318) and `38c3acb9…8aa4`
  (1,583,595). Decoded `d400c120…` with the local `src/dash-tx -testnet -json`: 3 inputs (all
  `sequence` 0xffffffff, `nLockTime` 0), 3 change outputs then the 1000 DASH template output at
  index 3 (exactly the Qt wizard's layout), shares 500/300/200 DASH, `earlyPeriodBlocks` 52560
  (≈3 months preset), `earlyPenalty` 5 DASH, `operatorReward` 3 (i.e. 0.03%), empty service
  (`addresses: {}`), so both are listed `pose_banned` (registered without a service address and
  never followed by a ProUpServTx).
- **Mainnet**: tip ≈2,567,858; `v24` `defined`, phase `waiting_for_signal` (start time not reached);
  `evo_shares` `defined`, `not_signed`. Radar's outlook: start-time block ≈2,569,124 (2026-11-09),
  earliest signaling window start 2,572,416 (≈11-15), earliest lock-in 2,576,448 (≈11-22),
  **earliest activation 2,580,480 (≈2026-11-29)**. Release notes give the same heights and "around
  November 28" (`doc/release-notes.md:162-168`). Every missed window adds ~1 week.
- Not verifiable: `rpc.digitalcash.dev`/`trpc.digitalcash.dev` run 22.1.3 and have no
  `getdeploymentinfo` (method not found) and no v24/evo_shares softfork entries; I did not have a
  v24 RPC endpoint of my own on mainnet. I did not confirm that the LLMQ_400_85 gate will reach 85%
  (Radar shows the selected quorum at 202/400 members on current protocol as of the check, threshold
  340), so the mainnet date is an earliest-possible estimate, not a schedule.

### Bottom line

- **Testnet: now.** Regular shared MNs can be registered today (and have been). EvoNode shared MNs:
  not until a release that signs `evo_shares` ships and it activates (not scheduled).
- **Mainnet: not before ≈2026-11-28/29** (block 2,580,480), and only if the first signaling window
  after the EHF signal reaches 80%; regular MNs only. EvoNodes: not before a future release (v24.1+)
  signs bit 14 and it goes through its own EHF + 4032-block window cycle.
- Devnet/regtest: both start at 0/2025-07-01, so they activate as soon as the EHF signal and the
  window pass (functional tests just mine; regtest can also use `-testactivationheight`/`-vbparams`).

---

## 2. Data model

### Share (`CCollateralShare`, `src/evo/providertx.h:55-88`)

| Field | Type | Mutability | Notes |
| --- | --- | --- | --- |
| `amount` | int64 duffs | immutable | ≥ `MIN_AMOUNT` = 100 DASH (`:58`), ≤ collateral |
| `scriptRefund` | P2PKH/P2SH | immutable | principal destination at dissolution; unique within the table |
| `scriptReward` | P2PKH/P2SH or empty | updatable via ProUpShareTx | empty = use refund (`RewardScript()`, `:80`) |
| `keyIDOwner` | CKeyID (P2PKH key) | immutable | per-share control key; signs consent, dissolution, registrar updates, own reward updates |

### Table-level rules (`src/evo/providertx.cpp:64-150`, `src/evo/providertx.h:142-147`)

- 2 ≤ shares ≤ 8 (`MIN_SHARES`, `MAX_SHARES`), count serialized as one byte.
- Each amount in [100 DASH, collateral]; **sum must equal the collateral exactly**: 1000 DASH regular,
  4000 DASH EvoNode (`GetMnType(nType).collat_amount`). Granularity is **1 duff**; there is no other
  quantum. (8 × 100 = 800 < 1000, so with 8 shares at least one must be larger.)
- `0 ≤ earlyPenalty < min(share amounts)`; `earlyPenalty` must be 0 if `earlyPeriodBlocks == 0`;
  `earlyPeriodBlocks ≤ 420480` (~2 years) (`:64-77`, `:109-111`).
- Owner keys non-null and pairwise distinct; refund scripts pairwise distinct; **reward scripts may
  repeat** (functional test points every share's reward at one address,
  `test/functional/feature_masternode_shares.py:466,498`).
- Refund and non-empty reward scripts: P2PKH or P2SH, must not pay the voting key's P2PKH or any
  share's owner key P2PKH (`bad-protx-shares-payee-reuse`, `:125-145`).
- Owner keys share the global uniqueness namespace with ordinary `keyIDOwner`s: a share owner key
  can never be reused by any other masternode, shared or not, ever while that MN exists
  (`src/evo/specialtxman.cpp:1363-1377`; `src/evo/deterministicmns.cpp:470-485`). Fresh owner address
  per formation.

### Masternode-wide (one per MN, not per share) — `CProRegTx` (`src/evo/providertx.h:137-259`)

- `keyIDOwner` must be **null** for a shared MN; `payouts` (DIP-0026 list) must be **empty**;
  collateral must be **internal** (`collateralOutpoint.hash` null) (`src/evo/providertx.cpp:330-345`).
- `pubKeyOperator` (BLS, basic scheme), `keyIDVoting` (one voting key for the whole MN),
  `nOperatorReward` (0–10000 basis points of the MN reward), `netInfo` (service; may be empty →
  PoSe-banned until ProUpServTx), `nEarlyPeriodBlocks`, `nEarlyPenalty`, plus `platformNodeID` and
  Platform addresses for EvoNodes.
- `vchJoinSigs`: one 65-byte compact signature per share, in share order (`:164`).
- Collateral output script: the 7-byte template `04445348437551` = `0x04 "DSHC" OP_DROP OP_TRUE`
  (`src/evo/sharedcollateral.h:10-27`). Anyone-can-spend at the script layer; consensus allows its
  creation only as the declared collateral of a valid shared ProRegTx and its spending only by a
  ProDisTx (`src/evo/specialtxman.cpp:1929-1962`, `:783-790`). Template outputs created before
  activation are frozen forever.
- State stores shares, early terms; joinSigs are not kept (`src/evo/dmnstate.h:62-65`).

### Who holds which key

- **Share owner key (per share)**: each participant, in their own Dash Core wallet (it must be in a
  wallet to sign; the signature is a raw compact ECDSA sig over a 32-byte digest, not a
  `signmessage`, `src/messagesigner.cpp:48-51,58-90`, so hardware wallets / `signmessage` cannot
  produce it). Must be P2PKH. Immutable, cannot be rotated (DIP rationale, `dip-shares.md:666-678`).
- **Refund destination (per share)**: anything P2PKH/P2SH; may be a different wallet, multisig,
  cold storage. Immutable.
- **Reward destination (per share)**: optional; updatable unilaterally by that share's owner key.
- **Voting key (per MN)**: one P2PKH key held by whoever the group picks (GUI: "Votes on governance
  proposals for the whole masternode", `src/qt/sharedmncreatedialog.cpp` settings page). Governance
  power is not split. Changeable only unanimously (ProUpSharedRegTx).
- **Operator key (per MN)**: BLS; the operator holds the secret. Changeable only unanimously.

### Payout split (`src/masternode/payments.cpp:242-264`, `src/evo/providertx_util.cpp:88-115`)

1. Platform share reallocated first (EvoReward era), then
2. operator reward = `mnReward * nOperatorReward / 10000`, **only if the operator has set an operator
   payout script** (via ProUpServTx); otherwise the operator's cut stays with the owners
   (`payments.cpp:244-249`);
3. the rest is split across shares by `amount` weight: sequential floor
   `floor(total*amount_i/1000 DASH)` for every share but the last, remainder to the last share; each
   paid to `RewardScript()`; zero outputs omitted.

So a 500/300/200 split pays exactly 50%/30%/20% of the owner portion. Up to 8 owner outputs per
payout block (+1 operator). Coinbase outputs must now be one-per-entry (multiplicity rule).

### EvoNode restrictions

Until `evo_shares`: EvoNode ProRegTx with a share table → `bad-protx-shares-evo`; EvoNode ProRegTx
or ProUpRegTx with >1 owner payout → `bad-protx-payouts-evo` (`src/evo/specialtxman.cpp:1275-1282,
1597-1598`). The consent digest of a shared EvoNode also covers `platformNodeID`
(`src/evo/providertx.cpp:398-400`). GUI never builds EvoNode shares.

### DIP-0026 multi-party payouts (non-shared MNs, for comparison)

`MasternodePayoutShare{scriptPayout, reward}` with reward 100–10000 bps (≥1%), 1–8 entries, sum
exactly 10000, distinct P2PKH/P2SH payees, not the owner/voting key (`src/evo/providertx.h:31-47`,
`src/evo/providertx.cpp:26-62`). Note Core caps at 8 and min 1%, tighter than DIP-0026 text (32,
0–10000). This is *not* trustless: the single owner can change the list and spend the collateral.

---

## 3. Transaction types, signers, exit rules

| Type | Payload | What it does | Who signs | Mode |
| --- | --- | --- | --- | --- |
| 1 ProRegTx v3 with `shares` | `CProRegTx` | Registers MN; funding inputs + change + template collateral in **one tx** | every share owner (joinSigs over `SharedRegConsentHash`) **and** every funding input's owner (normal scriptSigs) | unanimous, atomic |
| 2 ProUpServTx | `CProUpServTx` | Service address / operator payout address | operator BLS key | operator only (unchanged) |
| 3 ProUpRegTx | — | **invalid for shared MNs** (`bad-protx-shared-mn`, `src/evo/specialtxman.cpp:1558-1562`, `:569-571`) | — | — |
| 4 ProUpRevTx | `CProUpRevTx` | Operator revokes itself; MN PoSe-banned, operator fields reset | operator BLS key | operator only (`:1643-1675`) |
| 10 ProDisTx | `CProDisTx{proTxHash, actorIndex, vchSigs}` (`src/evo/providertx.h:444-490`) | Spends the template collateral, refunds every share's principal to its refund script, removes MN | 1 sig (actor) = unilateral; N sigs = unanimous | either |
| 11 ProUpShareTx | `CProUpShareTx{proTxHash, shareIndex, scriptReward, inputsHash, vchSig}` (`:492-523`) | Changes one share's reward script | that share's owner key | unilateral |
| 12 ProUpSharedRegTx | `CProUpSharedRegTx{proTxHash, pubKeyOperator, keyIDVoting, inputsHash, vchSigs}` (`:525-565`) | Changes operator key and/or voting key (operator change → PoSe-ban until new ProUpServTx) | every share owner | unanimous |

All lifecycle txs (10/11/12) require the MN to exist in the **previous** block
(`src/evo/specialtxman.cpp:1916-1925`). Signatures must be canonical low-S compact, header 27–34
(`src/messagesigner.cpp:58-90`).

### Consent digest (registration) — `src/evo/providertx.cpp:380-418`

`SHA256d("DashSharedMNReg" (compactsize-prefixed) || payload nVersion || tx nVersion || tx nType ||
tx nLockTime || CalcTxInputsHash(tx) || every vin nSequence || CalcTxOutputsHash(tx) || nType ||
nMode || netInfo || [platformNodeID if Evo] || keyIDVoting || pubKeyOperator || nOperatorReward ||
uint8 sharesCount || shares… || nEarlyPeriodBlocks || nEarlyPenalty)`.

Binds exact inputs (prevouts + sequences), all outputs (change + collateral), share table,
penalty terms, operator/voting/reward/service. It does **not** include `vchJoinSigs` or input
scriptSigs, so funding inputs are signed *after* consent sigs are combined (the combined payload is
inside the sighash of each input).

Consent is per **share**, not per funding input: signing a funding input into a table that lacks
your share donates the coins (#7771; RPC help `src/rpc/evo.cpp:2236-2240`).

### Dissolution rules — `CheckProDisTxForList`, `src/evo/specialtxman.cpp:1790-1901`

- Exactly one input: the MN's collateral outpoint, empty scriptSig.
- `vchSigs.size()` is 1 (unilateral, by `shares[actorIndex]`) or N (unanimous); the count is in the
  signed digest (`MakeSignHash`, `src/evo/providertx.cpp:546-573`), so modes cannot be swapped.
- `early = nSpendHeight - nRegisteredHeight < nEarlyPeriodBlocks`;
  `required_penalty = (unanimous || !early) ? 0 : nEarlyPenalty`.
- Outputs: one per non-actor share in share order to its refund script with value ≥ principal +
  `floor(required_penalty * amount_i / non_actor_total)`, plus optional final actor output to the
  actor's refund script (non-zero). Sum of bonuses ≥ required_penalty.
- Fee = everything not output, comes from the actor's share, **≤ 1,000,000 duffs (0.01 DASH)**
  (`MAX_FEE`, `src/evo/providertx.h:451`).
- Unilateral bonuses ≤ `nEarlyPenalty` (stolen key can't drain more than penalty + 0.01 DASH).
  Unanimous may pay anything every owner signed, but Core's RPC/GUI never build or sign anything
  other than "return every principal, fee from actor" (`ReturnsPrincipal`,
  `src/evo/providertx_service.cpp:697-711`; #8020).
- Monotone validity: a ProDisTx valid at height h is valid forever → **standby dissolutions**.
  A zero-penalty unilateral standby signed during the early period becomes valid at
  `registeredHeight + earlyPeriodBlocks` and never expires; a penalty-paying one is valid
  immediately and forever (`src/evo/providertx_service.cpp:1375-1412`).
- The MN is removed in the block that mines the ProDisTx (`src/evo/specialtxman.cpp:783-799`).
- Principal is never at risk from anyone: every share is always refunded to its immutable refund
  script; the only transfer is the consented early penalty (paid by the leaver to the stayers,
  pro-rata). There is **no** way to sell/transfer a share or replace a participant; "exit" = whole MN
  dissolves; continuing members must re-register a new MN (new owner keys, new collateral tx).
- Relay: no RBF/package relay; first ProDisTx in mempool wins, competing ones conflict
  (`dip-shares.md:381-401`).
- Key loss: another participant's unilateral dissolution refunds the key-less participant in full;
  one lost key permanently blocks unanimous dissolve and operator/voting changes.

---

## 4. RPC flow (N participants + operator)

All RPCs are wallet RPCs under `#ifdef ENABLE_WALLET` in `src/rpc/evo.cpp`; registration-side
`shared_register_prepare` and `shared_combine` do not use wallet keys (any v24 node can run them).

### Signatures

```
protx shared_register_prepare "fundingTx" shares coreP2PAddrs operatorPubKey votingAddress operatorReward earlyPeriodBlocks earlyPenalty
protx shared_register_prepare_evo  ... same ... platformNodeID platformP2PAddrs platformHTTPSAddrs   (fails until evo_shares)
protx shared_sign "tx" ( allowTimeLocks=false )
protx shared_combine "tx" signatures ( submit=false )
protx shared_dissolve "proTxHash" actorIndex ( fee=100000 submit=true payPenalty=<auto> )
protx shared_dissolve_prepare "proTxHash" actorIndex ( fee=100000 )
protx shared_update_share "proTxHash" shareIndex "rewardAddress" "feeSourceAddress" ( submit=true )
protx shared_update_registrar_prepare "proTxHash" "operatorPubKey|''" "votingAddress|''" "feeSourceAddress"
```

(`src/rpc/evo.cpp:2184-2312, 1243-1338, 1482-1546, 1340-1382, 2324-2361, 1384-1429, 1431-1480`)

Argument types that bite:
- `shares[].amount` is an **integer in duffs** (≥ 10,000,000,000); `refundAddress`, `ownerAddress`
  (P2PKH) required; `rewardAddress` optional.
- `coreP2PAddrs`: `"IP:PORT"` (or array), may be `""` → MN PoSe-banned until ProUpServTx.
- `operatorReward`: **percent string** with 2 decimals, `"12.50"` → 1250 bps (`:2276-2283`).
- `earlyPeriodBlocks` integer ≤ 420480; `earlyPenalty` **integer duffs**.
- `fundingTx`: raw hex with every participant's inputs and change outputs **but no collateral
  output**; prepare sets `nVersion=3, nType=1`, appends the 1000 DASH template output as the last
  output, fills `inputsHash`, placeholder joinSigs, and preflights `IsTriviallyValid`
  (`src/evo/providertx_service.cpp:1124-1215`).

### Outputs

- `shared_register_prepare` → `{ "tx": hex, "collateralIndex": n, "consentHash": hex, "terms": {decoded proRegTx}, "warning"?: "…" }`
  (warning when `earlyPenalty == 0`).
- `shared_sign` → `{ "type": "registration"|"dissolution"|"registrarUpdate", "terms": {...}, "warning"?, "signatures": [ {"shareIndex": i, "signature": "<base64 65 bytes>"} ] }`
  — one entry per share owner key the wallet holds; does not modify the tx. Refuses txs with an
  unsatisfied nLockTime or any BIP68 relative lock unless `allowTimeLocks` (`src/evo/providertx_service.cpp:1224-1233`). For dissolutions, refuses anything that does not return every principal.
- `shared_combine` → hex (registration: never submits — funding inputs still need signing; requires
  a signature for every share). For ProDisTx can `submit=true`. For ProUpSharedRegTx must run in the
  wallet that prepared it (re-signs fee inputs; single-address funding, change back, fee ≤
  `-maxtxfee`; #7881).
- `shared_dissolve` → txid, or signed hex with `submit=false` (standby).
- `shared_dissolve_prepare` / `shared_update_registrar_prepare` → `{ "tx": hex, "signHash": hex }`.

### The artifacts passed around

Only two kinds, both plain text:
1. **Raw transaction hex** (`tx` from prepare → after combine → after each
   `signrawtransactionwithwallet`). No PSBT is used.
2. **Signature entries** `{"shareIndex": i, "signature": "<base64>"}` (JSON array).

### Worked example: A 500, B 300, C 200 DASH, operator O (testnet)

0. Each participant P in their own Dash Core wallet:
   ```
   getnewaddress            # ownerP  (P2PKH; keep in this wallet; used only to sign)
   getnewaddress            # refundP (or any P2PKH/P2SH you control; immutable)
   getnewaddress            # rewardP (optional)
   listunspent              # choose coins worth >= share (+ fee if paying it)
   getnewaddress            # changeP
   lockunspent false '[{"txid":"…","vout":0}]'   # optional local reservation
   ```
   P sends the group: `{share: amount, ownerAddress, refundAddress, rewardAddress?, inputs:[{txid,vout}], change:{address, amount}}`.
   Operator O: `bls generate` → keeps `secret`, sends `public`; picks `IP:PORT`; may also hand over
   an operator payout address later (it is set by O's ProUpServTx, not in the ProRegTx).
   Group picks a voting address V (P2PKH; must not equal any refund/reward address).
1. Coordinator (any node) builds funding tx (no collateral output):
   ```
   createrawtransaction '[{"txid":"<A1>","vout":1},{"txid":"<B1>","vout":0},{"txid":"<C1>","vout":0}]' \
     '{"<changeA>":3.9989955,"<changeB>":0.5,"<changeC>":0.5}'
   ```
   Must hold: Σinputs − Σchange − 1000 = fee (whoever overfunds pays it; Qt has the coordinator
   pay it, default 0.001 DASH).
2. ```
   protx shared_register_prepare "<fundingHex>" \
     '[{"amount":50000000000,"refundAddress":"<refundA>","rewardAddress":"<rewardA>","ownerAddress":"<ownerA>"},
       {"amount":30000000000,"refundAddress":"<refundB>","ownerAddress":"<ownerB>"},
       {"amount":20000000000,"refundAddress":"<refundC>","ownerAddress":"<ownerC>"}]' \
     "203.0.113.7:19999" "<O.public>" "<V>" "5.00" 52560 500000000
   ```
   → `{tx, collateralIndex: 3, consentHash, terms}`.
3. A, B, C each: `protx shared_sign "<tx>"` → check `terms.shares[i]` is theirs (amount, refund,
   reward, owner), check `terms` operator/voting/early terms; then return
   `[{"shareIndex":i,"signature":"…"}]`. Also `decoderawtransaction <tx>` to check that their change
   output is present and correct (the consent digest binds it, but the wallet only shows terms).
4. Anyone: `protx shared_combine "<tx>" '[{"shareIndex":0,"signature":"…"},{"shareIndex":1,…},{"shareIndex":2,…}]'` → `hexC`.
5. A, B, C each: `signrawtransactionwithwallet "<hexC>"` (sequentially, passing `hex` on, or in
   parallel then `combinerawtransaction '["hexA","hexB","hexC"]'`). Final `complete: true`.
   Never re-sign after changing anything: any change to inputs/outputs/payload invalidates the
   joinSigs (`bad-protx-shares-sig`) — tested for refund/change/locktime/sequence tampering
   (`test/functional/feature_masternode_shares.py:524-541`).
6. Anyone: `sendrawtransaction "<hexFinal>"` → proTxHash = that txid.
7. After ≥1 confirmation, each participant i:
   ```
   protx shared_dissolve <proTxHash> i 100000 false false   # full-principal standby, valid after early period
   protx shared_dissolve <proTxHash> i 100000 false true    # penalty-paying standby, valid now
   ```
   Store both hexes with the refund-key backup (RPC help `src/rpc/evo.cpp:2241-2245`).
8. Operator: `masternodeblsprivkey=<secret>` in dash.conf; if the service was empty, or to set an
   operator payout: `protx update_service <proTxHash> "IP:PORT" <O.secret> <opPayoutAddr> <feeSource>`.

Maintenance:
- Reward change: `protx shared_update_share <proTxHash> i <newReward> <feeSourceAddr>` (unilateral).
  To revert to refund, pass the refund address explicitly.
- Operator/voting rotation: one wallet F runs `protx shared_update_registrar_prepare <proTxHash>
  <newOpPub|""> <newVoting|""> <feeAddrInF>` → `{tx, signHash}`; every owner `protx shared_sign <tx>`;
  F runs `protx shared_combine <tx> <sigs> true`.
- Unanimous free dissolve: anyone `protx shared_dissolve_prepare <proTxHash> <actor> [fee]`; every
  owner `shared_sign`; anyone `shared_combine <tx> <sigs> true`.
- Unilateral: `protx shared_dissolve <proTxHash> <myIndex>` (pays penalty if early; refuses to
  submit a zero-penalty one during the early period).

---

## 5. Qt GUI flow (the artifacts users actually paste)

Code: `src/qt/mnsharesession.{h,cpp}` (pure engine/envelope), `src/qt/sharedmncreatedialog.{h,cpp}`
(registration wizard), `src/qt/sharedmndialogs.{h,cpp}` (maintenance: reward, rotate keys, dissolve,
standby), `src/qt/sharedmnwidgets.{h,cpp}` (import detection, previews). Entry: Masternodes tab →
"Shared Masternode…"; a single paste entry point on the list routes messages.

### Roles

- **Coordinator**: clicks "Start a Shared Masternode" (new session, random `sessionId`, revision 1,
  two rows 500/500 by default, `src/qt/sharedmncreatedialog.cpp:2344-2390`). Page order:
  Participants → Settings → Exit terms → Contribution → (Save operator key) → Invite → Approvals →
  Signatures → Complete (`:1175-1187`). Pays the network fee on top of its share
  (`contributionTarget`, `:3368-3373`; `DEFAULT_NETWORK_FEE` 100000 duffs, `:83-85`). Runs
  `shared_register_prepare` ("lock terms"), combines approvals, and is the only one who broadcasts.
- **Participant**: pastes the invitation; page order Contribution → wait → Approvals → wait →
  Signatures → wait → Complete. Picks "This is me" row (inferred if exactly one row is empty,
  `inferMyShare`, `:3759-3786`).
- Role on import is decided by `coordinatedHere`: `prepareWallet` equals this wallet's name **and**
  the row labelled `coordinatorLabel` has an owner address this wallet can spend (`:3860-3876`).
  Otherwise the importer is a Participant.

### Three rounds (`src/qt/sharedmncreatedialog.h:41-60`)

1. **Invitation → Details**: coordinator copies one identical Draft envelope to everyone; each
   participant fills its row (owner/refund/reward), reserves coins, copies back its Draft "Details".
   Coordinator absorbs replies in any order (`absorbDraftReply`, `src/qt/mnsharesession.cpp:1198-1278`:
   rows only ever fill from empty; labels/amounts/terms must match; contributions re-sorted by share
   so the funding tx is order-independent).
2. **Locked Terms → Approval**: coordinator runs prepare (stage `frozen`), signs own consent; sends
   the Frozen/Signing envelope; each participant verifies (`adoptLockedTerms` refuses if its own row
   or coins changed, `:1280+`) and returns its consent signature inside the envelope.
3. **Signing Request → Signed Contribution**: after combine (stage `combined`), each participant
   signs only its own funding inputs (wallet refuses if a foreign input it can spend is present or its
   own contribution is short-changed, `checkOwnFunding`; `signedOnlyOwnInputs`), returns
   `fundingSigned`. Coordinator merges input signatures and broadcasts (stage `broadcast`; "Final
   Record").

Any message can be pasted from the landing page; the dialog recognises the stage. Every message shows
`Session XXXXXX` (first 6 hex of sessionId) and a `Code ABCD-EFGH` fingerprint so people can confirm
they hold the same copy (`copySession`, `:2947-2953`).

### Envelope format: `dash-shared-mn-session` v1

- Transport: **plain JSON text**, pretty-printed with UniValue `write(2)`, via clipboard
  (`GUIUtil::setClipboard(m_session.toJsonString())`) or a file `shared-mn-session-<CODE>.json`
  (`src/qt/sharedmncreatedialog.cpp:2949,2968-2977`). No URI scheme, no base64, no compression,
  no prefix. Max accepted size 2 MiB (`src/qt/sharedmnwidgets.h:160`).
- Detection: trimmed text parses as JSON object with `type == "dash-shared-mn-session"`
  (`SharedMnImport::Detect`, `src/qt/sharedmnwidgets.cpp:355-401`). Also detected:
  `"dash-shared-mn-sigs"` (maintenance) and bare hex of a type-10 tx (standby dissolution).
- Serialization: `MnShareSession::toJsonBody` (`src/qt/mnsharesession.cpp:276-339`), keys **in this
  order**:

```json
{
  "type": "dash-shared-mn-session",
  "version": 1,
  "network": "test",                       // "main" | "test" | "devnet" | "regtest"; must match node
  "sessionId": "<64 hex, GetRandHash().ToString()>",
  "revision": 3,                           // >= 1; bumps on every draft edit / absorbed reply
  "stage": "draft",                        // draft|frozen|signing|combined|fundingSigned|broadcast
  "fundingTx": "<hex, nVersion 2, inputs then change outputs, no collateral>",
  "shares": [
    {"label": "Alice", "amount": 50000000000, "ownerAddress": "y…", "refundAddress": "y…", "rewardAddress": ""},
    {"label": "Bob",   "amount": 30000000000, "ownerAddress": "",   "refundAddress": "",   "rewardAddress": ""},
    {"label": "Carol", "amount": 20000000000, "ownerAddress": "",   "refundAddress": "",   "rewardAddress": ""}
  ],
  "terms": {
    "coreP2PAddrs": "203.0.113.7:19999",   // comma/space separated, may be ""
    "operatorPubKey": "<96 hex BLS basic>",
    "votingAddress": "y…",
    "operatorReward": 500,                 // basis points (NOT percent string)
    "earlyPeriodBlocks": 52560,
    "earlyPenalty": 500000000
  },
  "contributions": [
    {"label": "Alice",
     "inputs": [{"txid": "<64 hex>", "vout": 1, "sequence": 4294967295}],
     "change": {"address": "y…", "amount": 399899550},   // omitted when no change
     "changeIndex": 0}
  ],
  "protx": "",                             // shared ProRegTx hex once frozen
  "consentHash": "",                       // 64 hex once frozen
  "collateralIndex": -1,
  "sigs": [ {"shareIndex": 0, "signature": "<base64 65 bytes>"} ],
  "prepareWallet": "<coordinator's wallet name>",
  "operatorSecretHolder": "Alice",         // free text "Node run by"
  "coordinatorLabel": "Alice",
  "fingerprint": "AB12-CD34"
}
```

  (The `//` comments are mine; the real envelope is strict JSON.)
- `fingerprint` = first 4 bytes of SHA256 over the UTF-8 of the envelope **without** the
  `fingerprint` key, written by UniValue with indent 2, as 8 uppercase hex `XXXX-XXXX`
  (`src/qt/mnsharesession.cpp:225-245`). A mismatch is only a warning ("This message was edited after
  it was copied."), not a parse failure. UniValue pretty-print specifics an external producer must
  replicate to get a matching code: `"key": value` with one space, two-space indent, **empty arrays
  print as `[` newline indent `]`** (not `[]`), key order exactly as above
  (`src/univalue/lib/univalue_write.cpp`).
- Parsing: `MnShareSession::fromJson` (`src/qt/mnsharesession.cpp:371-660`): type/version/network
  strict; ≤8 shares, ≤8 contributions, ≤64 inputs per contribution; for any stage past draft the
  `protx` must decode as a shared ProRegTx whose recomputed consent hash equals `consentHash` and
  whose payload and inputs/outputs match `shares`/`terms`/`contributions` exactly
  (`payloadMatchesEnvelope`, `:976-1085`: collateral must be the last output, nLockTime 0, sequences
  as recorded, regular type only); at `combined`+ every share's signature must verify; at
  `fundingSigned`+ every input must carry a scriptSig.
- Funding tx built deterministically by the engine (`rebuildFundingTx`, `:796-806`): `nVersion 2`,
  all contributions' inputs in share order, then one change output per contribution with change.

### Coin reservation

Purely local: the wallet `lockCoin(outpoint, write_to_db=true)` on the coins it contributes
(`src/qt/sharedmncreatedialog.cpp:3589-3614`); coin selection is largest-first from confirmed or
trusted coins, change kept above dust (`selectCoins`, `:3375-3433`). Nothing on-chain or in other
wallets enforces it. Participants can "Release my coins"; a session whose reserved coin is seen spent
is declared dead ("start over", `deadReason`, `:3621-3651`). Closing with reserved coins prompts.
Contribution fields are locked while coins are reserved (#8026); addresses are validated before
reserving (#8034).

### Revised invitation (#8036)

If the coordinator edits the draft after sending, a participant pasting the newer Draft goes
through `followNewerInvitation` (`:3130-3235`): it is loaded only if this wallet's row (label,
amount, owner/refund/reward) and its contribution are unchanged (or still empty and refillable), no
other row uses this wallet's owner address, no reserved coin is spent, and its revision is not older
than the invitation already answered. Otherwise refused with "This newer invitation changes your
share…". Participant then re-sends Details. After freeze, any change requires "unlock terms", which
discards all approvals (`unfreeze`).

### Operator in the GUI

On Settings the coordinator either generates a BLS key in the wizard (then a "Save operator key"
page forces saving the secret — it is never put in the envelope — typing its last 4 chars to
confirm, and shows the `masternodeblsprivkey=` line) or pastes an operator's public key. "Node run
by" (`operatorSecretHolder`) is informational. Operator reward 0–100% with a warning that it is
permanent. Service address(es) checked not already in use.

### Maintenance envelope: `dash-shared-mn-sigs` v1 (`src/qt/sharedmndialogs.cpp:64-65, 653-665`)

```json
{"type":"dash-shared-mn-sigs","version":1,"network":"test","kind":"dissolve"|"registrar",
 "proTxHash":"<hex>","tx":"<unsigned ProDisTx / ProUpSharedRegTx hex>",
 "signatures":[{"shareIndex":0,"signature":"<base64>"}],"fingerprint":"XXXX-XXXX"}
```
One person prepares ("Copy Request"/"Save Request…", `*.json`), everyone "Approve and Copy Reply",
replies in any order; registrar rotation must be sent from the wallet that prepared it.

### Standby dissolution file

Text file `standby-dissolution-<proTxHash[0:8]>-share<k>.txt` with a header and two raw hex lines:
"FULL PRINCIPAL — valid from block H" and "IMMEDIATE — pays the X early-exit penalty"
(`src/qt/sharedmndialogs.cpp:1720-1753`). Either line is broadcast with `sendrawtransaction`.
Pasting the hex into the list opens the dissolve dialog.

---

## 6. What an external coordinator site can do without custody

Can legitimately do (no keys, no coins):
- **Matching / term sheet**: participants, amounts (duffs, ≥100 DASH each, sum 1000), early period
  and penalty (validate `penalty < min share`, `period ≤ 420480`, `penalty == 0 iff period == 0`),
  operator, operator reward, service IP, voting-key holder. Reproduce `AreShareAmountsValid` /
  `IsEarlyPenaltyValid` / `IsShareListTriviallyValid` client-side.
- **RPC path**: generate the exact `createrawtransaction` and `protx shared_register_prepare` command
  lines from collected public data (owner/refund/reward addresses, outpoints, change), then relay
  `tx` hex and signature entries; show who signed. Anyone can run prepare/combine; the site could even
  run a v24 node to do so, since those steps use no keys.
- **Validate blobs**: decode the ProRegTx v3 payload (layout `src/evo/providertx.h:170-235`),
  recompute `SharedRegConsentHash` and verify each base64 65-byte compact sig recovers the share's
  owner key ID (low-S, header 27–34; digest is the raw 32-byte uint256 — mind byte order). Check
  inputs/outputs against what each participant declared (change present, collateral last, nLockTime 0,
  sequences final). Report which funding inputs have scriptSigs.
- **GUI path relay**: act as a mailbox for `dash-shared-mn-session` JSON (and `dash-shared-mn-sigs`),
  display stage, revision, session code and fingerprint, which rows are filled, which approvals are
  present and valid, which inputs are signed; check `network`. It should pass envelopes through
  verbatim and never edit them (any edit changes the fingerprint and, after freeze, breaks
  verification).
- **On-chain monitoring**: `protx info <hash>` / `protx list registered|valid true` (detailed) show
  `state.shares[] {amount, refundAddress, refundScript, rewardAddress, rewardScript, ownerAddress}`,
  `earlyPeriodBlocks`, `earlyPenalty`, `registeredHeight`, `PoSePenalty`, `PoSeBanHeight`,
  `pubKeyOperator`, `votingAddress`, `operatorPayoutAddress`; no singular `ownerAddress`/`payoutAddress`
  for shared MNs (`src/evo/dmnstate.cpp:94-104`, `src/evo/providertx_util.cpp:66-86`).
  `masternodelist json` reports comma-separated owner addresses and can be filtered by any share owner
  address. Detect shared registrations by the template output `04445348437551`. Payouts: watch
  coinbase outputs to each `rewardScript`; expected split = `SplitAmountByShares`. Compute
  penalty-free height = `registeredHeight + earlyPeriodBlocks`. Watch for ProDisTx (type 10) spending
  the collateral.

Cannot do / must not do:
- Seed the coordinator's Qt session: a site-produced envelope imported into Dash-Qt makes the importer
  a Participant unless `prepareWallet` equals their wallet name and the `coordinatorLabel` row already
  carries an owner address their wallet holds (`coordinatedHere`). Practically, a human coordinator
  must click "Start a Shared Masternode" in Dash-Qt and type the agreed terms; the site can give them
  a checklist/term sheet and verify the resulting invitation matches the agreed terms.
- Produce consent signatures, funding signatures, or BLS secrets for users.

Pitfalls:
- **Per-share, not per-input consent**: a participant must confirm *their* share row (amount, refund,
  owner, reward) and *their* change output before signing inputs; signing an input into a table
  without their share donates it.
- **Coordinator rewrites**: consent sigs bind everything, so post-consent changes invalidate sigs
  rather than steal; but pre-freeze the coordinator controls the draft (rows, terms, fee). The Qt
  wallet defends its own row/coins; a website must too (show diffs between revisions).
- **Withholding**: any participant can stall registration forever by not signing consent or funding
  inputs, or by spending a reserved coin (local locks only). Atomic: nobody loses funds, but others'
  coins sit locked until released. Set deadlines; let others release.
- **Last-minute changes**: any change to inputs, outputs, sequences, locktime, operator/voting key,
  service, or terms after freeze needs a fresh round of all N consents.
- **Time locks**: `shared_sign` refuses non-final nLockTime / BIP68 sequences without
  `allowTimeLocks`; a site should never produce such txs.
- **Malleability**: registration txid can be malleated by co-signers (P2PKH input scriptSigs), but
  nothing is pre-signed against it; ProDisTx is non-malleable by design.
- **Zero penalty**: anyone can force an early exit for only the fee; Core warns (`ZERO_PENALTY_WARNING`).
- **Obstruction after registration**: one unresponsive owner blocks operator/voting rotation and
  unanimous dissolve; only unilateral dissolve remains (penalised during early period). If the
  operator vanishes and an owner won't sign rotation, the MN stays PoSe-banned (no rewards) until
  someone dissolves.
- **Privacy**: share table (amounts, refund/reward/owner addresses) is public forever and every
  payout clusters co-owners' scripts; refunds return as large non-denominated outputs; refund
  addresses are pre-committed for years (`dip-shares.md:882-897`). Fresh addresses per formation.
- **Non-enforcing chains**: template is anyone-can-spend to pre-v24 nodes; irrelevant on the real
  chain post-activation, but a v22/v23 explorer/API will misreport these txs (the public
  digitalcash.dev RPCs are still 22.1.3).
- **Key custody**: owner keys must live in a Dash Core (or custom) wallet able to sign raw compact
  digests; hardware-wallet `signmessage` flows won't work. Owner key ≠ refund key.

---

## 7. Operator role

- The operator **does not have to be a share owner**; it is any party holding the BLS secret. The
  share table and operator are independent fields; nothing links them.
- Supplies **before registration**: BLS public key (basic scheme; `bls generate`), service
  `IP:PORT` (optional at registration; first entry must be IPv4 on mainnet), agreed
  `operatorReward` (0–100%, immutable for the MN's life — not changeable by any later tx). For
  EvoNodes (future): `platformNodeID`, Platform P2P and HTTPS addresses (bound into the consent
  digest).
- Supplies **after registration**: runs the node with `masternodeblsprivkey`, and sends ProUpServTx
  (`protx update_service`) to set/fix the service and to set an operator payout address. Without an
  operator payout address the operator reward is not paid (owners keep it). Can revoke itself
  (ProUpRevTx) → MN PoSe-banned until owners unanimously set a new key (ProUpSharedRegTx) and the new
  operator sends ProUpServTx.
- Operator key must be unique network-wide under either BLS encoding (`bad-protx-dup-key`,
  `src/evo/specialtxman.cpp:1379-1386, 1761-1766`).
- Operator cannot touch principal or rewards beyond its percentage; it is not a signer of the
  registration, dissolution, or share updates.
- Voting key is separate from the operator; one P2PKH key for the whole MN, chosen by the group.
