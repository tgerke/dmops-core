import { constants, createHash, createSign, privateEncrypt } from "node:crypto";

/**
 * MAuth request signing (ADR-0021): Medidata's App-UUID + RSA-private-key
 * scheme, implemented on Node crypto because Medidata publishes no Node
 * client (checked 2026-08-07). Every protocol claim below is [V-OSS],
 * transcribed from Medidata's own mauth-client-ruby @ master
 * (lib/mauth/client/signer.rb, lib/mauth/request_and_response.rb, consulted
 * 2026-08-07) — there is no publicly reachable written specification — and
 * every construction is pinned against the vendored vendor conformance
 * suite (fixtures/mauth-protocol-test-suite, mdsol/mauth-protocol-test-suite
 * v0.2.0) by mauth.test.ts:
 *
 * - V1 (token MWS): string_to_sign = verb LF path LF body LF app_uuid LF
 *   epoch_seconds; signature = base64 of the PKCS#1 v1.5 private-key
 *   ENCRYPTION of the SHA-512 hex digest (Ruby's private_key.private_encrypt
 *   — a raw operation, not a standard RSA signature; Node's privateEncrypt
 *   with RSA_PKCS1_PADDING is the equivalent, proven by the suite's .sig
 *   vectors). Headers: X-MWS-Authentication "MWS {uuid}:{sig}", X-MWS-Time.
 * - V2 (token MWSV2): string_to_sign = verb LF normalized_path LF
 *   sha512_hex(body or "") LF app_uuid LF epoch_seconds LF encoded_query;
 *   signature = base64 standard RSA-SHA512 (PKCS#1 v1.5) signature.
 *   Headers: MCC-Authentication "MWSV2 {uuid}:{sig};" (trailing
 *   semicolon), MCC-Time. Path normalization resolves dot segments,
 *   collapses duplicate slashes, uppercases percent escapes; query
 *   normalization unescapes each key=value pair ('+' as space), sorts
 *   pairs by codepoint, re-encodes with unreserved set A-Za-z0-9-_.~ and
 *   space as %20.
 * - The Ruby client's default signs with BOTH protocols' headers
 *   (signer.rb signed_headers); mauthHeaders does the same, no knob.
 */
export interface MAuthSignInput {
  verb: string;
  /** Raw URL path, no host or query; leading "/" included. */
  path: string;
  /** Raw query string without the "?", empty string when none. */
  query: string;
  /** Request body bytes; omitted → empty (GETs). */
  body?: Buffer;
  appUuid: string;
  /** PEM-encoded RSA private key. */
  privateKey: string;
  /** Seconds since epoch, as a string. */
  time: string;
}

const UNRESERVED = /[A-Za-z0-9\-_.~]/;

/** Percent-encode UTF-8 bytes outside the unreserved set, space as %20. */
function uriEscape(s: string): string {
  let out = "";
  for (const b of Buffer.from(s, "utf8")) {
    const ch = String.fromCharCode(b);
    out += UNRESERVED.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** CGI.unescape semantics: '+' is space, then percent-decode as UTF-8. */
function unescapePart(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, " "));
}

/** V2 query normalization: unescape, sort pairs by codepoint, re-encode. */
export function encodeQueryV2(queryString: string): string {
  if (queryString === "") return "";
  return queryString
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      const k = eq === -1 ? part : part.slice(0, eq);
      const v = eq === -1 ? "" : part.slice(eq + 1);
      return [unescapePart(k), unescapePart(v)] as const;
    })
    .sort((a, b) => {
      const keys = Buffer.compare(Buffer.from(a[0], "utf8"), Buffer.from(b[0], "utf8"));
      return keys !== 0
        ? keys
        : Buffer.compare(Buffer.from(a[1], "utf8"), Buffer.from(b[1], "utf8"));
    })
    .map(([k, v]) => `${uriEscape(k)}=${uriEscape(v)}`)
    .join("&");
}

/** V2 path normalization: RFC 3986 dot-segment removal, then collapse
 * duplicate slashes, then uppercase percent escapes (Ruby: Addressable
 * normalize_path + squeeze('/') + gsub upcase). */
export function normalizePathV2(path: string): string {
  let input = path;
  let out = "";
  while (input.length > 0) {
    if (input.startsWith("../")) input = input.slice(3);
    else if (input.startsWith("./")) input = input.slice(2);
    else if (input.startsWith("/./")) input = `/${input.slice(3)}`;
    else if (input === "/.") input = "/";
    else if (input.startsWith("/../")) {
      input = `/${input.slice(4)}`;
      out = out.replace(/\/?[^/]*$/, "");
    } else if (input === "/..") {
      input = "/";
      out = out.replace(/\/?[^/]*$/, "");
    } else if (input === "." || input === "..") input = "";
    else {
      const segment = (input.match(/^\/?[^/]*/) as RegExpMatchArray)[0];
      out += segment;
      input = input.slice(segment.length);
    }
  }
  return out.replace(/\/{2,}/g, "/").replace(/%[0-9a-f]{2}/g, (h) => h.toUpperCase());
}

/** V1 string_to_sign carries the raw body bytes, so the result is bytes. */
export function stringToSignV1(input: MAuthSignInput): Buffer {
  return Buffer.concat([
    Buffer.from(`${input.verb}\n${input.path}\n`, "utf8"),
    input.body ?? Buffer.alloc(0),
    Buffer.from(`\n${input.appUuid}\n${input.time}`, "utf8"),
  ]);
}

export function stringToSignV2(input: MAuthSignInput): string {
  const bodyDigest = createHash("sha512")
    .update(input.body ?? Buffer.alloc(0))
    .digest("hex");
  return [
    input.verb,
    normalizePathV2(input.path),
    bodyDigest,
    input.appUuid,
    input.time,
    encodeQueryV2(input.query),
  ].join("\n");
}

export function signatureV1(stringToSign: Buffer, privateKey: string): string {
  const hashed = createHash("sha512").update(stringToSign).digest("hex");
  return privateEncrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(hashed, "utf8"),
  ).toString("base64");
}

export function signatureV2(stringToSign: string, privateKey: string): string {
  return createSign("sha512").update(stringToSign, "utf8").sign(privateKey, "base64");
}

/** Both protocols' headers, per the vendor client's default posture. */
export function mauthHeaders(input: MAuthSignInput): Record<string, string> {
  const v1 = signatureV1(stringToSignV1(input), input.privateKey);
  const v2 = signatureV2(stringToSignV2(input), input.privateKey);
  return {
    "X-MWS-Authentication": `MWS ${input.appUuid}:${v1}`,
    "X-MWS-Time": input.time,
    "MCC-Authentication": `MWSV2 ${input.appUuid}:${v2};`,
    "MCC-Time": input.time,
  };
}
