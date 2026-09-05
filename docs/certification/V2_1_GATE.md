# v2.1 — Financial Integrity & Deterministic Settlement Gate

Status: **AMBER — first control slice in progress**

The purpose of this gate is to ensure that no game result can mutate redeemable chip value unless two independent deterministic settlement implementations agree on the exact economic result.

## Gate controls

- [x] Financial amounts represented as PostgreSQL-compatible integer minor-unit strings in application logic; JavaScript floating-point money is rejected.
- [x] Primary deterministic settlement implementation.
- [x] Independently implemented shadow settlement computation.
- [x] Canonical account ordering and SHA-256 settlement digest.
- [x] Value conservation: total closing custody must equal total opening custody for the no-fee core.
- [x] Shadow mismatch is fail-closed before financial mutation.
- [x] 10,000 deterministic conserved settlement cases agree across primary and shadow implementations.
- [ ] Persist verified settlement receipts with unique tenant/hand idempotency.
- [ ] Bind settlement receipt to immutable game-result/outcome digest.
- [ ] Commit custody transfers through the append-only ledger only after dual verification.
- [ ] Enforce sufficient custody/balance before debit.
- [ ] Transactional crash/retry evidence across receipt + ledger commit.
- [ ] Tamper/replay/adversarial settlement corpus.
- [ ] Financial Integrity Controller end-to-end certification.

## Business-boundary decision

This control slice deliberately assumes **no rake, fee, bonus, mint, or burn** and requires strict value conservation. Fee/rake economics are a business decision and will not be silently embedded into the settlement engine. When such policy is owner-approved, it must be represented as an explicit, separately accounted ledger allocation rather than hidden arithmetic.

## Safety rule

A primary result is never sufficient to authorize a financial mutation. Any primary/shadow disagreement is a hard stop and must generate a security/financial-integrity event.
