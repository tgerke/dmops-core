import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mauthHeaders, signatureV1, signatureV2, stringToSignV1, stringToSignV2 } from "./mauth.js";

// Sign-side conformance against Medidata's own vectors (ADR-0021): per case,
// (1) string_to_sign matches .sts, (2) signature over the .sts matches .sig,
// (3) headers match .authz — the three checks the suite's README prescribes
// for signing clients. Cases without .sig/.authz are authentication-side
// only and are skipped. See fixtures/mauth-protocol-test-suite/PROVENANCE.md.
const suite = "fixtures/mauth-protocol-test-suite";
const signingConfig = JSON.parse(readFileSync(join(suite, "signing-config.json"), "utf8")) as {
  app_uuid: string;
  request_time: number;
};
const privateKey = readFileSync(join(suite, "signing-params/rsa-key"), "utf8");
const appUuid = signingConfig.app_uuid;
const time = String(signingConfig.request_time);

interface SuiteCase {
  name: string;
  req: { verb: string; url: string; body?: string | null; body_filepath?: string };
  sts?: Buffer;
  sig?: string;
  authz?: Record<string, string | number>;
}

function loadCases(protocol: "MWS" | "MWSV2"): SuiteCase[] {
  return readdirSync(join(suite, "protocols", protocol)).map((name) => {
    const base = join(suite, "protocols", protocol, name);
    const file = (ext: string): string => join(base, `${name}.${ext}`);
    return {
      name,
      req: JSON.parse(readFileSync(file("req"), "utf8")),
      sts: existsSync(file("sts")) ? readFileSync(file("sts")) : undefined,
      sig: existsSync(file("sig")) ? readFileSync(file("sig"), "utf8").trim() : undefined,
      authz: existsSync(file("authz"))
        ? (JSON.parse(readFileSync(file("authz"), "utf8")) as Record<string, string | number>)
        : undefined,
    };
  });
}

describe("mauth signer conformance (vendored mdsol/mauth-protocol-test-suite, ADR-0021)", () => {
  for (const c of loadCases("MWS")) {
    it(`MWS/${c.name}`, () => {
      const [path = ""] = c.req.url.split("?");
      const body = c.req.body_filepath
        ? readFileSync(join(suite, "protocols", "MWS", c.name, c.req.body_filepath))
        : Buffer.from(c.req.body ?? "", "utf8");
      const input = { verb: c.req.verb, path, query: "", body, appUuid, privateKey, time };
      const sts = stringToSignV1(input);
      // Binary-body case omits .sts by design (raw bytes in the string).
      if (c.sts) expect(sts.toString("utf8")).toBe(c.sts.toString("utf8"));
      const sig = signatureV1(c.sts ?? sts, privateKey);
      if (c.sig) expect(sig).toBe(c.sig);
      if (c.authz) {
        expect(`MWS ${appUuid}:${sig}`).toBe(c.authz["X-MWS-Authentication"]);
        expect(time).toBe(String(c.authz["X-MWS-Time"]));
      }
    });
  }

  for (const c of loadCases("MWSV2")) {
    it(`MWSV2/${c.name}`, () => {
      const [path = "", query = ""] = c.req.url.split("?");
      const body = c.req.body_filepath
        ? readFileSync(join(suite, "protocols", "MWSV2", c.name, c.req.body_filepath))
        : Buffer.from(c.req.body ?? "", "utf8");
      const input = { verb: c.req.verb, path, query, body, appUuid, privateKey, time };
      const sts = stringToSignV2(input);
      if (c.sts) expect(sts).toBe(c.sts.toString("utf8"));
      if (!c.sig && !c.authz) return; // authentication-side-only case
      const sig = signatureV2(c.sts ? c.sts.toString("utf8") : sts, privateKey);
      if (c.sig) expect(sig).toBe(c.sig);
      if (c.authz) {
        expect(`MWSV2 ${appUuid}:${sig};`).toBe(c.authz["MCC-Authentication"]);
        expect(time).toBe(String(c.authz["MCC-Time"]));
      }
    });
  }

  it("emits all four headers, both protocols, one call (vendor client default posture)", () => {
    const headers = mauthHeaders({
      verb: "GET",
      path: "/",
      query: "",
      appUuid,
      privateKey,
      time,
    });
    expect(Object.keys(headers).sort()).toEqual([
      "MCC-Authentication",
      "MCC-Time",
      "X-MWS-Authentication",
      "X-MWS-Time",
    ]);
    expect(headers["X-MWS-Authentication"]).toMatch(new RegExp(`^MWS ${appUuid}:`));
    expect(headers["MCC-Authentication"]).toMatch(new RegExp(`^MWSV2 ${appUuid}:.*;$`));
  });
});
