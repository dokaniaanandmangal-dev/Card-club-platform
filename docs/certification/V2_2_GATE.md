# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **AMBER — game cores, persisted fair shuffle, reconnect and delayed-spectator isolation complete; stress/controller integration remain**

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
- [x] Cryptographically unpredictable shuffle/deal evidence with deterministic audit reconstruction after disclosure.
  - [x] Domain-separated server/participant seed commitments bound to tenant/table/hand/game context.
  - [x] Canonically ordered commitment manifest with tamper-evident manifest digest.
  - [x] HMAC-SHA256 deterministic stream plus rejection-sampled Fisher-Yates shuffle to avoid modulo bias.
  - [x] Post-hand disclosure reconstructs exact card order and verifies manifest/deck digests; tampering fails closed.
  - [x] Runtime server seeds use Node cryptographic randomness; one changed participant seed changes the final deck.
  - [x] Table orchestrator persists the commitment manifest before seed reveals are consumed and routes only an internally attested audited deck to a game consumer.
  - [x] Deck digest is durably recorded before routing; database failure fails closed and exposes no routable deck.
  - [x] Abort events after manifest commitment are append-only, terminal for deck issuance and replay-safe, providing selective-abort evidence.
  - [x] Disclosure evidence is verified before a disclosure digest is appended; live audit tables deliberately persist no plaintext reveal seeds.
- [x] Reconnect/resume projection tests proving hidden-state boundaries survive session recovery.
- [x] Spectator/delayed-observer projection policy.
- [ ] Multi-table and multi-tenant isolation stress corpus.
- [ ] Game Integrity Controller end-to-end certification.

## Game legality boundary

The trick-taking family is server-authoritative for exact deck ownership, turn order, follow-suit, trump/break rules, trick resolution, setup and standard match progression across all five approved trick games.

Sweep/Seep uses the northern Indian 100-point baseline: the opening four floor cards stay hidden until dealer-right makes a valid 9–13 bid backed by their first four cards; the remaining deal must complete the exact deck. Server actions implement mandatory loose/house capture, ordinary and cemented houses, breaking, retained capture-card obligations, sweep bonuses, end-floor custody and conserved 100-point base scoring. Variant rules are isolated rather than mixed into the baseline.

21-Card Marriage uses the owner-approved rule pack: Open or Hidden Maal is immutable at table start; hidden Maal is unlocked per seat only after three valid pure melds or seven valid Dublees; printed Jokers score one and may substitute only in impure melds; seven Dublees qualify and eight meet the Dublee finish threshold; Maal, Marriage and Tunnela scoring is deterministic and server-computed. Public and opponent projections never receive another seat's hand or hidden Maal access.

No-Limit Texas Hold'em is server-authoritative for blind positions, betting order, legal call/bet/raise sizing, short-all-in non-reopen behavior, automatic runout, exact 52-card custody, best-five-of-seven ranking, main/side-pot resolution, deterministic odd-chip allocation and chip conservation. Live public projections never expose hole cards before showdown.

Classic Teen Patti uses the approved baseline ranking Trail > Pure Sequence > Sequence > Color > Pair > High Card, with A-K-Q highest and A-2-3 second-highest sequence. Blind and seen chaal ranges are computed from server state; only seen players may request a paid sideshow against the previous active seen player; ties pack the requester; showdown is server-resolved and only showdown hands are publicly revealed. Pack and sideshow do not leak hidden cards.

## Fair-shuffle boundary

The fair-shuffle subsystem now has both a cryptographic primitive and a persisted orchestration boundary. A server commitment plus participant commitments are bound to the exact tenant, table, hand and game. The commitment manifest and canonical-deck digest are persisted before seed reveals are consumed. Reveals then drive an HMAC-SHA256 rejection-sampled Fisher-Yates shuffle. Before any game consumer can receive the deck, the exact shuffled deck digest must be appended durably as `deck_issued`; if persistence fails, the deck is not routable. The runtime router accepts only deck objects created by the audited orchestrator, so a raw or forged deck fails closed.

A post-commit abort is an append-only terminal audit event and prevents later deck issuance for that manifest. Once a deck is issued, the same hand cannot be relabelled as aborted. After the hand, disclosure is cryptographically reconstructed and verified before a disclosure digest is appended. The audit database intentionally stores commitments/digests and lifecycle evidence, not plaintext live seed reveals.

## Reconnect/resume boundary

Reconnect recovery re-projects the current authoritative state through the existing game-specific player projector rather than serializing an authoritative snapshot back to the client. The viewer is derived only from the authenticated session player identity; caller-provided seat or viewer hints have no authority. Exact tenant and table binding rejects cross-scope recovery, while a per-player membership version invalidates stale sessions after leave/reseat events. Game substitution, removed-player recovery and authoritative-state mismatch fail closed.

The reconnect certification corpus exercises both sides of the hidden-state boundary across all nine supported game identifiers. It executes 9,216 deterministic player reconnect projections and proves that each reconnecting player receives their own hidden state while the opponent secret remains absent. Negative evidence covers seat/viewer spoof hints, cross-tenant and cross-table attempts, stale membership versions, game substitution and removed-player recovery. Returned resume envelopes are recursively frozen and never contain the authoritative state object.

## Spectator/delayed-observer boundary

Spectator delivery is a separate public-only projection boundary. Each snapshot is converted through the existing game-specific public projector at ingest, so authoritative state and private player state are discarded before entering the delay buffer. A certified spectator stream requires at least a 30-second delay; shorter delays fail closed. The buffer is bound to one tenant, table and game and rejects game substitution, non-monotonic state versions, clock rollback and capacity overflow.

The spectator certification corpus executes 4,608 deterministic delayed projections across all nine supported game identifiers. It proves that live Hold'em and Teen Patti cards, Marriage hands/hidden Maal/stock, Seep hands/hidden floor cards and trick-game hands do not appear in spectator output. Boundary tests prove that no snapshot is released before the full delay and that a newer in-delay state cannot overtake the newest eligible snapshot.

## Persisted commitment boundary

`game_outcomes` is append-only and serializes one digest chain per tenant/table. Exact hand replay is idempotent; changed metadata for the same hand, sequence gaps, wrong previous digests, updates and deletes fail closed. Only commitment metadata is persisted in this slice; raw hidden state is deliberately not copied into the database by this mechanism.

`shuffle_manifests` is append-only and uniquely binds one tenant/table/hand to game, manifest, server commitment, participant commitments, canonical-deck digest and deck size. `shuffle_audit_events` is append-only and permits only legal lifecycle sequences: either terminal `aborted`, or `deck_issued` followed by optional `disclosed`. Exact retries are idempotent while changed replays, post-abort issuance, post-issue aborts and mismatched disclosure digests fail closed.

The Financial Integrity Controller no longer accepts a free-form `outcomeDigest`. Before dual settlement verification it resolves the same tenant/table/hand/epoch from persisted Game Core commitments and injects that digest into both independent settlement verifiers. Missing or boundary-mismatched outcomes block financial persistence.

## Security boundary

The outcome digest and fair-shuffle audit evidence cover authoritative game results, commitment/reveal shuffle construction, manifest-before-reveal persistence, audited-deck-only routing and selective-abort tracking. Reconnect recovery adds authenticated viewer derivation, tenant/table binding and stale-membership invalidation. Spectator delivery is public-only at ingest and delayed at least 30 seconds. Remaining v2.2 security work is multi-table/multi-tenant stress and the full Game Integrity Controller end-to-end certification.

## Revenue boundary

Poker and Teen Patti first produce conserved pure-game results. The approved 1% positive-winning-amount club cut is applied exactly once downstream through explicit financial-ledger entries; it is not embedded in either game engine.

## Launch boundary

No part of this gate authorizes real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after all mandatory gates are GREEN.
