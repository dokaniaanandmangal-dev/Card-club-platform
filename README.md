# Card Club Platform

Security-first online card club platform. The repository is being rebuilt into the authoritative, auditable source of truth under a staged certification process.

## Current status

**v2.0 Secure Supply Chain & Deployment gate: AMBER**

Real-money operation is disabled and must remain disabled until all required certification gates are GREEN and explicit owner launch authorization is recorded.

## Canonical project record

Owner-approved product, game, revenue, infrastructure and governance decisions consolidated from project discussions are maintained in [`docs/PROJECT_CANONICAL.md`](docs/PROJECT_CANONICAL.md). Superseded proposals and temporary operational chatter listed there must not be treated as active requirements.

## Locked architectural direction

The platform is organized around five cooperating cores:

1. Game Core
2. Financial Core
3. Security Core
4. Risk Core
5. Resilience / Crisis Core

Key invariants carried forward include owner-managed external payments with club-specific redeemable chip ledgers, table custody/escrow, immutable double-entry accounting, a Value Control Plane, deterministic settlement verification, a Financial Integrity Controller, strict tenant and hidden-state isolation, and anti-cheat/fraud analysis.

## Repository recovery

The live repository previously contained only this README. Earlier certification work existed as conversational/generated artifacts but was not committed here. This repository therefore treats prior results as historical context only until the corresponding source and evidence are regenerated or independently verified.

## Verification

```bash
npm ci --ignore-scripts
npm run check
npm audit --audit-level=high
npm sbom --sbom-format=cyclonedx > sbom.cdx.json
```

See [`docs/certification/V2_0_GATE.md`](docs/certification/V2_0_GATE.md) for the active certification gate.