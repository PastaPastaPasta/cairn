# Vendored code

Cairn reuses gov.dashhq.org's sign-in, account funding and Platform writer (DESIGN section 8). The code is copied, not
depended on: govhub's packages are private, source-only and govhub-named.

- Source: https://github.com/PastaPastaPasta/govhub (MIT, Copyright (c) PastaPastaPasta)
- Commit: `fa04bea` (origin/main, "Merge pull request #68 from PastaPastaPasta/contests-mainnet", 2026-10-27), taken as an
  untouched `git archive` of origin/main.
- Behaviour is unchanged except for the divergences listed below. In particular the hardened single-signature document
  writer (`packages/auth/src/evo.ts`), identity funding (`funding.ts`, `tx.ts`), seed and key derivation, sign-in, vouchers,
  the passkey vault and all of `@cairn/dapi` keep govhub's logic line for line.

## Renames that apply to every vendored file

| govhub | Cairn | Effect |
|---|---|---|
| package scope `@govhub/` | `@cairn/` | imports and docs only |
| `@govhub/contracts-v1/forum.json` (vault schema) | `@cairn/contract/cairn.json` | the vault queries are linted against the cairn contract, whose `vault` type is identical in shape to `forum.vault` (pinned by `packages/contract/test/contract.test.ts`) |
| `@govhub/contracts-v1/queryLint` | `@cairn/contract/queryLint` | same file, see below |
| HPKE info / PRF label `govhub/vault/v1`, `govhub/vault/v1/prf` | `cairn/vault/v1`, `cairn/vault/v1/prf` | Cairn passkey vault entries do not interoperate with govhub's (intended); the fixed-vector snapshot in `auth/test/__snapshots__/vault.test.ts.snap` was regenerated |
| key-paste top-up HMAC label `govhub/topup/v1` | `cairn/topup/v1` | seedless top-up keys differ from govhub's; the Recover tool derives the same lane |
| localStorage `govhub.funding.<key>`, Web Lock names `govhub.funding.<key>` | `cairn.funding.<key>` | |
| localStorage `govhub.passkeys.<id>` | `cairn.passkeys.<id>` | |
| user-facing "govhub" in errors (`vault/webauthn.ts`, `recovery.ts`) | "Cairn" | |

DIP-9/DIP-13 derivation paths are NOT renamed: identities, funding addresses and recovery are shared with every Dash wallet.

## packages/auth -> `@cairn/auth` (`packages/auth`)

Copied: 34 files.

- `README.md`
- `package.json`
- `src/bytes.ts`
- `src/central.ts`
- `src/evo.ts`
- `src/funding.ts`
- `src/index.ts`
- `src/keys.ts`
- `src/layout.ts`
- `src/platform.ts`
- `src/recovery.ts`
- `src/seed.ts`
- `src/signin.ts`
- `src/tx.ts`
- `src/vault/bundle.ts`
- `src/vault/hpke.ts`
- `src/vault/service.ts`
- `src/vault/webauthn.ts`
- `src/voucher.ts`
- `test/__snapshots__/derivation.test.ts.snap`
- `test/__snapshots__/vault.test.ts.snap`
- `test/derivation.test.ts`
- `test/evo-wasm.test.ts`
- `test/fake-platform.ts`
- `test/funding.test.ts`
- `test/hpke.test.ts`
- `test/query-lint.test.ts`
- `test/recovery.test.ts`
- `test/signin.test.ts`
- `test/tx.test.ts`
- `test/vault.test.ts`
- `test/writer.test.ts`
- `tsconfig.json`
- `vitest.config.ts`

Divergences:
- Dropped `src/proposal.ts` (governance proposal collateral), `src/keyring/` (MN voting-key keyring), `test/proposal.test.ts`,
  `test/keyring.test.ts`, every script in `scripts/` (govhub's live and mainnet tooling; Cairn's contract registration is
  `packages/contract/scripts/register.ts`) and the `./keyring-evo` export.
- `src/index.ts`: no proposal or keyring exports.
- `src/tx.ts`: removed `estimateCollateralFee`, `BuiltCollateral`, `buildProposalCollateral` (proposal-only; they were the only
  users of `@govhub/verify`'s collateral and governance code).
- `src/recovery.ts`: `proposalFeeFamily` is no longer a default key family; `RECOVERY_START_HEIGHT` is Cairn's (testnet
  1,585,500, mainnet 2,567,000: two days before Cairn could first take a payment, as govhub's rule says); comments and the
  error text name Cairn.
- `src/evo.ts`: imports the cairn contract's schemas for the vault query lint (the only coupling the survey listed).
- `test/recovery.test.ts`: the proposal-fee lane tests and their key counts removed.
- `test/query-lint.test.ts`: the keyring query test removed.
- `test/funding.test.ts` ("a top-up has no suggestion above its minimum ..."): waits for each aborted run to end before the
  next. Node 24 has Web Locks, so the next run otherwise found the record lock still held (govhub CI runs Node 22, which has
  none). Test-only; `funding.ts` is unchanged.
- `test/vault.test.ts`: label assertions use the Cairn labels.
- `README.md`: govhub's, with a vendoring note.

## packages/dapi -> `@cairn/dapi` (`packages/dapi`)

Copied whole (138 files), including the vendored X11 sources and the Rust/C sources of the two WebAssembly modules.

- `README.md`
- `core-proof-wasm/.gitignore`
- `core-proof-wasm/Cargo.lock`
- `core-proof-wasm/Cargo.toml`
- `core-proof-wasm/build.sh`
- `core-proof-wasm/src/lib.rs`
- `core-proof-wasm/vendor/dash-core-proof/Cargo.toml`
- `core-proof-wasm/vendor/dash-core-proof/README.md`
- `core-proof-wasm/vendor/dash-core-proof/src/bls.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/bootstrap.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/chain.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/lib.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/merkle.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/state.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/transaction.rs`
- `core-proof-wasm/vendor/dash-core-proof/src/wire.rs`
- `core-proof-wasm/vendor/dash-core-proof/tests/data/mainnet.json`
- `core-proof-wasm/vendor/dash-core-proof/tests/data/testnet-no-links.json`
- `core-proof-wasm/vendor/dash-core-proof/tests/data/testnet.json`
- `core-proof-wasm/vendor/dash-core-proof/tests/synthetic.rs`
- `core-proof-wasm/vendor/dash-core-proof/tests/verification.rs`
- `package.json`
- `scripts/bench-x11.mjs`
- `scripts/checkpoint.mjs`
- `scripts/quorum-pins.mjs`
- `scripts/record-anchor-fixtures.mjs`
- `scripts/record-fixtures.mjs`
- `scripts/record-proof-fixtures.mjs`
- `scripts/size.mjs`
- `scripts/vendor-x11.mjs`
- `src/agreed-sml.ts`
- `src/anchor.ts`
- `src/bloom.ts`
- `src/bls.ts`
- `src/bytes.ts`
- `src/cbor.ts`
- `src/chainlock.ts`
- `src/client.ts`
- `src/core.ts`
- `src/coreproof.ts`
- `src/dash.ts`
- `src/errors.ts`
- `src/grpcweb.ts`
- `src/headerchain.ts`
- `src/index.ts`
- `src/linkedchain.ts`
- `src/nodes.ts`
- `src/pb.ts`
- `src/pinned.ts`
- `src/pool.ts`
- `src/pow.ts`
- `src/proofanchor.ts`
- `src/protx.ts`
- `src/quorumpins.ts`
- `src/quorumproof.ts`
- `src/race.ts`
- `src/sml.ts`
- `src/smlproof.ts`
- `src/types.ts`
- `src/vendor/core-proof-wasm.ts`
- `src/vendor/x11-wasm.ts`
- `src/vendor/x11/LICENSE`
- `src/vendor/x11/aes.js`
- `src/vendor/x11/blake.js`
- `src/vendor/x11/bmw.js`
- `src/vendor/x11/cubehash.js`
- `src/vendor/x11/echo.js`
- `src/vendor/x11/groestl.js`
- `src/vendor/x11/helper.js`
- `src/vendor/x11/jh.js`
- `src/vendor/x11/keccak.js`
- `src/vendor/x11/luffa.js`
- `src/vendor/x11/op.js`
- `src/vendor/x11/shavite.js`
- `src/vendor/x11/simd.js`
- `src/vendor/x11/skein.js`
- `src/vendor/x11/x11.d.ts`
- `src/vendor/x11/x11.js`
- `src/verified.ts`
- `src/watch.ts`
- `src/x11.ts`
- `test/anchor-fixtures.ts`
- `test/anchor.test.ts`
- `test/chain.test.ts`
- `test/chainproof.test.ts`
- `test/client.test.ts`
- `test/codec.test.ts`
- `test/coreproof.test.ts`
- `test/fake-dapi.ts`
- `test/fixtures.ts`
- `test/fixtures/anchor-mainnet.json.gz`
- `test/fixtures/anchor-testnet.json.gz`
- `test/fixtures/collateral-tx.hex`
- `test/fixtures/proof-anchor-testnet.json.gz`
- `test/fixtures/quorum-proof-mainnet.json`
- `test/fixtures/quorum-proof-testnet.json`
- `test/fixtures/recorded.json`
- `test/helpers/cbor-encode.ts`
- `test/live/index.html`
- `test/live/page.ts`
- `test/live/results.json`
- `test/live/run.mjs`
- `test/net.test.ts`
- `test/pinned.test.ts`
- `test/proofanchor.test.ts`
- `test/sizes.json`
- `test/x11-bench.json`
- `test/x11-vendor.test.ts`
- `test/x11-wasm.test.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `x11-wasm/aes_helper.c`
- `x11-wasm/blake.c`
- `x11-wasm/bmw.c`
- `x11-wasm/build.sh`
- `x11-wasm/compat/string.h`
- `x11-wasm/cubehash.c`
- `x11-wasm/echo.c`
- `x11-wasm/groestl.c`
- `x11-wasm/jh.c`
- `x11-wasm/keccak.c`
- `x11-wasm/luffa.c`
- `x11-wasm/shavite.c`
- `x11-wasm/simd.c`
- `x11-wasm/skein.c`
- `x11-wasm/sph_blake.h`
- `x11-wasm/sph_bmw.h`
- `x11-wasm/sph_cubehash.h`
- `x11-wasm/sph_echo.h`
- `x11-wasm/sph_groestl.h`
- `x11-wasm/sph_jh.h`
- `x11-wasm/sph_keccak.h`
- `x11-wasm/sph_luffa.h`
- `x11-wasm/sph_shavite.h`
- `x11-wasm/sph_simd.h`
- `x11-wasm/sph_skein.h`
- `x11-wasm/sph_types.h`
- `x11-wasm/x11.c`

Divergences: the `@govhub/` scope in code, docs and `Cargo.toml`'s description; "only what govhub needs" in `src/core.ts`.
The Rust crate keeps its name `govhub-core-proof-wasm` (the committed WASM in `src/vendor/` is byte-identical).

## packages/verify -> `@cairn/verify` (`packages/verify`)

Copied the modules `@cairn/auth` and Cairn use (21 files):

- `README.md`
- `package.json`
- `src/address.ts`
- `src/bytes.ts`
- `src/index.ts`
- `src/message.ts`
- `src/mnvote.ts`
- `src/tx.ts`
- `src/vote.ts`
- `test/fixtures/mainnet-votes.json`
- `test/fixtures/messages.regtest.json`
- `test/fixtures/protx.testnet.json`
- `test/fixtures/testnet-votes.json`
- `test/helpers.ts`
- `test/message.test.ts`
- `test/mnvote.test.ts`
- `test/node-strip.test.ts`
- `test/testnet-votes.test.ts`
- `test/vote.test.ts`
- `tsconfig.json`
- `vitest.config.ts`

Divergences:
- Not copied (governance only, nothing left needs them): `claim.ts`, `collateral.ts`, `corejson.ts`, `govhash.ts`,
  `newproposal.ts`, `proposal.ts`, `superblock.ts`, `tally.ts`, `tallyset.ts`, `voteset.ts`, their tests, fixtures and
  `scripts/`, and `test/live-core.test.ts`, `test/mainnet.test.ts`.
- `src/index.ts` exports only the copied modules.
- `test/mnvote.test.ts` reads `test/fixtures/mainnet-votes.json`, copied from govhub `services/bridge/test/fixtures/`.
- `test/node-strip.test.ts` hashes with `sha256d` instead of the governance object hash.
- `mnvote.ts` keeps govhub's relay-cancel domain `govhub-relay-cancel-v1` unchanged: it is govhub's wire format, not a label.
- `README.md` rewritten for the subset.

## packages/contract/queryLint.ts

govhub `packages/contracts-v1/queryLint.ts`, unchanged. The rules it encodes are documented in govhub
`packages/contracts-v1/README.md` ("Writing and querying").

<!-- apps/web -->
