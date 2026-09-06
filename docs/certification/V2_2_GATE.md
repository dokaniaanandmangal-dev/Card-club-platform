# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **GREEN — all Game Outcome Integrity & Hidden-State Isolation controls certified**

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
- [x] Multi-table and multi-tenant isolation stress corpus.
- [x] Game Integrity Controller end-to-end certification.

## Game legality boundary

The trick-taking family is server-authoritative for exact deck ownership, turn order, follow-suit, trump/break rules, trick resolution, setup and standard match progression across all five approved trick games.

Sweep/Seep uses the northern Indian 100-point baseline: the opening four floor cards stay hidden until dealer-right makes a valid 9–13 bid backed by their first four cards; the remaining deal must complete the exact deck. Server actions implement mandatory loose/house capture, ordinary and cemented houses, breaking, retained capture-card obligations, sweep bonuses, end-floor custody and conserved 100-point base scoring. Variant rules are isolated rather than mixed into the baseline.

21-Card Marriage uses the owner-approved rule pack: Open or Hidden Maal is immutable at table start; hidden Maal is unlocked per seat only after three valid pure melds or seven valid Dublees; printed Jokers score one and may substitute only in impure melds; seven Dublees qualify and eight meet the Dublee finish threshold; Maal, Marriage and Tunnela scoring is deterministic and server-computed. Public and opponent projections never receive another seat's hand or hidden Maal access.

No-Limit Texas Hold'em is server-authoritative for blind positions, betting order, legal call/bet/raise sizing, short-all-in non-reopen behavior, automatic runout, exact 52-card custody, best-five-of-seven ranking, main/side-pot resolution, deterministic odd-chip allocation and chip conservation. Live public projections never expose hole cards before showdown.

Classic Teen Patti uses the approved baseline ranking Trail > Pure Sequence > Sequence > Color > Pair > High Card, with A-K-Q highest and A-2-3 second-highest sequence. Blind and seen chaal ranges are computed from server state; only seen players may request a paid sideshow against the previous active seen player; ties pack the requester; showdown is server-resolved and only showdown hands are publicly revealed. Pack and sideshow do not leak hidden cards.

## Fair-shuffle boundary

The fair-shuffle subsystem has both a cryptographic primitive and a persisted orchestration boundary. A server commitment plus participant commitments are bound to the exact tenant, table, hand and game. The commitment manifest and canonical-deck digest are persisted before seed reveals are consumed. Reveals then drive an HMAC-SHA256 rejection-sampled Fisher-Yates shuffle. Before any game consumer can receive the deck, the exact shuffled deck digest must be appended durably as `deck_issued`; if persistence fails, the deck is not routable.

Audited deck routing is single-use. Once an issued deck is routed to a game consumer it cannot be routed again, preventing one audited shuffle from forking into multiple game branches. The deck is burned before consumer invocation, so consumer failure requires a fresh audited hand rather than a retry with the same deck.

A post-commit abort is an append-only terminal audit event and prevents later deck issuance for that manifest. Once a deck is issued, the same hand cannot be relabelled as aborted. After the hand, disclosure is cryptographically reconstructed and verified before a disclosure digest is appended. The audit database intentionally stores commitments/digests and lifecycle evidence, not plaintext live seed reveals.

## Reconnect/resume boundary

Reconnect recovery re-projects the current authoritative state through the existing game-specific player projector rather than serializing an authoritative snapshot back to the client. The viewer is derived only from the authenticated session player identity; caller-provided seat or viewer hints have no authority. Exact tenant and table binding rejects cross-scope recovery, while a per-player membership version invalidates stale sessions after leave/reseat events. Game substitution, removed-player recovery and authoritative-state mismatch fail closed.

The reconnect certification corpus exercises both sides of the hidden-state boundary across all nine supported game identifiers. It executes 9,216 deterministic player reconnect projections and proves that each reconnecting player receives their own hidden state while the opponent secret remains absent. Negative evidence covers seat/viewer spoof hints, cross-tenant and cross-table attempts, stale membership versions, game substitution and removed-player recovery. Returned resume envelopes are recursively frozen and never contain the authoritative state object.

## Spectator/delayed-observer boundary

Spectator delivery is a separate public-only projection boundary. Each snapshot is converted through the existing game-specific public projector at ingest, so authoritative state and private player state are discarded before entering the delay buffer. A certified spectator stream requires at least a 30-second delay; shorter delays fail closed. The buffer is bound to one tenant, table and game and rejects game substitution, non-monotonic state versions, clock rollback and capacity overflow.

The spectator certification corpus executes 4,608 deterministic delayed projections across all nine supported game identifiers. It proves that live Hold'em and Teen Patti cards, Marriage hands/hidden Maal/stock, Seep hands/hidden floor cards and trick-game hands do not appear in spectator output. Boundary tests prove that no snapshot is released before the full delay and that a newer in-delay state cannot overtake the newest eligible snapshot.

## Multi-table and multi-tenant boundary

Live projection routing uses a scope-bound table router. Tenant/table identity is captured once when the server opens a table handle; later authoritative publications through that handle cannot supply or override a routing scope. Reconnect has no target-table argument: the authenticated session tenant/table is the sole lookup authority. Authoritative state and memberships are cloned and frozen at publication so later producer mutation cannot alter recovery or spectator output. Duplicate table ownership, unknown scopes, state-version replay and capacity overflow fail closed.

The isolation stress corpus keeps 2,304 logical table scopes active across 32 tenants, eight table slots and all nine games. It verifies 4,608 valid player reconnect projections, rejects 2,304 stale cross-scope token replays using unique membership epochs, and releases 2,304 correctly scoped delayed spectator snapshots with no private-state markers. Additional adversarial cases prove caller target/viewer hints cannot redirect reconnects and post-publication mutation cannot alter routed state.

## Game Integrity Controller boundary

The Game Integrity Controller is the final fail-closed hand boundary. A hand can be finalized only with a controller-issued token created after a valid audited deck has been routed exactly once. The shuffle audit receipt's tenant/table/hand/game identity, manifest digest, canonical-deck digest and exact shuffled-deck digest are inserted into reserved Game Integrity metadata before the authoritative outcome digest is computed.

The controller also canonicalizes the exact financial settlement intent and domain-separates a SHA-256 settlement-intent digest into that same authoritative outcome commitment. Settlement account IDs must exactly equal the outcome player IDs. Callers cannot provide an outcome digest, financial scope, outcome identity override or reserved Game Integrity metadata. Therefore a conserved but unrelated payout cannot be attached to an otherwise valid game result, and changing the payout intent changes the authoritative outcome digest.

The authoritative outcome must persist successfully before Financial Integrity Controller is reachable. Financial Integrity Controller then reloads that exact tenant/table/hand/epoch commitment, runs the primary and independent shadow settlement implementations, requires identical allocation/digest results, and only then reaches the fenced atomic settlement adapter. Exact retries are idempotent; changed outcome or settlement-intent retries fail closed.

Certification includes both adversarial in-process tests and a production-style PostgreSQL end-to-end test. The PostgreSQL test performs audited shuffle persistence and routing, Game Integrity finalization, append-only outcome persistence, dual financial verification, atomic ledger settlement, exact replay and changed-intent rejection against the real certification schemas.

## Persisted commitment boundary

`game_outcomes` is append-only and serializes one digest chain per tenant/table. Exact hand replay is idempotent; changed metadata for the same hand, sequence gaps, wrong previous digests, updates and deletes fail closed. Only commitment metadata is persisted in this slice; raw hidden state is deliberately not copied into the database by this mechanism.

`shuffle_manifests` is append-only and uniquely binds one tenant/table/hand to game, manifest, server commitment, participant commitments, canonical-deck digest and deck size. `shuffle_audit_events` is append-only and permits only legal lifecycle sequences: either terminal `aborted`, or `deck_issued` followed by optional `disclosed`. Exact retries are idempotent while changed replays, post-abort issuance, post-issue aborts and mismatched disclosure digests fail closed.

The Financial Integrity Controller never accepts a free-form `outcomeDigest`. Before dual settlement verification it resolves the same tenant/table/hand/epoch from persisted Game Core commitments and injects that digest into both independent settlement verifiers. Missing or boundary-mismatched outcomes block financial persistence.

## Security boundary

v2.2 now closes the complete Game Integrity chain: authoritative game legality, cryptographic shuffle construction and persistence, single-use audited deck routing, outcome commitment/chaining, reconnect isolation, delayed public spectators, multi-table/multi-tenant routing isolation, settlement-intent binding, independent financial verification and atomic persistence. All mandatory v2.2 controls have certification evidence and the gate is GREEN.

## Revenue boundary

Poker and Teen Patti first produce conserved pure-game results. The approved 1% positive-winning-amount club cut is applied exactly once downstream through explicit financial-ledger entries; it is not embedded in either game engine.

## Launch boundary

v2.2 GREEN does not authorize real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after every mandatory project gate is GREEN and owner-level launch approval is explicitly granted.
