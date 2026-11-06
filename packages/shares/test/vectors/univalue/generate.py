#!/usr/bin/env python3
"""Run UniValue edge cases through dash-cli echojson (arguments on stdin); see generate.sh."""
import argparse
import base64
import json
import subprocess

CASES = [
    b'"plain"', b'"\\u00e9"', '"é"'.encode(), b'"\\ud83d\\ude00"', '"😀"'.encode(),
    b'"\xc0\x80"', b'"\xe0\x80\x80"', b'"\xc1\xbf"', b'"\xed\xa0\xbd\xed\xb8\x80"', b'"\xed\xa0\xbd"',
    b'"\xed\xb8\x80"', b'"\xf4\x90\x80\x80"', b'"\xf7\xbf\xbf\xbf"', b'"\xf8\x88\x80\x80\x80"', b'"\xff"',
    b'"\x80"', b'"\xc3"', b'"\x7f"', b'"\\u007f"', b'"\\/"', b'"\\u0000"', b'"\\uDBFF\\uDFFF"', b'"\\u12G4"',
    b'"\\ud800\\u0041"', b'"\\u0041\\udc00"', b'"\\ud800\\ud800"', b'"a\tb"', b'"\\a"', b'"\\u00"',
    b'1.50', b'-0', b'1E+2', b'1e-0', b'01', b'-01', b'1.', b'.5', b'-', b'+1', b'1e', b'0.0e00',
    b'123456789012345678901234567890', b'true', b'nul', b'null',
    b'{"a":1,"a":2}', b'{"b":{},"a":[]}', b'{"\\u0000k":"\\u001f"}', b'[1,]', b'{"a":1,}',
    b'{"1":0,"0":1}', b'  {"x" : [ 1 ,2 ] }  ', b'\x0b1', b'"\\uD83D"',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = []
    for raw in CASES:
        # dash-cli strips the quotes of a bare string argument, so strings travel inside an array
        arg = b"[" + raw + b"]" if raw.startswith(b'"') else raw
        # -stdin keeps raw bytes; docker's exec API would turn invalid UTF-8 in argv into U+FFFD
        res = subprocess.run(
            ["docker", "exec", "-i", args.container, "dash-cli", "-regtest", "-datadir=/data", "-stdin", "echojson"],
            input=arg + b"\n",
            capture_output=True,
        )
        entry = {"input": base64.b64encode(arg).decode(), "accepted": res.returncode == 0}
        if res.returncode == 0:
            entry["output"] = base64.b64encode(res.stdout.rstrip(b"\n")).decode()
        else:
            entry["error"] = res.stderr.decode("utf-8", "replace").strip()
        out.append(entry)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
