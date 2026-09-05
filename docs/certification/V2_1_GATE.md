# v2.1 — Financial Integrity & Deterministic Settlement Gate

Status: **GREEN — technical certification complete for the no-fee core**

The purpose of this gate is to ensure that no game result can mutate redeemable chip value unless two independent deterministic settlement implementations agree on the exact economic result.

## Gate controls

- [x] Financial amounts represented as PostgreSQL-compatible integer minor-unit strings in application logic; JavaScript floating-point money is rejected.
- [x] Primary deterministic settlement implementation.
- [x] Independently implemented shadow settlement computation.
- [x] Canonical account ordering and SHA-256 settlement digest.
- [x] Value conservation: total closing custody must equal total opening custody for the no-fee core.
- [x] Shadow mismatch is fail-closed before financial mutation and emits a Financial Integrity event.
- [x] 10,000 deterministic conserved settlement cases agree across primary and shadow implementations.
- [x] Persist verified settlement receipts with unique tenant/hand idempotency.
- [x] Bind settlement receipt to immutable game-result/outcome digest.
- [x] Commit custody transfers through the append-only ledger only after dual verification on the certified application path.
- [x] Enforce sufficient durable custody before any settlement debit.
- [x] Transactional crash/retry evidence across receipt + ledger commit.
- [x] Tamper/replay/adversarial settlement corpus at certification scale: 100,000 malformed/tampered settlements rejected plus 10,000 exact deterministic replays.
- [x] Financial Integrity Controller end-to-end certification through the production-style `pg` PostgreSQL persistence adapter.

## End-to-end persistence evidence

The application controller emits an immutable settlement command only after primary/shadow agreement. A production-style adapter uses a bounded `pg` connection pool, parameterized SQL, explicit serializable transaction scope, statement/query timeouts and guaranteed rollback/release behavior. CI maps the pinned PostgreSQL service to loopback and executes the actual application controller through this adapter into `commit_verified_settlement`. It verifies applied settlement, exact replay, resulting durable balances and that an injected shadow outcome mismatch creates no database commit.

The temporary write-enabled lockfile-generation workflow used to create the exact `pg` dependency lock is deleted before certification/merge. Normal certification workflows retain least privilege.

## Adversarial settlement evidence

The application test suite executes 100,000 deterministic fail-closed settlement attacks spanning malformed outcome digests, value creation, duplicate accounts, cross-boundary identifiers, floating/numeric money representations, PostgreSQL bigint overflow, invalid epochs, invalid hand identities and injected shadow-verifier disagreement. Every case must be rejected. A separate 10,000-run replay loop requires the same verified input to reproduce the exact settlement digest, allocations and bound outcome digest.

## Atomic settlement commit

The application Financial Integrity Controller has no financial persistence callback path before primary and shadow settlement results agree. PostgreSQL records the receipt, locks the tenant fence followed by participant accounts in deterministic order, proves every losing account has sufficient durable ledger custody, decomposes N-way zero-sum allocations into deterministic pairwise transfers, writes only through the append-only double-entry ledger, links those transactions back to the receipt, and inserts an append-only commit marker in one database transaction.

Exact replay of an already committed hand returns the existing commit without creating new value movement, including after a newer fencing token has won. A database rollback leaves no durable receipt, ledger transaction, mapping or commit marker, so a retry can apply exactly once.

## Funding boundary

Settlement custody checks operate on durable net ledger positions. Test fixture funding represents an already-authorized upstream player-credit/table-custody flow. This gate does not define or silently introduce mint, burn, rake, bonus or payment-credit economics; those remain separate business/accounting controls.

## Business-boundary decision

This certified slice deliberately assumes **no rake, fee, bonus, mint, or burn** and requires strict value conservation. Any future fee/rake economics remains an owner-level business decision and must be represented as an explicit, separately accounted ledger allocation rather than hidden arithmetic.

## Launch boundary

GREEN for v2.1 does not authorize real-money operation. v2.0 repository-governance protection remains a separate prerequisite, and real-money launch still requires explicit owner authorization after all required gates are GREEN.
