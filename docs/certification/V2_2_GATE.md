# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **AMBER — outcome persistence, financial binding and trick-play legality implemented**

This gate ensures that the Game Core produces tamper-evident, deterministic outcomes while preventing one player, spectator or generic public channel from receiving another player's hidden state. Financial settlement may bind only to an authoritative game outcome digest persisted by Game Core.

## Gate controls

- [x] Domain-separated SHA-256 commitment over the complete authoritative outcome, including hidden state.
- [x] Canonical key and seat ordering so equivalent authoritative states produce the same outcome digest.
- [x] Per-table sequence plus previous-outcome digest chaining to detect gaps, reordering and cross-table substitution.
- [x] Public projection excludes every seat's private state.
- [x] Seat projection exposes only the requesting seat's private state while all opponent state remains public-only.
- [x] Caller input is detached and authoritative/projection outputs are recursively frozen.
- [x] Fail-closed validation for duplicate identities, unsafe numbers, dangerous keys, cycles, depth/size limits and malformed chain metadata.
- [x] 10,000 deterministic hidden-state isolation cases prove no opponent secret crosses public or per-seat projection boundaries.
- [x] Persist authoritative outcome commitments append-only with tenant/table/hand idempotency and per-table chain serialization.
- [x] Financial Integrity Controller resolves the exact persisted tenant/table/hand/epoch commitment and rejects caller-supplied free-form outcome digests.
- [ ] Server-authoritative action sequencing and legal-transition validation across all nine games.
  - [x] Reusable trick-taking play core for Spades, Hearts, 29, Court Piece and Dehla Pakad: exact-deck validation, ownership, turn order, follow-suit, trump/break rules, trick winner and capture semantics.
  - [x] 2,500 deterministic complete-hand simulations across the five trick-taking rule packs.
  - [ ] Game-specific setup/auction/pass phases and complete match scoring.
  - [ ] Marriage, Sweep, Poker and Teen Patti legal-transition engines.
- [ ] Cryptographically unpredictable shuffle/deal evidence with deterministic audit reconstruction after disclosure.
- [ ] Reconnect/resume projection tests proving hidden-state boundaries survive session recovery.
- [ ] Spectator/delayed-observer projection policy.
- [ ] Multi-table and multi-tenant isolation stress corpus.
- [ ] Game Integrity Controller end-to-end certification.

## Trick-taking legality boundary

The shared play engine accepts only an exact authoritative deck permutation for the selected rule pack, permits only the current player to act, rejects cards not owned by that player, enforces follow-suit from hidden authoritative hands, and recomputes trick winners server-side. It also enforces Spades/Hearts break restrictions, hidden-trump reveal conditions for 29 and Dehla Pakad centre-pile capture semantics. Public/seat projections expose no opponent hand contents.

This slice deliberately separates play-phase legality from game setup: Spades bidding, Hearts passing, 29's partial-deal auction, Court Piece/Dehla trump selection and region-specific match scoring will be added as explicit rule modules rather than approximated inside the common engine.

## Persisted commitment boundary

`game_outcomes` is append-only and serializes one digest chain per tenant/table. Exact hand replay is idempotent; changed metadata for the same hand, sequence gaps, wrong previous digests, updates and deletes fail closed. Only commitment metadata is persisted in this slice; raw hidden state is deliberately not copied into the database by this mechanism.

The Financial Integrity Controller no longer accepts a free-form `outcomeDigest`. Before dual settlement verification it resolves the same tenant/table/hand/epoch from persisted Game Core commitments and injects that digest into both independent settlement verifiers. Missing or boundary-mismatched outcomes block financial persistence.

## Security boundary

The outcome digest is a tamper-evident commitment, not by itself proof that a malicious server generated a fair deal. Shuffle entropy, deal generation, action legality outside the certified trick-taking play core and server-authenticity controls are separate items in this gate and must be certified before game integrity can be GREEN.

## Launch boundary

No part of this gate authorizes real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after all mandatory gates are GREEN.
