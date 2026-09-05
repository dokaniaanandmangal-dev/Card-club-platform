# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **AMBER — first control slice in progress**

This gate ensures that the Game Core produces tamper-evident, deterministic outcomes while preventing one player, spectator or generic public channel from receiving another player's hidden state. Financial settlement may bind only to an authoritative game outcome digest.

## Gate controls

- [x] Domain-separated SHA-256 commitment over the complete authoritative outcome, including hidden state.
- [x] Canonical key and seat ordering so equivalent authoritative states produce the same outcome digest.
- [x] Per-table sequence plus previous-outcome digest chaining to detect gaps, reordering and cross-table substitution.
- [x] Public projection excludes every seat's private state.
- [x] Seat projection exposes only the requesting seat's private state while all opponent state remains public-only.
- [x] Caller input is detached and authoritative/projection outputs are recursively frozen.
- [x] Fail-closed validation for duplicate identities, unsafe numbers, dangerous keys, cycles, depth/size limits and malformed chain metadata.
- [x] 10,000 deterministic hidden-state isolation cases prove no opponent secret crosses public or per-seat projection boundaries.
- [ ] Persist authoritative outcome commitments append-only with tenant/table/hand idempotency.
- [ ] Bind Financial Integrity Controller input directly to a persisted authoritative game outcome rather than accepting a free-form digest.
- [ ] Server-authoritative action sequencing and legal-transition validation.
- [ ] Cryptographically unpredictable shuffle/deal evidence with deterministic audit reconstruction after disclosure.
- [ ] Reconnect/resume projection tests proving hidden-state boundaries survive session recovery.
- [ ] Spectator/delayed-observer projection policy.
- [ ] Multi-table and multi-tenant isolation stress corpus.
- [ ] Game Integrity Controller end-to-end certification.

## Security boundary

The outcome digest is a tamper-evident commitment, not by itself proof that a malicious server generated a fair deal. Shuffle entropy, deal generation, action legality and server-authenticity controls are separate items in this gate and must be certified before game integrity can be GREEN.

## Financial binding

v2.1 already requires an immutable `outcomeDigest` before settlement. v2.2 will remove the remaining trust gap by making the financial path consume only an outcome commitment persisted by the Game Core for the same tenant/table/hand/epoch.

## Launch boundary

No part of this gate authorizes real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after all mandatory gates are GREEN.
