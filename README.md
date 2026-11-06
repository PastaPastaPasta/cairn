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

## Develop

```
npm ci
npm run typecheck && npm test && npm run build
npm run dev -w @cairn/web                       # http://localhost:5417
npx playwright test e2e/smoke.spec.ts           # in apps/web: headless Chromium against the built app
CAIRN_LIVE=1 npx playwright test e2e/live-profile.spec.ts   # in apps/web: creates a testnet account and profile (spends tDASH)
```

The testnet contract id and how it was registered are in [packages/contract/README.md](packages/contract/README.md).

## License

MIT
