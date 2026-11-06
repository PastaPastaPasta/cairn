#!/usr/bin/env bash
# Regenerate the regtest fixtures in this directory from a real Dash Core v24.0.0 node.
#
# Starts one dashpay/dashd:24.0.0 container (regtest with DashTestFramework's -dip3params and
# activation heights; v24 activated by miner signalling via -vbparams without the EHF step, as
# test/functional/feature_masternode_shares.py does), drives it through two shared
# masternode lifecycles with generate.py, writes the JSON fixtures next to this script, and
# removes the container and its datadir.
#
# Requires: docker, python3. Usage: ./generate.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${DASHD_IMAGE:-dashpay/dashd:24.0.0}"
NAME="cairn-shares-regtest-$$"
SCRATCH="${SCRATCH_DIR:-${TMPDIR:-/tmp}/cairn-shares-regtest-$$}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

mkdir -p -m 0700 "$SCRATCH/data"

docker run -d --name "$NAME" --user "$(id -u):$(id -g)" -v "$SCRATCH/data:/data" \
  --entrypoint dashd "$IMAGE" \
  -regtest -datadir=/data -printtoconsole=0 -server=1 -txindex=1 -listen=0 -fallbackfee=0.00001 \
  -dip3params=2:2 -testactivationheight=v20@100 -testactivationheight=mn_rr@100 \
  "-vbparams=v24:0:999999999999:0:10:8:6:5:0" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$NAME" dash-cli -regtest -datadir=/data getblockcount >/dev/null 2>&1; then break; fi
  sleep 1
done

python3 -I "$HERE/generate.py" --container "$NAME" --out "$HERE"
echo "fixtures written to $HERE"
