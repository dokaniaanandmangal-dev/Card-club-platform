# Security Policy

This repository is being developed under a fail-closed certification model because it is intended to protect game integrity and financial-value ledgers.

## Current operating restriction

Real-money operation is **not authorized**. No deployment may enable real-money play until the required security, financial-integrity, resilience, supply-chain, and deployment certification gates are GREEN and owner-level launch authorization is explicitly recorded.

## Reporting

Do not disclose suspected vulnerabilities publicly. Use a private owner-approved security channel until a dedicated private reporting mechanism is configured.

## Non-negotiable controls

- No secrets in source control.
- Reproducible dependency installation from a committed lockfile.
- Minimal CI permissions and immutable action pins.
- Fail-closed request validation at trust boundaries.
- Financial mutations must ultimately be protected by an immutable double-entry ledger and deterministic settlement verification.
