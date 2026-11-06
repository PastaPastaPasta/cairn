# Tegara (hilawe/dash-tegara-mn-pooling): summary for a shared-MN matching/coordination product

Source: `hilawe/dash-tegara-mn-pooling` (HEAD 408b17c). Read only, nothing run. Paths below are relative to that repo.
Caveat: only 8 docs are published. Many cited docs (IMPLEMENTATION_STATUS, GUIDED_MEMBER_TRIAL, MEMBER_APPROVAL_DESIGN, RETAIL_PRINCIPAL_SPLIT, E2_BUILD_SPEC) are NOT in the repo. The "live runners" are unpublished too (README.md). All of it was built against #187 drafts and v24.0.0-rc.1, so every chain fact needs re-checking against merged #7437 / final v24.

## 1. Architecture and trust model (DESIGN.md, README.md, docs/TEGARA_EXPLAINER.md)
- L1 holds all principal and the reward split. Shared MN (#187 / dash#7437): 2-8 participants fund the collateral in one registration tx, each with an immutable refund script. Collateral is a covenant spendable only by a consensus dissolution tx (ProDisTx) that pays each refund script. DIP-0026 splits the owner reward across the participants' reward scripts. ProUpShareTx updates a participant's reward script.
- Platform holds only accounting and coordination, no value: pool record, slot reservations, share records, completion receipt, reward-distribution records, vote preferences, member term approvals. Every document is signed by the member's own identity.
- Invariant (DESIGN.md "Non-custodial trust invariant"): for a direct participant, principal recovery never depends on a coordinator, operator, committee or Platform liveness. Worst case is a liveness delay (waiting for dissolution), never loss. Platform trust points bound rewards only.
- Operator/coordinator CAN: create the pool record (owner-only creation), advertise it, serialise admission, register the shared MN on L1, run completion (freeze member list, verify the registration against it, publish the receipt), and run reward distribution in the retail/Platform-credit tier.
- Operator/coordinator CANNOT: move principal, change a member's owner key or refund script (immutable after registration), edit or delete the pool or receipt (immutable, non-deletable), or sign for a member.
- Residual operator powers they admit: the pool/receipt only record what the operator recorded, not L1 truth. The "join/exit" handover is accounting only and moves no value. Reward distribution through the operator can be delayed or misstated (checkable after the fact). Completion is operator-coordinated, not consensus-atomic with reservations. A last-slot race can make a pool that completion later refuses (nothing lost, slots can be released).
- Two tiers. v1 is the direct co-owner tier only (2-8 people). The "retail" tier (many sub-funders behind one slot) is explicitly out of scope: the intra-group principal split is not trustless.
- Chosen primitives: no multisig and no pre-signed refunds, no new DIPs.

## 2. Requirements checklist (docs/POOLED_MASTERNODE_REQUIREMENTS.md)
Legend: M = relevant to a matching/coordination product that hands off to Core's native shared-MN flow. L = only if we run ledgers/distributions ourselves.
- C1 No party takes custody of another's funds, even transiently: M (we must never escrow, and must not sit in the funding path).
- C2 Every position-changing transition signed by that member's own key: M (applies to listings, applications and acceptances; no shared signer).
- C3 No multisig plus pre-signed refunds: M, as a design guard. Core's native flow already avoids it, so just never offer a "pool then register" shortcut.
- C4 Owner key and refund destination immutable after registration: M. Matching must settle terms (shares, refund/reward addresses) BEFORE registration. Changing a position means dissolution and re-registration.
- C5 Build only on shipped primitives: M.
- Trust invariant (principal never depends on L2 liveness or any actor in the reward path): M. Platform down must not strand funds. It also implies the product must not be required for exit.
- R1 Value actually settles, bound to an on-chain fact: L (settlement of join/exit handover between members). M only if we offer a "take over my share" feature, which we should not.
- R2 Atomic or fail-safe settlement: L. For M, the analogue is that a failed match leaves no half-committed state (listing reverts to open).
- R3 No queue-wedging by an invalid request: M (one bad application must not block a listing).
- R4 Verifiable reward destination, controlled by the member and bound to their request: M. The reward address chosen at application must be what ends up in the registration. Tegara's version-2 approval compares the signed terms with the decoded tx.
- R5 Independent verifiability from public L1 + L2 state: M in part. A third party should be able to check that the registration matches the agreed terms. The distribution-recompute part is L.
- R6 Liveness independent of the operator: M for formation (the coordinator must not be able to block, redirect or freeze a registration, and members' cancel/exit should not need the operator). The distribution part is L.
- Participation floor: 100 DASH min per share, 2-8 shares, about 125 DASH each at 8 equal shares; 1000 DASH regular MN only: M (drives the matching UI and validation).
- No on-demand exit in v1 (position bound to the collateral construction): M (say so in the UI; any early-exit penalty terms must be shown).
- Governance: tally members' preferences, non-voters follow the result, proportional outcomes need several nodes: L for the tally. M only if we expose voting preferences. Checkability by publishing prefs and balances.
- Vocabulary: avoid financial-instrument language (use funder, member, share, pool, collateral, contribution): M (copy/legal).

## 3. Chain/Platform lessons and pitfalls (docs/POOLED_MASTERNODE_LESSONS.md, NONCE_OWNERSHIP.md, TEGARA_REFERENCE.md sec 7)
Chain:
- No SegWit, so txids are malleable by the input owners, and pre-signed refunds are unsound.
- External-collateral registrations can be replaced by anyone who can sign with the collateral key, so use internal collateral (the shared-MN flow mandates it).
- Payout array cap is 8 (deployed code), not 32. The min owner share is 100 DASH.
- A dissolving participant can omit its own refund output and the value becomes fee (DESIGN.md, from the #187 spec snapshot). This is a wallet check (refund output present, max fee) and was not built.
- Reward-redirection authority (owner/operator keys) is a separate problem from principal. Forbidding ProUpServ/operator update removes the only operator-replacement path.
- Dash block hashes are X11. BLS verifies only under the legacy scheme (`@dashevo/bls` basic namespace).
- An omitted reward address decodes to the refund address (rc.1), so compare destinations, not serialized scripts (platform/src/scripts/registrationTerms.cjs).
Platform:
- Credit transfer sender == recipient is refused (a member who is also the income identity needs a no-transfer settlement). There is a minimum transfer amount, so carry remainders forward.
- Only registered indices are queryable, and the where-clause must match one. At most 2 index properties may be left unconstrained (query-depth rule). Design queries and indices together.
- Proof metadata is not exposed by every SDK route. A served answer is not a verified answer; treat a read without a proof as unresolved.
- Native document transfer/purchase/update-price transitions exist, but the official JS SDK does not expose them (`dash-platform-sdk` on npm does, happy-path only).
- JS SDK (dash 7) signs only for wallet-derived identities. Immutable document types cannot be deleted via the SDK (it needs a revision), so a cancellable listing/claim must be a mutable type. For seedless signing they built `dash-rawkey-signer`.
- System reward-shares contract honours one share per masternode, so the Platform credit stream of an evo pool cannot be split by that route.
- Epoch history can be sparse (never assume contiguous epochs; a short page is not the end of history).
- First payout member controls an evo pool's Platform reward balance.
- Nonce ownership (docs/NONCE_OWNERSHIP.md): if one identity signs many transitions, assign the nonce once, durably, before signing. Needed only for batched/concurrent writers, but relevant if a coordinator identity writes many documents.
- Unique indices are the only consensus-level conflict control (e.g. unique (poolId, slotNo) stops two members taking one slot). Cross-document rules (a claim against a pool's lifecycle) can't be enforced by schema.
- A contract can gain document types by update but never change or remove one (permanent once registered). A read-only contract is possible (approval contract).
Process lessons: test the uncooperative party first, read deployed source for numbers, a passing test is evidence about the test, a skipped check must never return affirmative.
Scope caveat: the DESIGN.md claim "shared evo out of scope, type must be 0" is from the #187 draft snapshot; verify against the final #7437.

## 4. Platform data contracts (`platform/src/contract/poolLedger.ts`, `platform/src/scripts/contractV8/V9/V11.cjs`, `approvalContract.cjs`)
poolLedger.ts is only the v1 base: pool, share, membershipRequest, rewardAccrual, votePreference. Later versions (v3..v11) are built in code by the contractVN.cjs builders.
Canonical v11 = v9 (which extends v8) + 5 reward-rail types + memberFinalEpoch, 14 types in total. The hash fields are 32-byte byteArrays.
- `pool` (v9: immutable, non-deletable, owner-only creation): slotIndex (0-31), nodeType (regular|evo), operatorFeeBps, targetDuffs, optional slotDuffs+slotCount (both-or-neither, count <= 512). The operator is $ownerId. The proTxHash is NOT on the pool any more (set by the receipt). Index byOwner.
- `pledgeSlot` (mutable, so it can be cancelled): poolId, slotNo (<=511), rewardScript (<=34 bytes). Unique bySlot (poolId, slotNo), so the race for a slot is decided by consensus. Also byPool and byOwner.
- `completionReceipt` (immutable, owner-only, one per pool): poolId, proTxHash, slotIndex, allocationRows (canonical JSON preimage bytes), allocationHash, participantCount (1-8), l1Verification (demo-unverified | node-existence-only | amount-reward-verified), verificationMethodVersion, formatVersion. Unique byPool and (proTxHash, slotIndex). The "receipt last" pattern: the receipt is the completion and the pool is never edited.
- `share`: poolId, shareBps, contributionDuffs, l1RewardScript. Unique (poolId, $ownerId).
- `membershipRequest`: poolId, kind (join|exit), amountDuffs, status (pending|matched|settled), provenance, rewardScript. `settlement`: leaver/joiner, phases prepared..settled. Accounting only and not a value swap (matcher.cjs header says so).
- `votePreference`: poolId, proposalHash, choice (yes|no|abstain|delegate|donothing, CrowdNode's five), delegateTo. Unique (poolId, $ownerId, proposalHash).
- Reward rail (v11, all immutable and owner-only): epochHeader (poolId, epochIndex, gross/feeCredits, allocationHash, memberCount<=8), platformAccrual (poolId, funderId, epochIndex, amountCredits, shareBps; unique per member-epoch), transferReservation (accrual -> transitionHash, unique), transferReceipt (+proof bytes, block metadata, quorumHash), receiptProofPart, memberFinalEpoch (unique per pool+member).
- Separate member-approval contract (`approvalContract.cjs`, read-only, one type `memberTermsApproval`): poolId, termsRevision, record (<=4096 B canonical record), ownerSignature (65 B). Requires HIGH-or-above key and `$createdAtCoreBlockHeight`. The unique index is led by `$ownerId`, so nobody can squat another member's (pool, revision) slot. The record binds the Platform identity + L1 owner key + chain/contract IDs + the registration terms (version 2 uses the chain's own units) + a notAfterHeight window. At completion the signed terms are compared with the decoded registration (`memberApproval.cjs`, `registrationTerms.cjs`, `coownerCompletion.cjs`).
- Notable for us: the approval contract is the closest match to a "co-owner accepts terms" document. Their pool/receipt/E2 types are operator-ledger material.

## 5. UX / user-story material worth reusing
(Mostly in `platform/src/scripts/memberTrial.cjs`, `coordinatorTrial.cjs`, `memberUiApi.cjs`, `registrationTerms.cjs`; the GUIDED_MEMBER_TRIAL doc itself is not published.)
- Member trial: the member records the terms they agreed to BEFORE seeing any proposal. The tool then compares the proposal term by term, with the decision first, an aligned comparison and the full signed details. A first version let the member type the figure after seeing the proposal, and altered terms were approved live. The coordinator sends a genuine and an altered proposal (random order; the alterations change amounts, then period/penalty/operator reward, then the member's fee share) as a phishing-resistance test.
- Rules: what the member confirms is exactly what is signed, with no extra info on the confirmation screen. Asking twice before refusing a proposal that matches. "Refusal" is a recorded action. A flag when a proposal was refused before.
- Formation story: operator advertises a pool, members reserve slots with their own reward address, can cancel freely until it closes, the operator registers, and completion freezes the list and publishes the receipt. Join check: refuse to join if a verifying receipt exists (pool completed). Otherwise join only if the operator explicitly named this pool out-of-band; open/in-flight/abandoned pools look identical on the ledger.
- Local-only member page bound to 127.0.0.1 with an anti-rebinding and CSRF gate and a one-time token (`memberUiApi.cjs`). Passphrase opens the store per request.
- Churn is documented only as accounting (exit + matching join, equal amounts, oldest first). Nothing to reuse for real settlement since v1 has no on-demand exit.
- Governance preferences: CrowdNode's five options (yes/no/abstain/delegate/donothing), non-voters follow the tally. The vote watcher only corroborates, because a vote signature can't be observed without a Core change.
- Floor and exit messaging: 100 DASH min, about 125 DASH at 8-way equal split, no on-demand exit. State this plainly.
- Terms to show: per-share amount, owner/refund/reward addresses, operator reward (bps, a 525 <-> "5.25" display), early-exit period (<= 420480 blocks) and penalty (below the smallest share), per-member registration fee share.

## 6. License and credit
- MIT, "Copyright (c) 2026 hilawe" (`LICENSE`). README.md credits "Author @hilawe". Related MIT lib `dash-rawkey-signer` (github.com/hilawe/dash-rawkey-signer), used for seedless signing.
- Any copied code or schema text needs the MIT notice. Ideas are free to borrow, but credit is courteous: the "receipt last / immutable pool", the approve-agreed-terms-first member flow, and the decoded-registration comparison invariant are theirs.
- Their design acknowledges prior art from CrowdNode (the five vote options, CrowdNode KB verbs) and the CrowdNode-successor memo (July 2026). Those are not covered by this license.

## Notes / inconsistencies to be aware of
- Docs predate final v24: they refer to #187 as an unmerged draft, v24.0.0-rc.1 and "as of September 30, 2026". The NOTE in DESIGN.md that shared MNs are regular-only and the 100 DASH minimum come from the #187 spec snapshot (`sources/pr187-spec-snapshot-2026-07-10.md`, not in the repo). Re-check against merged #7437 and final v24 before relying on any of these numbers.
- `poolLedger.ts` allows slotIndex 0-31 while the real cap is 8; and `Participants` is 1-8 in the receipt.
- The repo's own status claims: prototype, no real funds, not audited, never run on mainnet/public v24; an L1->L2 relay is trusted and not proven.
- Only the offline pure-core tests are published (`npm test`). The live runners are not.
