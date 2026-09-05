# v2.1 — Financial Integrity & Deterministic Settlement Gate

Status: **AMBER — production persistence adapter integration remaining**

The purpose of this gate is to ensure that no game result can mutate redeemable chip value unless two independent deterministic settlement implementations agree on the exact economic result.

## Gate controls

- [x] Financial amounts represented as PostgreSQL-compatible integer minor-unit strings in application logic; JavaScript floating-point money is rejected.
- [x] Primary deterministic settlement implementation.
- [x] Independently implemented shadow settlement computation.
- [x] Canonical account ordering and SHA-256 settlement digest.
- [x] Value conservation: total closing custody must equal total opening custody for the no-fee core.
- [x] Shadow mismatch is fail-closed before financial mutation.
- [x] 10,000 deterministic conserved settlement cases agree across primary and shadow implementations.
- [x] Persist verified settlement receipts with unique tenant/hand idempotency.
- [x] Bind settlement receipt to immutable game-result/outcome digest.
- [x] Commit custody transfers through the append-only ledger only after dual verification on the certified application path.
- [x] Enforce sufficient durable custody before any settlement debit.
- [x] Transactional crash/retry evidence across receipt + ledger commit.
- [x] Tamper/replay/adversarial settlement corpus at certification scale: 100,000 malformed/tampered settlements rejected plus 10,000 exact deterministic replays.
- [ ] Financial Integrity Controller end-to-end certification against a production-style PostgreSQL persistence adapter.

## Adversarial settlement evidence

The application test suite now executes 100,000 deterministic fail-closed settlement attacks spanning malformed outcome digests, value creation, duplicate accounts, cross-boundary identifiers, floating/numeric money representations, PostgreSQL bigint overflow, invalid epochs, invalid hand identities and injected shadow-verifier disagreement. Every case must be rejected. A separate 10,000-run replay loop requires the same verified input to reproduce the exact settlement digest, allocations and bound outcome digest.

## Atomic settlement commit

The application Financial Integrity Controller has no persistence callback path before primary and shadow settlement results agree. It emits an immutable command containing the outcome-bound settlement digest, canonical allocations and fencing token. PostgreSQL then records the receipt, locks the tenant fence followed by participant accounts in deterministic order, proves every losing account has sufficient durable ledger custody, decomposes N-way zero-sum allocations into deterministic pairwise transfers, writes only through the append-only double-entry ledger, links those transactions back to the receipt, and inserts an append-only commit marker in one database transaction.

Exact replay of an already committed hand returns the existing commit without creating new value movement, including after a newer fencing token has won. A database rollback leaves no durable receipt, ledger transaction, mapping or commit marker, so a retry can apply exactly once.

## Funding boundary

Settlement custody checks operate on durable net ledger positions. Test fixture funding represents an already-authorized upstream player-credit/table-custody flow. This gate does not define or silently introduce mint, burn, rake, bonus or payment-credit economics; those remain separate business/accounting controls.

## Receipt controls

Settlement digest version 2 includes the immutable `outcomeDigest`; changing the outcome changes the economic settlement digest even when allocations are identical. PostgreSQL stores an append-only dual-verification receipt keyed by `(tenant_id, hand_id)`. Exact replay converges to the existing receipt; any attempt to reuse the same hand with changed table, epoch, outcome, settlement digest, or allocations fails closed. Stored allocations must be canonical, unique by account, and value-conserving.

## Business-boundary decision

This gate deliberately assumes **no rake, fee, bonus, mint, or burn** and requires strict value conservation. Fee/rake economics are a business decision and will not be silently embedded into the settlement engine. When such policy is owner-approved, it must be represented as an explicit, separately accounted ledger allocation rather than hidden arithmetic.

## Safety rule

A primary result is never sufficient to authorize a financial mutation. Any primary/shadow disagreement is a hard stop and must generate a security/financial-integrity event.
