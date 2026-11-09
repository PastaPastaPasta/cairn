# Cairn — design requirements

> **Cairn**: build a masternode together.
> A Dash HQ product at `cairn.dashhq.org` for finding co-owners and an operator, agreeing on terms,
> and walking everyone through Dash Core's own shared-masternode flow.

A cairn is a pile of stones that travellers build together, each adding one. No single stone is the
cairn, and nobody owns the others' stones. That is how Dash Core v24 shared masternodes work: 2 to 8
people each bring 100+ DASH, and consensus keeps every share in its owner's control.

Status: draft r1, 2026-11-06. Research notes are in `docs/research/`:
- `core-shared-mn.md` covers the Dash Core v24 consensus rules, RPCs and Dash-Qt session format, with
  citations.
- `govhub-survey.md` covers what we reuse from gov.dashhq.org.
- `tegara-summary.md` covers lessons from hilawe's Tegara prototype.

---

## 1. Premise and principles

Dash Core v24 (dash#7437, DIP draft dips#187) ships **shared masternodes** for regular masternodes:
- 2–8 shares, each at least 100 DASH, summing to exactly 1000 DASH.
- The collateral is paid to a consensus-locked template output, and only a dissolution transaction
  can spend it.
- Every share has its own owner key, its own immutable refund address and its own reward address.
- Consensus splits the owner reward by share amount in every payout block. Nobody distributes it.
- Registration is a single atomic transaction. Every owner signs consent to the exact table and
  terms, then signs their own coins.
- Any owner can leave alone at any time. That dissolves the masternode and refunds **every**
  principal. Leaving before the agreed early period ends pays the agreed penalty to the others.

What is missing is everything around the transaction: finding each other, agreeing on an operator
and terms, trusting that the invitation you paste is the one you agreed to, and knowing what to do
once the masternode is live. Cairn is that layer.

**Principles (hard rules):**

1. **Never custodial.** Cairn never holds, escrows, routes or signs coins or keys. All money moves in
   the co-owners' own Dash Core wallets. No backend is in the money path.
2. **Dash Core is the source of truth.** We guide users through Dash-Qt's own "Shared Masternode"
   wizard (and the `protx shared_*` RPCs for CLI users). We check its messages and the chain. We never
   build a parallel transaction format.
3. **Agree first, then verify against what you agreed.** Each member records the exact terms on
   Platform (a signed approval) *before* any Dash-Qt message exists. Every later artifact is checked
   against that record, never against what the coordinator says. This lesson comes from Tegara's
   phishing trial.
4. **Everything public is on Dash Platform.** Profiles, listings, groups, seats and approvals are
   Platform documents owned by the user's identity. The site is a static app, and anyone can run
   another front end against the same contract.
5. **Simple first.** A normal user sees one clear next step at a time. Raw hex, consent hashes and
   RPC lines sit behind a "Technical details" disclosure.
6. **No investment language.** Use co-own, share, rewards, operator, early-exit terms. Never say
   invest, yield, return, APY, pool or deposit. We publish no reward-rate promises; we link to Radar's
   measured rewards.
7. **Same login as Governance.** The sign-in, identity funding and Platform writer are vendored from
   govhub unchanged in behaviour (see §8). Dash Connect replaces this once the mobile wallets ship it.

**Non-goals (v1):**
- A "retail" tier below 100 DASH. It can't be trustless, so we don't do it.
- EvoNodes. Shared EvoNodes need `evo_shares` (bit 14), which no release signals yet. The data model
  leaves room for them.
- Fees or payments to Cairn. Cairn charges nothing.
- In-site chat. We store contact handles and an optional group-chat link (Discord, Yappr, Telegram,
  Matrix); conversation happens there.
- Monitoring or alerting infrastructure (Radar does that); we link to it.

---

## 2. Network reality (2026-11-06)

| | Testnet | Mainnet |
|---|---|---|
| v24 (shared regular MNs) | active since block 1,578,000 (2026-10-23) | signalling from 2026-11-09; earliest active ≈ block 2,580,480 (~2026-11-28) |
| Real shared MNs exist | yes (e.g. ProRegTx `d400c120…`) | no |
| Platform | PV14 | PV13 → 14 |

The product ships on **mainnet first-class** for matching, profiles and agreeing terms. Formation
steps that need v24 show a live activation card (from Radar's `/api/v1/mainnet/activation`) and
unlock when v24 activates. **Testnet is fully functional end to end**, and that is where we test.

---

## 3. People and roles

- **Member (co-owner)**: brings one share of 100–900 DASH (900 because at least two shares are
  needed). Holds the share's owner key, refund address and reward address in their own Dash Core
  wallet.
- **Operator**: runs the node. Supplies the BLS operator public key, the service IP:port and an
  operator reward % (0–100, permanent for that masternode). Need not be a co-owner, and never signs
  anything that moves principal.
- **Organizer**: whoever opens a group: an operator ("operator-led") or a member ("member-led"). The
  organizer accepts seats, sets terms and locks them.
- **Coordinator**: the one member who runs Dash-Qt's "Start a Shared Masternode", pays the ~0.001
  DASH network fee and broadcasts. Dash-Qt only lets the session's originating wallet coordinate, so
  this must be a co-owner with Dash-Qt (desktop).
- **Voting key holder**: the one person who holds the masternode's governance voting key, chosen by
  the group. It defaults to the coordinator. Policy is free text, e.g. "votes as majority of shares
  decides in the group chat".

One identity can hold several roles. An operator can also be a member of their own group.

---

## 4. User stories

### Everyone (signed out)
- E1. See what Cairn is in one screen: how shared masternodes work, what you need (100+ DASH, Dash
  Core desktop wallet), what you never give anyone (keys, coins).
- E2. Browse groups and operators on mainnet or testnet with no account, and type an amount to see
  which groups it fits.
- E3. See live mainnet v24 activation status and what it unlocks.

### Member
- M1. Sign in or create an account exactly like gov.dashhq.org: new seed, send a little DASH (~0.005)
  to create a Platform identity, or restore. A passkey can unlock it later.
- M2. Make a profile with a display name (the DPNS username is shown if they have one), a short note
  and contact handles (Discord, Yappr, Telegram, Matrix, DashPay username, website). They choose
  which handles are public.
- M3. Say **how much they can bring** (the first question on Home and on `/groups`), and optionally
  the operator, the most operator reward and the longest early period they accept. Nothing is
  written: it is a question, kept in the address bar.
- M4. See **where it fits**: every group still taking seats that the amount fits under Core's rules
  (the remainder still works: 0 or ≥ 100 DASH, ≤ 8 shares), ranked by unmet preferences, then
  "completes it", then closest to 1000. Each is drawn with the member's stone in it ("With you,
  200 DASH still to find") and has one button, **Ask to join**. Below the list, always: **Start a
  group with your N DASH** (one click; terms can be set before lock). Starting a group alone *is*
  how a member waits to be found: there is no separate "looking" listing. See §4.1.
- M5. Request a seat in a group with an amount and a short message, and withdraw it before lock.
- M6. Open a **member-led group**: pick an operator from the directory (or "operator to be chosen"),
  propose terms, and invite people waiting alone in a group they started.
- M7. On a group page: progress to 1000, who's in (name, amount, contact handles), terms, operator,
  coordinator, voting-key holder, group-chat link, and **one clear next step for me**.
- M8. **Approve the locked terms.** A Platform document records a hash of the canonical term sheet,
  including my own row. The approval is the anchor that every later check compares against.
- M9. **Form the masternode with Dash-Qt**, guided step by step:
  - the coordinator gets a setup sheet with exactly what to type on each wizard page (copy
    buttons);
  - everyone gets a **message checker**: paste any `dash-shared-mn-session` message, and the browser
    shows the stage and session code, whether it matches the approved terms (my row, all rows,
    operator, reward, IP, voting address, exit terms), who has approved and signed, and whether it
    is safe to continue;
  - the checker never uploads the message.
- M10. After broadcast, link the ProTx hash. Cairn fetches the registration from the chain over
  DAPI, verifies it against every approval, and marks the group **Live (verified)**. A mismatch
  shows a clear red warning instead.
- M11. Live dashboard: status (valid or PoSe-banned) from the verified masternode list, my share of
  the owner reward, the block where the early period ends, and links to Radar and Governance. Also
  maintenance how-tos: save your standby dissolution, change the reward address, replace the
  operator (needs everyone), leave.
- M12. **Refill**: when someone leaves, the masternode dissolves. Remaining members can reopen a group
  with the same terms that needs only the leaver's amount, and it is ranked for anyone whose amount fits.

### 4.1 One list: why there is no "looking" board

An earlier version had two lists: groups, and members "looking" for a group. It made no sense to use:
two places to look, two things to post, and a looking post only did something if an organizer
happened to read it. Now there is one kind of listing, the group, and one question, how much you can
bring.

- With an amount, `/groups` ranks the groups it fits, drawn with you in them. Ask to join opens the
  group with your amount filled in.
- If none fits, or you prefer, you start a group with just yourself in it. It is listed immediately,
  so the next person whose amount fits sees it among their results. That is the match. If two
  people each started a group alone and one asks to join the other's, the other sees it flagged on
  their results, so they accept instead of both joining each other.
- Organizers see people **waiting alone in a group they started** whose amount fits what is left
  (with how their proposed terms differ), and sets of them that would complete the group. Invite
  works as before.
- Someone who joins another group while their own is still just them is offered, on My Cairn, to
  close the one they started.
- An operator alone in their own node is not "waiting" (they would not move); they are a group to
  join.

The `looking` document type is unused by the site and is dropped from the contract when mainnet is
registered.

### Operator
- O1. Operator profile: name, operator reward (default, and range they accept), regions, hosting
  description, how many more nodes they'll take, contact, website, and optionally the masternodes they
  already operate (listed as *claimed*, linked to Radar).
- O2. Open an operator-led group with their terms. They can cap it or let members propose amounts.
- O3. Get attached to member-led groups: accept or decline being their operator.
- O4. Before lock, supply the BLS operator public key and service IP:port for that group. These are
  validated (96-hex BLS, IPv4:port, port 9999 on mainnet).
- O5. After registration, a checklist: put `masternodeblsprivkey` on the node, send
  `protx update_service` with the operator payout address (without it the operator reward is not
  paid), and keep the node up.
- O6. **Track record, verifiable**: number of Cairn groups live and verified, their current
  valid/banned state, uptime as seen by the masternode list. This is computed from chain data, not
  from self-reports.

### Matching and safety
- S1. Seats and roster need both sides: a seat counts only when the member's `seat` document and the
  organizer's roster both list it.
- S2. Every amount rule is enforced as you type:
  - each share is ≥ 100 DASH;
  - the total is exactly 1000;
  - at most 8 shares;
  - the remainder is always completable;
  - the early-exit penalty is below the smallest share and zero when there is no early period;
  - the early period is at most 420,480 blocks.
- S3. Locking freezes terms and roster into a revision. Any later change bumps the revision and
  voids all approvals, visibly.
- S4. Block or hide a profile (client-side list). Report links go to the group chat; there is no
  central moderation in v1.
- S5. Warnings that matter:
  - zero penalty means anyone can leave anytime;
  - the operator reward % is permanent;
  - the share table and addresses are public forever, so use fresh addresses;
  - the owner key must live in a Dash Core wallet, not a hardware-wallet signmessage flow;
  - never share your BLS private key with the group unless you are the operator.
- S6. Deadlines: a group can set a "form by" date. After it, seat holders get a nudge to release
  reserved coins in Dash-Qt.

---

## 5. Information architecture

```
/                       Home: what Cairn is · how it works in 4 steps · open groups · CTA
/groups                 Find your group: "I can bring N DASH" → groups it fits, or start one; no amount → every group by stage
/groups/new             Open a group (operator- or member-led)
/g/:id                  Group page: progress, roster, terms, next step, chat link
/g/:id/form             Formation: setup sheet (coordinator), message checker, link ProTx
/g/:id/live             Live dashboard + maintenance
/looking                (redirects to /groups)
/operators              Operator directory
/operators/:id          Operator profile + verified track record
/me                     My stuff: my groups, my seats, my approvals, operator listing, profile
/check                  Standalone message checker (works without an account or group)
/learn                  Plain-language guide: shared MNs, roles, exit terms, risks, FAQ
/settings               Network (Mainnet/Testnet), account, passkeys
```

Sign-in is a sheet (as on Governance), opened only when an action needs it.

---

## 6. Group lifecycle

```
draft → forming → full → locked → forming-onchain → live → (dissolved | refilling)
            ↑         │       │
            └─ seat withdrawn / terms changed (revision++ voids approvals)
```

- **forming**: open for seats; the roster is below 1000.
- **full**: the roster sums to 1000 with valid shares. The organizer can still edit terms.
- **locked**: the organizer freezes terms and roster at revision R. Members approve the term sheet
  hash for R. When all have approved and the operator has supplied the key and IP, the status reads
  "ready to form".
- **forming-onchain**: the coordinator has started the Dash-Qt session (they mark it). Members use the
  message checker each round.
- **live**: a ProTx hash is linked and verified against every approval at revision R.
- **dissolved**: the chain shows a ProDisTx spending the collateral. Offer **Refill**.

All status the chain can know (live, dissolved, banned) is computed from the chain on read. The
document's status field is only the organizer's claim and is displayed as such.

---

## 7. Data on Dash Platform

One data contract per network, `cairn`, owned by a Cairn admin identity. Types (9 types and
16 indexes, about 0.45 DASH to register on mainnet; `packages/contract/README.md` has every field):

| Type | Owner | Mutable | Key fields | Indexes |
|---|---|---|---|---|
| `profile` | user | yes | `displayName`, `about`, `contacts` (JSON string: discord, yappr, telegram, matrix, dashpay, website), `roles` | `$ownerId` unique |
| `operator` | operator | yes | `name`, `rewardBps`, `rewardMaxBps`, `regions`, `hosting`, `capacity`, `claimedProTx` (JSON), `status` | `$ownerId` unique; `status,$updatedAt` |
| `looking` | member | yes | `amount` (duffs), `operatorId?`, `maxRewardBps`, `earlyPref`, `canCoordinate`, `note`, `status` | `$ownerId` unique; `status,$updatedAt` |
| `group` | organizer | yes | `title`, `operatorId?`, `rewardBps`, `earlyPeriodBlocks`, `earlyPenalty`, `coordinatorId?`, `votingHolderId?`, `votingPolicy`, `chatUrl`, `formBy`, `roster` (JSON `[{id, amount, label}]`), `revision`, `lockedHash?`, `operatorPubKey?`, `service?`, `proTxHash?`, `status`, `refillOf?`, `votingAddress?`, `flags` | `status,$updatedAt`; `operatorId,status`; `$ownerId` |
| `seat` | member | yes | `groupId`, `amount`, `message`, `status` (requested/withdrawn), `flags` (can coordinate, will hold the voting key), `votingAddress?`, `proTxHash?` | `groupId,$ownerId` unique; `$ownerId` |
| `invite` | organizer | yes | `groupId`, `toId`, `amount`, `status` | `toId`; `groupId` |
| `approval` | member | no (one per revision) | `groupId`, `revision`, `termsHash` (32 B), `shareAmount` | `groupId,revision,$ownerId` unique |
| `opAccept` | operator | yes | `groupId`, `status` (accepted/declined/withdrawn), `operatorPubKey?`, `service?`, `rewardBps?`, `message?` | `groupId,$ownerId` unique; `$ownerId` |
| `vault` | user | yes | same shape as govhub's passkey vault | as govhub |

Rules:
- The canonical **term sheet** is deterministic JSON. Its fields are:
  - `network`, `groupId`, `revision`
  - shares: ordered `[{memberId, label, amount}]`
  - `operatorPubKey`, `service`, `votingAddress`, `votingHolderId`, `rewardBps`, `earlyPeriodBlocks`,
    `earlyPenalty`, `coordinatorId`

  `termsHash = sha256("cairn-terms-v1\n" + canonicalJson)`. Approvals and `group.lockedHash` must
  match it. (Addresses are not in it: Dash-Qt collects them later. The checker verifies the parts
  the term sheet fixes, and each user confirms their own addresses in their wallet.)
- Reads use proved queries (evo-sdk). PV13 query rules are linted as in govhub.
- Users pay for their own writes. Cairn never pays fees for users (same policy as Governance).

---

## 8. Reuse from Governance (gov.dashhq.org)

Vendored with a `VENDORED.md` that records the source commit:
- `@govhub/auth`, the headless package: seed and DIP-13 keys, identity discovery, DAPI funding with
  asset lock and IS lock, top-up, recover, passkey vault, and the hardened single-signature document
  writer. Drop `proposal.ts` and `keyring/`, re-label `govhub/…` to `cairn/…`, and point the vault
  at the cairn contract.
- `@govhub/dapi` (whole): DAPI client, SML verification, ChainLocks, quorum proofs.
- Pieces of `@govhub/verify`: address, message, tx and bytes helpers, and the ProRegTx parser,
  extended for v3 shared payloads.
- The web auth sheet and session (`apps/web/src/{auth,session}`), the profile registry pattern, the
  vite CSP and WASM aliasing, and the Pages deploy workflow.

New package **`@cairn/shares`** holds the Dash Core v24 logic, pure TS and exhaustively unit-tested
against vectors from Dash Core's own tests and real testnet transactions:
- the amount, penalty and table rules (`AreShareAmountsValid`, `IsEarlyPenaltyValid`, …);
- a ProRegTx v3 shared payload codec and `SharedRegConsentHash`;
- compact signature recovery to the owner key ID;
- parse, verify and fingerprint for the `dash-shared-mn-session` v1 and `dash-shared-mn-sigs` v1
  envelopes, including the UniValue pretty-print rules;
- reward split (`SplitAmountByShares`), the end-of-early-period height and ProDisTx detection;
- the term sheet: canonical form, hash, and diff against an envelope.

---

## 9. Integrations (light-touch)

- **DPNS** usernames shown on profiles (the same names as Yappr and DashPay).
- **Yappr**: a contact handle linking to the user's yap.pr profile, and an optional group chat URL.
  No tight coupling.
- **Radar** (nodes.dashhq.org): v24 activation status, links for live MNs and operator-claimed MNs.
- **Governance** (gov.dashhq.org): "vote with this masternode" link for the voting-key holder.
- **Faucet** (faucet.dashhq.org): testnet funds for trying the full flow.

---

## 10. Brand and visual direction

- **Name**: Cairn. Lowercase wordmark `cairn` next to a mark of three stacked rounded stones (inline
  SVG). Each product keeps its own icon; this is ours.
- **Voice**: calm, plain, specific. "Bring 300 DASH. Two more people and Lena's node is ready."
- **Palette** (no purple):
  - stone neutrals: paper `#F5F2EC`, ink `#1E2226`, granite greys;
  - accent lichen green `#2F6B57`;
  - warm ochre `#C2832B` for progress and "your next step";
  - Dash blue `#008DE4` only where we mean Dash itself;
  - a dark mode built on wet slate.
- **Type**: "Bricolage Grotesque" for headings (warm, a little hand-made), "IBM Plex Sans" for UI,
  "IBM Plex Mono" for hashes and amounts. All self-hosted (fontsource), with no external requests.
- **Signature element**: the group progress bar is a stacked cairn. Each share is a stone sized by
  amount, coloured by state (requested, in, approved, signed). It reads at a glance: "650 of 1000,
  three stones".
- Sharp at 2× DPR, mobile-first, AA contrast, keyboard-complete.

---

## 11. Delivery plan (iterative)

1. **Foundation**:
   - repo, vendored auth/dapi/verify, app shell and brand, network profiles;
   - `@cairn/shares` codec with test vectors;
   - the testnet contract;
   - CI and Pages deploy to `cairn.dashhq.org` (testnet default until mainnet contract).
2. **Matching**: profiles, operators, groups, seats, invites, roster, matching and
   suggestions, filters.
3. **Agree**: lock, term sheet, approvals, operator key and IP intake, readiness.
4. **Form**: coordinator setup sheet, message checker (all stages), ProTx link and on-chain
   verification, CLI path drawer.
5. **Live**: dashboard, maintenance guides, refill, operator verified track record.
6. **QA and review**:
   - code-review-validator and an adversarial review of `@cairn/shares` and the checker;
   - agentic QA on testnet, including a real 3-party shared MN formed from Dash-Qt/dashd v24;
   - fix loop.
7. **Mainnet**: register the mainnet contract (needs ~0.5 DASH from pasta), default to Mainnet for
   matching, and form-on-chain unlocks automatically at v24 activation.

Later:
- an encrypted session mailbox on Platform (messages HPKE-sealed to group members) so nobody has to
  pass JSON through Discord;
- Dash Connect sign-in;
- EvoNode groups once `evo_shares` ships.

---

## 12. Open questions for pasta (not blocking)

- The name: **Cairn** is the working choice. Alternates considered: Tandem, Muster, Keystone, Mesa.
- Mainnet contract funding (~0.5 DASH), once the testnet version is proven.
- Should Cairn ship a "Cairn verified" operator tier based on more than chain data, e.g. an
  interview? It is not planned; chain-verified track record only.

Credit: ideas on the agree-first anchor, the zero-penalty warning and the non-custodial requirements
come from hilawe's [Tegara](https://github.com/hilawe/dash-tegara-mn-pooling) (MIT).
