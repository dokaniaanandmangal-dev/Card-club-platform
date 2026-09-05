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
- [x] PostgreSQL replay/idempotency, monotonic fencing, tenant-account isolation, append-only and balanced double-entry evidence.
- [x] Edge token-bucket rate-limit evidence, including deterministic 100,000-request burst containment.
- [x] WebSocket admission/backpressure/frame-size/rate abuse evidence, including deterministic 100,000-frame load simulation.
- [x] Container runtime smoke test as non-root, read-only root filesystem, all Linux capabilities dropped, no-new-privileges, bounded tmpfs.
- [x] Deployment wrapper rejects mutable image tags and requires a SHA-256 digest reference before execution.
- [ ] Runtime base image pinned by immutable digest.
- [ ] Signed build provenance/attestation path.
- [ ] Migration expand/contract and rollback evidence.
- [ ] Repository rules / protected-main policy verified where connector permissions permit.

## Perimeter controls

The authoritative test suite now covers keyed token-bucket rate limiting with bounded key cardinality, connection caps per authenticated WebSocket subject, frame-size limits, message-window throttling, and in-flight backpressure. Load simulations are deterministic so regressions produce reproducible failures rather than benchmark-only observations.

## Container controls

The CI smoke test runs the production image with a non-root user, read-only root filesystem, `cap-drop=ALL`, `no-new-privileges`, and a small `noexec,nosuid` tmpfs. The deployment wrapper refuses any image reference that is not content-addressed with `@sha256:<digest>`. The remaining container supply-chain item is pinning the Dockerfile base image itself by digest after CI resolves and records the current upstream digest.

## PostgreSQL ledger invariants

The authoritative integration test verifies that exact retries converge to one transaction, operation-ID reuse with changed economic data fails closed, stale fencing tokens cannot create new financial mutations, cross-tenant account references are rejected, ledger rows cannot be updated/deleted, and every accepted transfer produces a balanced two-entry journal in integer minor units.

## Recovery note

A prior conversational certification artifact was reported as `card-club-certification-v1.9.zip` with 83/83 tests and 20,000/20,000 hostile envelopes rejected. That artifact is not present in the current GitHub repository or accessible file library, so those results are historical context only and are **not** being represented as evidence for the current authoritative commit. All certification evidence must be regenerated or imported and verified against this repository. The protocol-perimeter hostile-envelope result has now been regenerated in-repository; the earlier 83-test package as a whole has not.

## Gate rule

GREEN requires reproducible evidence tied to an exact commit SHA. Historical or conversational claims do not satisfy the gate.
