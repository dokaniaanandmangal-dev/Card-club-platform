# v2.0 — Secure Supply Chain & Deployment Certification Gate

Status: **AMBER**

This gate converts the repository from an unverified placeholder into a reproducible, auditable build baseline. It does **not** certify the complete card-club application or authorize real-money operation.

## Evidence now required in-repository

- [x] Committed package lockfile.
- [x] Node runtime policy fixed to major version 22 for this gate.
- [x] CI action references pinned to immutable commit SHAs.
- [x] Minimal GitHub Actions permissions.
- [x] `npm ci --ignore-scripts` reproducible install path.
- [x] Unit/security test command.
- [x] Deterministic hostile-envelope corpus: 20,000/20,000 rejected on the authoritative validator.
- [x] High-severity dependency-audit gate.
- [x] CycloneDX SBOM generation.
- [x] Basic high-confidence secret-pattern scan.
- [ ] PostgreSQL replay/fencing evidence imported or regenerated against authoritative source.
- [ ] Edge rate-limit evidence.
- [ ] WebSocket load/abuse evidence.
- [ ] Container image build hardened as non-root/read-only/drop-capabilities.
- [ ] Image digest verification at deployment.
- [ ] Signed build provenance/attestation path.
- [ ] Migration expand/contract and rollback evidence.
- [ ] Repository rules / protected-main policy verified where connector permissions permit.

## Recovery note

A prior conversational certification artifact was reported as `card-club-certification-v1.9.zip` with 83/83 tests and 20,000/20,000 hostile envelopes rejected. That artifact is not present in the current GitHub repository or accessible file library, so those results are historical context only and are **not** being represented as evidence for the current authoritative commit. All certification evidence must be regenerated or imported and verified against this repository. The protocol-perimeter hostile-envelope result has now been regenerated in-repository; the earlier 83-test package as a whole has not.

## Gate rule

GREEN requires reproducible evidence tied to an exact commit SHA. Historical or conversational claims do not satisfy the gate.
