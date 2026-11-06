import { describe, expect, test } from "vitest";
import { keyIdToAddress } from "../src/address.ts";
import { isBadPort, isRoutableIPv4, validateCoreService } from "../src/netinfo.ts";

const reason = (text: string, network: Parameters<typeof validateCoreService>[1] = "test") => {
  const r = validateCoreService(text, network);
  return r.ok ? "ok" : r.reason;
};

describe("validateCoreService (ExtNetInfo::ValidateService, CheckIPv4Primaries, ValidateMainnetPrimaryPort)", () => {
  test("a public IPv4 with a usable port passes and comes back canonical", () => {
    expect(validateCoreService("34.212.1.7:19999", "test")).toEqual({ ok: true, ip: "34.212.1.7", port: 19999, canonical: "34.212.1.7:19999" });
    expect(reason("34.212.1.7:9999", "main")).toBe("ok");
    // ExtNetInfo (ProTx v3) does not forbid the mainnet port elsewhere, unlike the legacy MnNetInfo
    expect(reason("34.212.1.7:9999", "test")).toBe("ok");
  });

  test("anything but IPv4:port is refused: no assumed port, no IPv6 primary, no names or URLs", () => {
    for (const s of ["34.212.1.7", "[2a01:4f8::1]:9999", "example.org:9999", "javascript:alert(1)", " 34.212.1.7:9999", "34.212.1.07:9999", "256.1.1.1:9999", "34.212.1.7:0", "34.212.1.7:65536", "0.0.0.0:9999", "255.255.255.255:9999"])
      expect(reason(s), s).toBe("service");
  });

  test("non-routable ranges are refused except on regtest (RequireRoutableExternalIP)", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.1.1", "127.0.0.1", "0.1.2.3", "169.254.1.1", "100.64.0.1", "100.127.0.1", "198.18.0.1", "198.19.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.7"]) {
      expect(reason(`${ip}:19999`), ip).toBe("service-unroutable");
      expect(reason(`${ip}:19999`, "devnet"), ip).toBe("service-unroutable");
      expect(reason(`${ip}:19999`, "regtest"), ip).toBe("ok");
    }
    for (const ip of ["172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "198.20.0.1", "192.0.3.1", "11.0.0.1"]) expect(reason(`${ip}:19999`), ip).toBe("ok");
  });

  test("IsBadPort: privileged and listed ports, on every network", () => {
    for (const p of [1, 22, 80, 443, 1023, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6669, 6697, 8332, 8333, 10080, 18332, 18333]) {
      expect(isBadPort(p), String(p)).toBe(true);
      expect(reason(`34.212.1.7:${p}`), String(p)).toBe("service-port");
      expect(reason(`127.0.0.1:${p}`, "regtest"), String(p)).toBe("service-port");
    }
    for (const p of [1024, 9999, 19999, 20001, 8334, 65535]) expect(isBadPort(p), String(p)).toBe(false);
  });

  test("mainnet requires port 9999", () => {
    expect(reason("34.212.1.7:19999", "main")).toBe("service-mainnet");
    expect(reason("34.212.1.7:9998", "main")).toBe("service-mainnet");
  });

  test("isRoutableIPv4 on raw bytes", () => {
    expect(isRoutableIPv4(Uint8Array.of(8, 8, 8, 8))).toBe(true);
    expect(isRoutableIPv4(Uint8Array.of(10, 0, 0, 1))).toBe(false);
  });
});

describe("the term sheet uses the same service rules", async () => {
  const { validateTermSheet } = await import("../src/terms.ts");
  const base = {
    network: "test" as const,
    groupId: "g",
    revision: 1,
    shares: [
      { memberId: "a", label: "A", amount: 500n * 100_000_000n },
      { memberId: "b", label: "B", amount: 500n * 100_000_000n },
    ],
    operatorPubKey: "a".repeat(96),
    service: "",
    votingAddress: keyIdToAddress(new Uint8Array(20).fill(7), "test"),
    votingHolderId: "a",
    rewardBps: 0,
    earlyPeriodBlocks: 0,
    earlyPenalty: 0n,
    coordinatorId: "a",
  };
  const codes = (service: string) => validateTermSheet({ ...base, service }).map((i) => i.code);
  test.each([
    ["34.212.1.7:19999", []],
    ["", []],
    ["10.0.0.1:19999", ["service-unroutable"]],
    ["34.212.1.7:443", ["service-port"]],
    ["[2a01:4f8::1]:19999", ["service"]],
  ])("%s", (service, want) => {
    expect(codes(service)).toEqual(want);
  });
});
