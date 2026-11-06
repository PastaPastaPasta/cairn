# @cairn/contract

The `cairn` Dash Platform data contract (DESIGN.md section 7): one contract per network, same schemas.

| Network | Contract id | Owner identity | Registered | Fee |
|---|---|---|---|---|
| testnet (PV14) | `9Zv3f6uyGfrnCsqNLUajVmJ5AWwjKLwpt31sBQZm3TUz` | `5tjhGV6gSQcaJBUBbCSNJNHN4ompj5QiXDKXFqdV7T3Y` | 2026-11-06 | 0.40336635 DASH |
| mainnet | not yet (needs ~0.45 DASH) | | | |

`deployments.json` is the one place the ids live; the web app and scripts read it.

## Types (8 types, 14 indexes)

All types: `additionalProperties: false`, HIGH key (`signatureSecurityLevelRequirement: 2`), not transferable, owned by the
writer's identity. Amounts are **duffs**. JSON-string fields carry compact JSON with an explicit `maxLength`.

| Type | Mutable | Fields (required in bold) | Indexes |
|---|---|---|---|
| `profile` | yes | **displayName** 1..64, about ≤500, contacts (JSON ≤1024: discord, yappr, telegram, matrix, dashpay, website), roles (bits: 1 member, 2 operator) | `byOwner` unique `[$ownerId]` |
| `operator` | yes | **name** ≤64, **rewardBps**, rewardMinBps, rewardMaxBps, regions (JSON ≤256), hosting ≤1000, capacity, claimedProTx (JSON ≤1500), **status** | `byOwner` unique; `byStatus [status, $updatedAt]` |
| `looking` | yes | **amount**, operatorId?, **maxRewardBps**, earlyPref (JSON ≤256), **canCoordinate**, note ≤500, **status** | `byOwner` unique; `byStatus [status, $updatedAt]` |
| `group` | yes | **title** ≤80, about ≤1000, **mnType**, **operatorId**, **rewardBps**, **earlyPeriodBlocks**, **earlyPenalty**, coordinatorId, votingHolderId, votingPolicy ≤280, chatUrl ≤256, formBy, **roster** (JSON ≤1024 `[{id, amount}]`), **revision**, lockedHash 32 B, operatorPubKey 48 B, service ≤64, proTxHash 32 B, **status**, refillOf | `byStatus [status, $updatedAt]`; `byOperator [operatorId, status]`; `byOwner [$ownerId]` |
| `seat` | yes | **groupId**, **amount**, message ≤280, **status** | `byGroupOwner` unique `[groupId, $ownerId]`; `byOwner [$ownerId]` |
| `invite` | yes | **groupId**, **toId**, **amount**, message ≤280, **status** | `byTo [toId]`; `byGroup [groupId]` |
| `approval` | no (deletable: withdraw consent) | **groupId**, **revision**, **termsHash** 32 B, **shareAmount** | `byGroupRevisionOwner` unique `[groupId, revision, $ownerId]` |
| `vault` | yes | identical to govhub's `forum.vault` (passkey vault of the vendored `@cairn/auth`) | `byCredential` unique `[$ownerId, credentialId]` |

Mutable types require `$createdAt` and `$updatedAt`, `approval` requires `$createdAt`; `createOp` / `replaceOp` stamp them
(Drive overwrites them with block time).

Decisions:
- Indexed properties must be required (govhub convention), so `group.operatorId` is required and a member-led group without an
  operator stores the zero identifier `NO_OPERATOR` (`1111…1`); `toGroup` reads it back as `null`.
- Statuses are small integers (`schema.ts`): indexed strings would cost more and invite typos. `group.status` is the organizer's
  claim; live/dissolved/banned are recomputed from the chain on read.
- Schema bounds are sanity caps (amounts ≤ 4000 DASH to leave room for shared EvoNodes, early period ≤ 4,204,800 blocks). The
  Dash Core v24 share rules (≥ 100 DASH per share, sum 1000, ≤ 8 shares, penalty rules, 420,480-block early period) are enforced by
  `@cairn/shares`, not the contract, because a registered contract can never tighten or loosen a type.
- Everything stored is public. A contact handle the user keeps private is simply not stored.

## Queries

`src/queries.ts` builds every query the app sends and runs it through govhub's PV13 lint (`queryLint.ts`, rules in govhub
`packages/contracts-v1/README.md`): equality prefix plus one range on the next property, no gaps, `orderBy` pinning the index,
newest-first lists with a no-op `$updatedAt > 0` range and bound paging (never `startAfter` with `desc`), byte arrays base64,
identifiers base58. `test/queries.test.ts` asserts the index each query lands on.

## Validate and register

```
npm test -w @cairn/contract                          # lint + evo-sdk 5.0.0-rc.8 full validation at PV13 and PV14
cd packages/contract/scripts/validate && npm ci && npm run validate   # + wasm-dpp 4.1.1 / 5.0.0-rc.8 with negative controls
node --experimental-transform-types packages/contract/scripts/register.ts testnet init|status|fund|contract
```

`register.ts` follows govhub's `mainnet-bootstrap.ts`: the deployer seed lives only in the shared secret store
(`secret get cairn/testnet-deployer`, linked at `~/.local/share/cairn/testnet-deployer.json`); the contract transition is
signed once at a fixed nonce and saved before the broadcast, so a rerun can only re-send the same bytes.
Contract updates under PV13/PV14 can only add types, never change one or add an index: get a schema change right before mainnet.
