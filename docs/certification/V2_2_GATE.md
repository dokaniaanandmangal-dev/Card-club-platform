# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **AMBER — server-rule cores implemented for all nine approved games; fairness/recovery/stress controls remain**

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
- [x] Server-authoritative action sequencing and legal-transition validation across all nine games.
  - [x] Reusable trick-taking play core plus standard setup/match rule modules for Spades, Hearts, 29, Court Piece and Dehla Pakad.
  - [x] 2,500 deterministic complete-hand simulations across the five trick-taking rule packs.
  - [x] 100-point standard Sweep/Seep opening bid, exact deal, loose capture, house build/break/cement/capture, sweep scoring and Baazi progression.
  - [x] 21-Card Marriage exact three-deck custody, draw/discard turns, Open/Hidden Maal isolation, pure/Dublee qualification, Joker restrictions, meld validation and approved bonus scoring.
  - [x] No-Limit Texas Hold'em blinds, betting streets, raise/reopen rules, all-in runout, best-five ranking, side pots and hidden-hole-card isolation.
  - [x] Classic Teen Patti blind/seen play, chaal ranges, pack, paid seen-to-seen sideshow, showdown, exact ranking and hidden-card isolation.
- [ ] Cryptographically unpredictable shuffle/deal evidence with deterministic audit reconstruction after disclosure.
- [ ] Reconnect/resume projection tests proving hidden-state boundaries survive session recovery.
- [ ] Spectator/delayed-observer projection policy.
- [ ] Multi-table and multi-tenant isolation stress corpus.
- [ ] Game Integrity Controller end-to-end certification.

## Game legality boundary

The trick-taking family is server-authoritative for exact deck ownership, turn order, follow-suit, trump/break rules, trick resolution, setup and standard match progression across all five approved trick games.

Sweep/Seep uses the northern Indian 100-point baseline: the opening four floor cards stay hidden until dealer-right makes a valid 9–13 bid backed by their first four cards; the remaining deal must complete the exact deck. Server actions implement mandatory loose/house capture, ordinary and cemented houses, breaking, retained capture-card obligations, sweep bonuses, end-floor custody and conserved 100-point base scoring. Variant rules are isolated rather than mixed into the baseline.

21-Card Marriage uses the owner-approved rule pack: Open or Hidden Maal is immutable at table start; hidden Maal is unlocked per seat only after three valid pure melds or seven valid Dublees; printed Jokers score one and may substitute only in impure melds; seven Dublees qualify and eight meet the Dublee finish threshold; Maal, Marriage and Tunnela scoring is deterministic and server-computed. Public and opponent projections never receive another seat's hand or hidden Maal access.

No-Limit Texas Hold'em is server-authoritative for blind positions, betting order, legal call/bet/raise sizing, short-all-in non-reopen behavior, automatic runout, exact 52-card custody, best-five-of-seven ranking, main/side-pot resolution, deterministic odd-chip allocation and chip conservation. Live public projections never expose hole cards before showdown.

Classic Teen Patti uses the approved baseline ranking Trail > Pure Sequence > Sequence > Color > Pair > High Card, with A-K-Q highest and A-2-3 second-highest sequence. Blind and seen chaal ranges are computed from server state; only seen players may request a paid sideshow against the previous active seen player; ties pack the requester; showdown is server-resolved and only showdown hands are publicly revealed. Pack and sideshow do not leak hidden cards.

## Persisted commitment boundary

`game_outcomes` is append-only and serializes one digest chain per tenant/table. Exact hand replay is idempotent; changed metadata for the same hand, sequence gaps, wrong previous digests, updates and deletes fail closed. Only commitment metadata is persisted in this slice; raw hidden state is deliberately not copied into the database by this mechanism.

The Financial Integrity Controller no longer accepts a free-form `outcomeDigest`. Before dual settlement verification it resolves the same tenant/table/hand/epoch from persisted Game Core commitments and injects that digest into both independent settlement verifiers. Missing or boundary-mismatched outcomes block financial persistence.

## Security boundary

The outcome digest is a tamper-evident commitment, not by itself proof that a malicious server generated a fair deal. Shuffle entropy, auditable deal generation, reconnect/spectator policy, multi-tenant stress and the full Game Integrity Controller remain separate mandatory controls before game integrity can be GREEN.

## Revenue boundary

Poker and Teen Patti first produce conserved pure-game results. The approved 1% positive-winning-amount club cut is applied exactly once downstream through explicit financial-ledger entries; it is not embedded in either game engine.

## Launch boundary

No part of this gate authorizes real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after all mandatory gates are GREEN.
