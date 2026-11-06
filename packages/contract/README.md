# @cairn/contract

The `cairn` Dash Platform data contract (DESIGN.md section 7): one contract per network, same schemas.

| Network | Contract id | Owner identity | Registered | Fee |
|---|---|---|---|---|
| testnet (PV14) | `9Zv3f6uyGfrnCsqNLUajVmJ5AWwjKLwpt31sBQZm3TUz` | `5tjhGV6gSQcaJBUBbCSNJNHN4ompj5QiXDKXFqdV7T3Y` | 2026-11-06 | 0.40336635 DASH |
| mainnet | not yet (needs ~0.45 DASH) | | | |

`deployments.json` is the one place the ids live; the web app and scripts read it.

## Types (9 types, 16 indexes)

All types: `additionalProperties: false`, HIGH key (`signatureSecurityLevelRequirement: 2`), not transferable, owned by the
writer's identity. Amounts are **duffs**. JSON-string fields carry compact JSON with an explicit `maxLength`.

| Type | Mutable | Fields (required in bold) | Indexes |
|---|---|---|---|
| `profile` | yes | **displayName** 1..64, about ≤500, contacts (JSON ≤1024: discord, yappr, telegram, matrix, dashpay, website), roles (bits: 1 member, 2 operator) | `byOwner` unique `[$ownerId]` |
| `operator` | yes | **name** ≤64, **rewardBps**, rewardMinBps, rewardMaxBps, regions (JSON ≤256), hosting ≤1000, capacity, claimedProTx (JSON ≤1500), **status** | `byOwner` unique; `byStatus [status, $updatedAt]` |
| `looking` | yes | **amount**, operatorId?, **maxRewardBps**, earlyPref (JSON ≤256), **canCoordinate**, note ≤500, **status** | `byOwner` unique; `byStatus [status, $updatedAt]` |
| `group` | yes | **title** ≤80, about ≤1000, **mnType**, operatorId, **rewardBps**, **earlyPeriodBlocks** ≤420,480, **earlyPenalty**, coordinatorId, votingHolderId, votingPolicy ≤280, chatUrl ≤256, formBy, **roster** (JSON ≤2048 `[{id, amount, label?}]`), **revision**, lockedHash 32 B, operatorPubKey 48 B, service ≤64, proTxHash 32 B, **status**, refillOf, votingAddress 26..35, flags (bit 0: open amounts) | `byStatus [status, $updatedAt]`; `byOperator [operatorId, status]`; `byOwner [$ownerId]` |
| `seat` | yes | **groupId**, **amount**, message ≤280, **status**, flags (bit 0 can coordinate / has Dash-Qt v24 on a desktop, bit 1 willing to hold the voting key), votingAddress 26..35, proTxHash 32 B | `byGroupOwner` unique `[groupId, $ownerId]`; `byOwner [$ownerId]` |
| `invite` | yes | **groupId**, **toId**, **amount**, message ≤280, **status** | `byTo [toId]`; `byGroup [groupId]` |
| `approval` | no (deletable: withdraw consent) | **groupId**, **revision**, **termsHash** 32 B, **shareAmount** | `byGroupRevisionOwner` unique `[groupId, revision, $ownerId]` |
| `opAccept` | yes | **groupId**, **status** (1 accepted, 2 declined, 3 withdrawn), operatorPubKey 48 B, service ≤64, rewardBps, message ≤280 | `byGroupOwner` unique `[groupId, $ownerId]`; `byOwner [$ownerId]` |
| `vault` | yes | identical to govhub's `forum.vault` (passkey vault of the vendored `@cairn/auth`) | `byCredential` unique `[$ownerId, credentialId]` |

Mutable types require `$createdAt` and `$updatedAt`, `approval` requires `$createdAt`; `createOp` / `replaceOp` stamp them
(Drive overwrites them with block time).

Decisions:
- `group.operatorId` is optional: a member-led group whose operator is still to be chosen leaves it out, and `toGroup` reads that
  as `null`. Platform enters a document without the value under null in the non-unique `byOperator` index (`nullSearchable`
  defaults to true since PV1, and DPNS indexes its optional `records.identity` the same way), so `groupsOfOperator` is unaffected.
  Every other indexed property is required (govhub's convention, which keeps unique indexes unique); `test/contract.test.ts`
  allows only this one exception, and only in a non-unique index.
- `opAccept` is the operator's side of a member-led group: the operator cannot write the organizer's group, so they accept,
  decline or withdraw in their own document, with their BLS key, service and the reward they accept. Accepting a group with no
  operator yet is an offer. The organizer copies key, service and reward into the group before locking; in an operator-led
  group the operator is the organizer and the group carries them directly.
- `seat.votingAddress` comes from the member the group chose to hold the voting key; the organizer copies it into
  `group.votingAddress` (term sheet field `votingAddress`), required from lock on. `seat.proTxHash` lets the coordinator, who
  is a co-owner but rarely the organizer, link the registration; Cairn checks it against the chain and the approvals.
- Roster labels are the row labels typed into Dash-Qt; they live in the roster so every member computes the same term sheet.
- Statuses are small integers (`schema.ts`): indexed strings would cost more and invite typos. `group.status` is the organizer's
  claim; live/dissolved/banned are recomputed from the chain on read.
- Schema bounds are caps that hold for every Dash Core version Cairn targets: amounts ≤ 4000 DASH (room for shared EvoNodes), the
  early period ≤ 420,480 blocks and the operator reward ≤ 10,000 bps, exactly Core's limits. The rules that depend on the rest of a
  document (≥ 100 DASH per share, sum 1000, ≤ 8 shares, penalty below the smallest share and only with a period, services Core
  accepts, P2PKH voting addresses) are enforced by the models through `@cairn/shares`, on write and on read.
- Everything stored is public. A contact handle the user keeps private is simply not stored.

## Queries

`src/queries.ts` builds every query the app sends and runs it through govhub's PV13 lint (`queryLint.ts`, rules in govhub
`packages/contracts-v1/README.md`): equality prefix plus one range on the next property, no gaps, `orderBy` pinning the index,
newest-first lists with a no-op `$updatedAt > 0` range and bound paging (never `startAfter` with `desc`), byte arrays base64,
identifiers base58. `test/queries.test.ts` asserts the index each query lands on.

## Validate and register

```
npm test -w @cairn/contract                          # lint + evo-sdk 5.0.0-rc.8 full validation at PV13 and PV14
cd packages/contract/scripts/validate && npm ci && npm run validate   # + wasm-dpp 4.1.1 / 5.0.0-rc.8: negative controls, and
                                                     #   MAX/MIN/over-limit documents of every type through a batch transition
node --experimental-transform-types packages/contract/scripts/register.ts testnet init|status|fund|contract|retire
```

`register.ts` follows govhub's `mainnet-bootstrap.ts`: the deployer seed lives only in the shared secret store
(`secret get cairn/testnet-deployer`, linked at `~/.local/share/cairn/testnet-deployer.json`); the contract transition is
signed once at a fixed nonce and saved before the broadcast, so a rerun can only re-send the same bytes.
Contract updates under PV13/PV14 can only add types, never change one or add an index: get a schema change right before mainnet.
