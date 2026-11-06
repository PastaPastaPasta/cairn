#!/usr/bin/env python3
"""Drive a Dash Core v24 regtest node (inside a container) through two shared masternode
lifecycles and record every RPC input/output as JSON fixtures. Run via generate.sh.

Fingerprints of the session/sigs envelopes are computed from text produced by Dash Core's own
UniValue writer: the envelope is echoed through the hidden `echojson` RPC and dash-cli prints the
result with write(2); the outer array wrapper is then peeled off (see univalue_pretty)."""

import argparse
import hashlib
import json
import subprocess
import sys
from collections import OrderedDict
from decimal import Decimal

COIN = 100_000_000
LOG = []


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Node:
    def __init__(self, container):
        self.container = container

    def cli(self, *args, wallet=None):
        cmd = ["docker", "exec", self.container, "dash-cli", "-regtest", "-datadir=/data"]
        if wallet:
            cmd.append(f"-rpcwallet={wallet}")
        cmd += [a if isinstance(a, str) else json.dumps(a) for a in args]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"{' '.join(args[:2])} failed: {res.stderr.strip()}")
        out = res.stdout.rstrip("\n")
        LOG.append({"call": [a if isinstance(a, str) else a for a in args], "wallet": wallet})
        return out

    def json(self, *args, wallet=None):
        return json.loads(self.cli(*args, wallet=wallet), parse_float=Decimal, object_pairs_hook=OrderedDict)

    def cli_err(self, *args, wallet=None):
        try:
            self.cli(*args, wallet=wallet)
        except RuntimeError as e:
            return str(e)
        raise RuntimeError("expected an error")

    def mine(self, n, address):
        return self.json("generatetoaddress", str(n), address)


def univalue_pretty(node, value):
    """UniValue::write(2) of `value`, produced by Dash Core: echojson returns [value] and dash-cli
    prints it with write(2); strings cannot contain raw newlines, so stripping the "[" / "]" lines
    and the two-space element indent leaves exactly the top-level write(2) text."""
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    out = node.cli("echojson", compact)
    lines = out.split("\n")
    assert lines[0] == "[" and lines[-1] == "]", out[:80]
    inner = lines[1:-1]
    assert all(l.startswith("  ") for l in inner)
    return "\n".join(l[2:] for l in inner)


def fingerprint_of(text):
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8].upper()
    return f"{h[:4]}-{h[4:]}"


def stamp(node, body):
    """shared_mn::AppendFingerprint + write(2): returns (text, code, unstamped_text)"""
    unstamped = univalue_pretty(node, body)
    code = fingerprint_of(unstamped)
    full = OrderedDict(body)
    full["fingerprint"] = code
    return univalue_pretty(node, full), code, unstamped


def dash_amount(duffs):
    return str(Decimal(duffs) / COIN)


def find_utxo(node, wallet, amount_duffs):
    for u in node.json("listunspent", "1", wallet=wallet):
        if int(Decimal(u["amount"]) * COIN) == amount_duffs:
            return u
    raise RuntimeError(f"no {amount_duffs} utxo in {wallet}")


def to_plain(o):
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, dict):
        return OrderedDict((k, to_plain(v)) for k, v in o.items())
    if isinstance(o, list):
        return [to_plain(v) for v in o]
    return o


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(to_plain(obj), f, indent=2, ensure_ascii=False)
        f.write("\n")


def activate_v24(node, miner):
    while True:
        info = node.json("getblockchaininfo")
        v24 = info["softforks"]["v24"]
        if v24.get("active"):
            return info["blocks"], to_plain(v24)
        if info["blocks"] > 3000:
            raise RuntimeError("v24 did not activate")
        node.mine(50, miner)


def register(node, miner, wallets, labels, contrib, shares_rpc, service, op_pub, voting, reward_pct, period, penalty):
    """contrib: list of (wallet, input_amount_duffs, change_duffs); returns the full record."""
    inputs, outputs, contributions = [], OrderedDict(), []
    for (wallet, in_amt, change), label in zip(contrib, labels):
        u = find_utxo(node, wallet, in_amt)
        inputs.append({"txid": u["txid"], "vout": u["vout"]})
        change_addr = node.cli("getnewaddress", wallet=wallet)
        outputs[change_addr] = dash_amount(change)
        contributions.append(OrderedDict([
            ("label", label),
            ("inputs", [OrderedDict([("txid", u["txid"]), ("vout", u["vout"]), ("sequence", 4294967295)])]),
            ("change", OrderedDict([("address", change_addr), ("amount", change)])),
            ("changeIndex", len(contributions)),
        ]))
    funding = node.cli("createrawtransaction", inputs, outputs)
    prepare_args = [funding, shares_rpc, service, op_pub, voting, reward_pct, str(period), str(penalty)]
    prepared = node.json("protx", "shared_register_prepare", *prepare_args)
    signs = OrderedDict()
    for w in dict.fromkeys(wallets):
        signs[w] = node.json("protx", "shared_sign", prepared["tx"], wallet=w)
    sigs = sorted((s for r in signs.values() for s in r["signatures"]), key=lambda s: s["shareIndex"])
    combined = node.cli("protx", "shared_combine", prepared["tx"], sigs)
    signed_steps = []
    cur = combined
    for w in dict.fromkeys(wallets):
        r = node.json("signrawtransactionwithwallet", cur, wallet=w)
        signed_steps.append(OrderedDict([("wallet", w), ("hex", r["hex"]), ("complete", r["complete"])]))
        cur = r["hex"]
    assert signed_steps[-1]["complete"], "funding not fully signed"
    protx_hash = node.cli("sendrawtransaction", cur)
    block = node.mine(1, miner)[0]
    height = node.json("getblock", block)["height"]
    return OrderedDict([
        ("labels", labels),
        ("contributions", contributions),
        ("fundingTx", funding),
        ("fundingDecoded", node.json("decoderawtransaction", funding)),
        ("prepareArgs", OrderedDict([
            ("fundingTx", funding), ("shares", shares_rpc), ("coreP2PAddrs", service),
            ("operatorPubKey", op_pub), ("votingAddress", voting), ("operatorReward", reward_pct),
            ("earlyPeriodBlocks", period), ("earlyPenalty", penalty),
        ])),
        ("prepared", prepared),
        ("preparedDecoded", node.json("decoderawtransaction", prepared["tx"])),
        ("sharedSign", signs),
        ("signatures", sigs),
        ("combined", combined),
        ("fundingSigned", signed_steps),
        ("final", cur),
        ("finalDecoded", node.json("decoderawtransaction", cur)),
        ("proTxHash", protx_hash),
        ("registeredBlock", OrderedDict([("hash", block), ("height", height)])),
        ("protxInfo", node.json("protx", "info", protx_hash)),
    ])


def session_body(network, session_id, revision, stage, rec, shares_rows, terms, protx, consent, coll, sigs):
    return OrderedDict([
        ("type", "dash-shared-mn-session"),
        ("version", 1),
        ("network", network),
        ("sessionId", session_id),
        ("revision", revision),
        ("stage", stage),
        ("fundingTx", rec["fundingTx"]),
        ("shares", shares_rows),
        ("terms", terms),
        ("contributions", rec["contributions"]),
        ("protx", protx),
        ("consentHash", consent),
        ("collateralIndex", coll),
        ("sigs", sigs),
        ("prepareWallet", "w1"),
        ("operatorSecretHolder", "Olga's hosting"),
        ("coordinatorLabel", rec["labels"][0]),
    ])


def build_envelopes(node, rec, op_pub, voting, sigs_dissolve, sigs_registrar, protx_hash):
    """Session envelopes laid out exactly like MnShareSession::toJsonBody, filled with this run's data."""
    terms = OrderedDict([
        ("coreP2PAddrs", rec["prepareArgs"]["coreP2PAddrs"]),
        ("operatorPubKey", op_pub),
        ("votingAddress", voting),
        ("operatorReward", 500),
        ("earlyPeriodBlocks", rec["prepareArgs"]["earlyPeriodBlocks"]),
        ("earlyPenalty", rec["prepareArgs"]["earlyPenalty"]),
    ])
    rows_full = [OrderedDict([
        ("label", label), ("amount", s["amount"]), ("ownerAddress", s["ownerAddress"]),
        ("refundAddress", s["refundAddress"]), ("rewardAddress", s.get("rewardAddress", "")),
    ]) for label, s in zip(rec["labels"], rec["prepareArgs"]["shares"])]
    rows_draft = [OrderedDict(r) for r in rows_full]
    for r in rows_draft[1:]:
        r["ownerAddress"] = r["refundAddress"] = r["rewardAddress"] = ""
    session_id = hashlib.sha256(b"cairn regtest fixture session").hexdigest()
    consent = rec["prepared"]["consentHash"]
    coll = rec["prepared"]["collateralIndex"]
    sigs = rec["signatures"]
    stages = [
        ("draft-invitation", session_body("regtest", session_id, 4, "draft", dict(rec, contributions=rec["contributions"][:1]), rows_draft, terms, "", "", -1, [])),
        ("draft-complete", session_body("regtest", session_id, 9, "draft", rec, rows_full, terms, "", "", -1, [])),
        ("frozen", session_body("regtest", session_id, 9, "frozen", rec, rows_full, terms, rec["prepared"]["tx"], consent, coll, [])),
        ("signing", session_body("regtest", session_id, 9, "signing", rec, rows_full, terms, rec["prepared"]["tx"], consent, coll, sigs[:1])),
        ("combined", session_body("regtest", session_id, 9, "combined", rec, rows_full, terms, rec["combined"], consent, coll, sigs)),
        ("fundingSigned", session_body("regtest", session_id, 9, "fundingSigned", rec, rows_full, terms, rec["final"], consent, coll, sigs)),
        ("broadcast", session_body("regtest", session_id, 9, "broadcast", rec, rows_full, terms, rec["final"], consent, coll, sigs)),
    ]
    out = []
    for name, body in stages:
        text, code, unstamped = stamp(node, body)
        out.append(OrderedDict([("name", name), ("text", text), ("fingerprint", code), ("unstampedText", unstamped)]))

    # UniValue escaping and number edge cases, fingerprinted by the real writer
    tricky = session_body("regtest", session_id, 4, "draft", dict(rec, contributions=[]), [OrderedDict([
        ("label", "Zoë \"Z\" \\ / \t\u0001\u007f ✓ 😀"), ("amount", rec["prepareArgs"]["shares"][0]["amount"]),
        ("ownerAddress", ""), ("refundAddress", ""), ("rewardAddress", ""),
    ])], terms, "", "", -1, [])
    text, code, unstamped = stamp(node, tricky)
    out.append(OrderedDict([("name", "draft-escapes"), ("text", text), ("fingerprint", code), ("unstampedText", unstamped)]))

    for kind, tx_hex, entries in (("dissolve", sigs_dissolve[0], sigs_dissolve[1]), ("registrar", sigs_registrar[0], sigs_registrar[1])):
        body = OrderedDict([
            ("type", "dash-shared-mn-sigs"), ("version", 1), ("network", "regtest"), ("kind", kind),
            ("proTxHash", protx_hash), ("tx", tx_hex), ("signatures", entries),
        ])
        text, code, unstamped = stamp(node, body)
        out.append(OrderedDict([("name", f"sigs-{kind}"), ("text", text), ("fingerprint", code), ("unstampedText", unstamped)]))
        empty = OrderedDict(body)
        empty["signatures"] = []
        text, code, unstamped = stamp(node, empty)
        out.append(OrderedDict([("name", f"sigs-{kind}-request"), ("text", text), ("fingerprint", code), ("unstampedText", unstamped)]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    node = Node(args.container)

    for w in ("w1", "w2", "w3"):
        node.cli("createwallet", w)
    miner = node.cli("getnewaddress", wallet="w1")
    log("mining to v24 activation")
    node.mine(110, miner)
    height, v24 = activate_v24(node, miner)
    log(f"v24 active at tip {height}")

    # Coins with exact, recognisable amounts
    addr = {w: node.cli("getnewaddress", wallet=w) for w in ("w1", "w2", "w3")}
    for w, amt in (("w1", "520"), ("w2", "350"), ("w3", "250"), ("w1", "521"), ("w2", "310"), ("w3", "210")):
        node.cli("sendtoaddress", node.cli("getnewaddress", wallet=w), amt, wallet="w1")
    node.mine(1, miner)

    def newaddr(w):
        return node.cli("getnewaddress", wallet=w)

    # ---- Masternode A: 500/300/200, service set, 5% operator reward, early period 30, penalty 50 DASH
    labels_a = ["Alice", "Bob", "Carol"]
    shares_a = [
        OrderedDict([("amount", 500 * COIN), ("refundAddress", newaddr("w1")), ("rewardAddress", newaddr("w1")), ("ownerAddress", newaddr("w1"))]),
        OrderedDict([("amount", 300 * COIN), ("refundAddress", newaddr("w2")), ("ownerAddress", newaddr("w2"))]),
        OrderedDict([("amount", 200 * COIN), ("refundAddress", newaddr("w3")), ("ownerAddress", newaddr("w3"))]),
    ]
    bls_a = node.json("bls", "generate")
    voting_a = newaddr("w1")
    rec_a = register(node, miner, ["w1", "w2", "w3"], labels_a,
                     [("w1", 520 * COIN, 520 * COIN - 500 * COIN - 100000), ("w2", 350 * COIN, 50 * COIN), ("w3", 250 * COIN, 50 * COIN)],
                     shares_a, "127.0.0.1:20001", bls_a["public"], voting_a, "5.00", 30, 50 * COIN)
    hash_a = rec_a["proTxHash"]
    log(f"MN A registered {hash_a}")

    # Owner reward split as consensus pays it: the template's masternode payees, then the mined coinbase
    rec_a["payouts"] = []
    for _ in range(2):
        try:
            gbt = node.json("getblocktemplate")
        except RuntimeError as e:
            gbt = OrderedDict([("height", None), ("masternode", None), ("error", str(e))])
        blk = node.mine(1, miner)[0]
        cb = node.json("getblock", blk, "2")["tx"][0]
        rec_a["payouts"].append(OrderedDict([
            ("height", gbt["height"]), ("masternode", gbt["masternode"]),
            ("coinbaseVout", [OrderedDict([("value", o["value"]), ("valueSat", o.get("valueSat")), ("script", o["scriptPubKey"]["hex"])]) for o in cb["vout"]]),
        ]))

    # ProUpShareTx: Bob points his rewards elsewhere
    bob_reward = newaddr("w2")
    bob_fee = rec_a["contributions"][1]["change"]["address"]
    upshare_hex = node.cli("protx", "shared_update_share", hash_a, "1", bob_reward, bob_fee, "false", wallet="w2")
    upshare_txid = node.cli("sendrawtransaction", upshare_hex)
    node.mine(1, miner)
    rec_a["updateShare"] = OrderedDict([
        ("args", OrderedDict([("shareIndex", 1), ("rewardAddress", bob_reward), ("feeSourceAddress", bob_fee)])),
        ("hex", upshare_hex), ("txid", upshare_txid), ("decoded", node.json("decoderawtransaction", upshare_hex)),
        ("protxInfo", node.json("protx", "info", hash_a)),
    ])

    # ProUpSharedRegTx: unanimous voting key rotation
    new_voting = newaddr("w1")
    alice_fee = rec_a["contributions"][0]["change"]["address"]
    reg_prepared = node.json("protx", "shared_update_registrar_prepare", hash_a, "", new_voting, alice_fee, wallet="w1")
    reg_signs = OrderedDict((w, node.json("protx", "shared_sign", reg_prepared["tx"], wallet=w)) for w in ("w1", "w2", "w3"))
    reg_sigs = sorted((s for r in reg_signs.values() for s in r["signatures"]), key=lambda s: s["shareIndex"])
    reg_combined = node.cli("protx", "shared_combine", reg_prepared["tx"], reg_sigs, "false", wallet="w1")
    reg_txid = node.cli("sendrawtransaction", reg_combined)
    node.mine(1, miner)
    rec_a["updateRegistrar"] = OrderedDict([
        ("args", OrderedDict([("operatorPubKey", ""), ("votingAddress", new_voting), ("feeSourceAddress", alice_fee)])),
        ("prepared", reg_prepared), ("sharedSign", reg_signs), ("signatures", reg_sigs),
        ("combined", reg_combined), ("txid", reg_txid), ("decoded", node.json("decoderawtransaction", reg_combined)),
        ("protxInfo", node.json("protx", "info", hash_a)),
    ])

    # Standby dissolutions for Carol (share 2), unanimous dissolution request (not broadcast)
    tip = node.json("getblockcount")
    standby_full = node.cli("protx", "shared_dissolve", hash_a, "2", "100000", "false", "false", wallet="w3")
    standby_now = node.cli("protx", "shared_dissolve", hash_a, "2", "100000", "false", "true", wallet="w3")
    dis_prepared = node.json("protx", "shared_dissolve_prepare", hash_a, "0", "100000", wallet="w1")
    dis_signs = OrderedDict((w, node.json("protx", "shared_sign", dis_prepared["tx"], wallet=w)) for w in ("w1", "w2", "w3"))
    dis_sigs = sorted((s for r in dis_signs.values() for s in r["signatures"]), key=lambda s: s["shareIndex"])
    dis_combined = node.cli("protx", "shared_combine", dis_prepared["tx"], dis_sigs, "false")
    rec_a["standby"] = OrderedDict([
        ("tipHeight", tip), ("actorIndex", 2),
        ("full", standby_full), ("fullDecoded", node.json("decoderawtransaction", standby_full)),
        ("immediate", standby_now), ("immediateDecoded", node.json("decoderawtransaction", standby_now)),
    ])
    rec_a["unanimousDissolve"] = OrderedDict([
        ("prepared", dis_prepared), ("sharedSign", dis_signs), ("signatures", dis_sigs),
        ("combined", dis_combined), ("decoded", node.json("decoderawtransaction", dis_combined)),
    ])
    rec_a["standbyFullEarlyReject"] = node.cli_err("sendrawtransaction", standby_full)
    dis_txid = node.cli("sendrawtransaction", standby_now)
    node.mine(1, miner)
    rec_a["dissolved"] = OrderedDict([
        ("txid", dis_txid), ("hex", standby_now),
        ("protxInfoError", node.cli_err("protx", "info", hash_a)),
    ])
    rec_a["operator"] = OrderedDict([("public", bls_a["public"]), ("votingAddress", voting_a)])

    # ---- Masternode B: 4 shares (two owned by w1), P2SH refund and reward, empty service, no early period
    msig = lambda w: node.json("createmultisig", "1", [node.json("getaddressinfo", newaddr(w), wallet=w)["pubkey"]])["address"]
    labels_b = ["Alice", "Bob", "Carol", "Alice-2"]
    shares_b = [
        OrderedDict([("amount", 400 * COIN), ("refundAddress", newaddr("w1")), ("ownerAddress", newaddr("w1"))]),
        OrderedDict([("amount", 300 * COIN), ("refundAddress", newaddr("w2")), ("rewardAddress", msig("w2")), ("ownerAddress", newaddr("w2"))]),
        OrderedDict([("amount", 200 * COIN), ("refundAddress", msig("w3")), ("ownerAddress", newaddr("w3"))]),
        OrderedDict([("amount", 100 * COIN), ("refundAddress", newaddr("w1")), ("ownerAddress", newaddr("w1"))]),
    ]
    bls_b = node.json("bls", "generate")
    voting_b = newaddr("w2")
    rec_b = register(node, miner, ["w1", "w2", "w3"], labels_b[:3],
                     [("w1", 521 * COIN, 521 * COIN - 500 * COIN - 100000), ("w2", 310 * COIN, 10 * COIN), ("w3", 210 * COIN, 10 * COIN)],
                     shares_b, "", bls_b["public"], voting_b, "0", 0, 0)
    rec_b["labels"] = labels_b
    hash_b = rec_b["proTxHash"]
    log(f"MN B registered {hash_b}")
    disb_prepared = node.json("protx", "shared_dissolve_prepare", hash_b, "3", "100000", wallet="w1")
    disb_signs = OrderedDict((w, node.json("protx", "shared_sign", disb_prepared["tx"], wallet=w)) for w in ("w1", "w2", "w3"))
    disb_sigs = sorted((s for r in disb_signs.values() for s in r["signatures"]), key=lambda s: s["shareIndex"])
    disb_combined = node.cli("protx", "shared_combine", disb_prepared["tx"], disb_sigs, "false")
    disb_txid = node.cli("sendrawtransaction", disb_combined)
    node.mine(1, miner)
    rec_b["unanimousDissolve"] = OrderedDict([
        ("prepared", disb_prepared), ("sharedSign", disb_signs), ("signatures", disb_sigs),
        ("combined", disb_combined), ("txid", disb_txid), ("decoded", node.json("decoderawtransaction", disb_combined)),
        ("protxInfoError", node.cli_err("protx", "info", hash_b)),
    ])
    rec_b["operator"] = OrderedDict([("public", bls_b["public"]), ("votingAddress", voting_b)])

    envelopes = build_envelopes(
        node, rec_a, bls_a["public"], voting_a,
        (dis_prepared["tx"], dis_sigs), (reg_prepared["tx"], reg_sigs), hash_a)

    chain = OrderedDict([
        ("network", "regtest"), ("image", "dashpay/dashd:24.0.0"),
        ("version", node.json("getnetworkinfo")["subversion"]),
        ("v24", v24), ("tip", node.json("getblockcount")),
    ])
    write_json(f"{args.out}/chain.json", chain)
    write_json(f"{args.out}/mn-a.json", rec_a)
    write_json(f"{args.out}/mn-b.json", rec_b)
    write_json(f"{args.out}/envelopes.json", envelopes)


if __name__ == "__main__":
    main()
