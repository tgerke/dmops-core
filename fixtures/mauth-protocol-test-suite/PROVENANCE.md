# Vendored: mdsol/mauth-protocol-test-suite

Medidata's language-agnostic conformance suite for the MAuth signing
protocols (MWS, MWSV2), vendored per its own README's instruction that
clients embed the suite and run its sign-side checks (ADR-0021).

- Source: https://github.com/mdsol/mauth-protocol-test-suite
- Version: 0.2.0 (`.version`), commit `bab0b0dbfdf39e340f4a4179f62e64cd87cf4f96`
  (2022-12-02), copied 2026-08-07 with `.git/` removed and nothing else
  changed. LICENSE (Apache-2.0) and NOTICE are retained as required.
- Consumed by `packages/adapters/src/rave/mauth.test.ts`, which runs the
  three sign-side checks per case (string_to_sign, signature,
  authentication headers) against the in-repo signer.
- To re-sync: re-clone, remove `.git/`, replace this directory, update the
  commit and date here. Never hand-edit vectors.
