# Cairn

Build a Dash masternode together. Cairn helps people find co-owners and an operator for a
Dash Core v24 **shared masternode**, agree on terms, and walk through Dash Core's own
shared-masternode flow. Cairn never holds coins or keys.

- Live: https://cairn.dashhq.org (a Dash HQ product)
- Design and requirements: [DESIGN.md](DESIGN.md)
- Research notes: [docs/research/](docs/research/)

## Layout

- `apps/web`: the static web app (React + Vite), deployed to GitHub Pages.
- `packages/shares`: Dash Core v24 shared-masternode logic: share rules, ProRegTx v3 codec,
  consent hash, Dash-Qt session envelopes, term sheets.
- `packages/auth`, `packages/dapi`, `packages/verify`: sign-in, DAPI and verification, vendored
  from [govhub](https://github.com/PastaPastaPasta/govhub) (see `VENDORED.md`).
- `packages/contract`: the `cairn` Dash Platform data contract.

## License

MIT
