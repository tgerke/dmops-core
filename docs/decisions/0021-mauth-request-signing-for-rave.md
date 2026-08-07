# ADR-0021: MAuth request signing for the Rave adapter

**Status**: accepted · 2026-08-07

## Decision

The Rave adapter (ADR-0017) gains MAuth — Medidata's App-UUID-plus-private-key
request signing scheme — as a second authentication mode beside HTTP Basic,
closing the deferral named in the adapter header since the adapter shipped.
The signer is implemented in-repo on Node's `crypto` (no new dependency), and
its conformance is pinned to Medidata's own protocol test suite, vendored
into `fixtures/mauth-protocol-test-suite/`.

Evidence tiers per ADR-0017, all accessed 2026-08-07:

- **[V-OSS] The protocol.** Medidata publishes no written public
  specification (the MWSV2 spec link in the test-suite README points to
  login-gated learn.mdsol.com), so the protocol claims come from Medidata's
  own client source, `github.com/mdsol/mauth-client-ruby` @ master
  (`lib/mauth/client/signer.rb`, `lib/mauth/request_and_response.rb`):
  - V1 (token `MWS`): `string_to_sign = verb LF path LF body LF app_uuid LF
    epoch_seconds`; the signature is the RSA private-key encryption
    (PKCS#1 v1.5) of the SHA-512 hex digest of that string, base64,
    carried as `X-MWS-Authentication: MWS {app_uuid}:{signature}` with
    `X-MWS-Time: {epoch_seconds}`.
  - V2 (token `MWSV2`): `string_to_sign = verb LF normalized_path LF
    sha512_hex(body or "") LF app_uuid LF epoch_seconds LF encoded_query`;
    the signature is a standard RSA-SHA512 (PKCS#1 v1.5) signature, base64,
    carried as `MCC-Authentication: MWSV2 {app_uuid}:{signature};` (note
    the trailing `;`) with `MCC-Time`. Path normalization resolves dot
    segments, collapses duplicate slashes, and uppercases percent escapes;
    query normalization unescapes each `key=value` pair, sorts pairs by
    codepoint, and re-encodes with the unreserved set `A-Za-z0-9-_.~`
    (space as `%20`).
  - The Ruby client's default signs every request with both protocols'
    headers (`signed_headers`: "by default sign with both the v1 and v2
    protocol"); the adapter does the same, with no knob.
- **[V-OSS] The conformance vectors.** `github.com/mdsol/mauth-protocol-test-suite`
  v0.2.0 (commit bab0b0d, 2022-12-02; Apache-2.0 with NOTICE) provides a
  fixed RSA key pair, `app_uuid`, `request_time`, and per-case
  `.req`/`.sts`/`.sig`/`.authz` files for MWS and MWSV2, including UTF-8,
  duplicate-key, encoding, and path-normalization cases. The README
  instructs clients to vendor the suite and run the three sign-side checks
  per case; the vendored copy (`.git` removed, LICENSE and NOTICE kept)
  does exactly that in `packages/adapters/src/rave/mauth.test.ts`.
- **[V-OSS] MAuth applies to RWS.** rwslib's own documentation source
  (`docs/source/getting_started.rst` @ master) shows
  `RWSConnection('https://….mdsol.com', auth=MAuth(app_id, key))`, states
  that MAuth credentials attach to a Rave user whose rights scope the
  requests, that the account "does not have password expiry so MAuth is a
  better approach to long-term integrations with Rave URLs", and that an
  App ID pairs with one user per Rave URL.
- **[NC] Which protocol versions RWS's verifier accepts.** The client
  rwslib recommends (`github.com/mdsol/requests-mauth`) signs V1 only, so
  V1 acceptance is the publicly evidenced floor; V2 acceptance by RWS
  specifically is not publicly stated. Signing with both headers — the
  vendor client default — means every request carries the V1 headers that
  floor rests on, so this [NC] costs nothing at runtime.

Config stays additive and chooses the mode by shape: exactly one of
`usernameEnv`/`passwordEnv` (Basic, unchanged) or
`mauth: { appUuid, privateKeyEnv }`. The App UUID is an identifier, not a
secret, so it sits in `study_source.config` beside `baseUrl`; the private
key rides the usual env indirection (a PEM in the named variable, never in
the database). Capability posture is independent of auth mode — signing
changes how requests are authorized, not what the source can support.

## Rationale

The adapter header has carried "MAuth … is a named deferral here" since
slice 10, and rwslib's password-expiry point is the operational reason to
close it: a production integration on Basic auth inherits the Rave user's
password rotation, and every rotation is an outage waiting for a config
update. MAuth is Medidata's stated preference for long-term integrations,
in their own documentation's words.

Implementing the signer in-repo was not the first choice — depending on a
vendor-maintained client would put the protocol burden where it belongs —
but Medidata ships MAuth clients for Ruby, Python, .NET, JVM, Go, Rust, and
Clojure, and none for Node (checked 2026-08-07: the `mauth` names on npm
are unrelated projects). The mitigations are the vendor's own: the string
constructions and RSA operations are transcribed from the Ruby client's
source rather than from memory, and the vendored conformance suite — the
distribution mechanism Medidata's README itself prescribes — arbitrates
every normalization detail with 93 pinned checks. A protocol drift would
surface as a vector failure, not a production surprise.

V1's RSA operation deserves its one comment: `private_encrypt` of a hex
digest is raw PKCS#1 v1.5 encryption with the private key, not a standard
RSA signature — Node's `crypto.privateEncrypt` is the equivalent, and the
suite's `.sig` vectors prove the equivalence. That is the vendor's
protocol, faithfully reproduced, not a design endorsement.

## Consequences

- `packages/adapters/src/rave/mauth.ts` carries the signer (~120 lines,
  Node `crypto` only); the adapter signs each request it makes, including
  every followed `Link rel="next"` page, with the path and query of that
  page's URL and a fresh epoch-seconds timestamp.
- `fixtures/mauth-protocol-test-suite/` is vendored third-party test data
  (Apache-2.0, LICENSE and NOTICE retained, provenance README added).
  Re-syncing it when Medidata tags a new version is a copy, not a rewrite.
- `.env.example` documents the new indirection
  (`DMOPS_RAVE_MAUTH_PRIVATE_KEY_*` holding a PEM); existing Basic-auth
  configs keep working unchanged, and a config carrying both modes or
  neither fails validation with an operator-actionable message.
- The adapter header's auth section is rewritten from "named deferral" to
  the signed reality, citations updated to this ADR's access dates.
- Clock skew is the new operational failure mode: MAuth timestamps are
  epoch seconds, and a drifted host signs requests a verifier may refuse.
  The tolerance window is not publicly documented [NC]; the adapter does
  not guess one, and a rejection surfaces as the existing loud
  non-2xx extraction failure.
- If Medidata publishes a Node client or a public specification, the
  in-repo signer should be re-verified against it (ADR-0017's standing
  re-verification posture for republished vendor documentation).
