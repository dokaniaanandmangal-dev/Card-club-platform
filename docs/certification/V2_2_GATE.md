# v2.2 — Game Outcome Integrity & Hidden-State Isolation Gate

Status: **AMBER — all five trick-game standard rule modules implemented; remaining game families pending**

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
  - [x] Standard Spades ordered bidding and deterministic contract/bag/nil scoring.
  - [x] Standard Hearts simultaneous three-card pass cycle (left/right/across/none) and cumulative match scoring.
  - [x] Standard 29 first-four-card auction, forced-dealer minimum, high-bidder trump selection, exact second deal and Pair-adjusted contract result.
  - [x] Standard Court Piece 5+8 deal, dealer-right trump caller, deal/court streak scoring and dealer progression.
  - [x] Dehla Pakad trustless announced-trump 5+8 setup, tens/Kot hand scoring, seven-hand Kot streak and dealer progression.
  - [ ] Marriage, Sweep, Poker and Teen Patti legal-transition engines.
- [ ] Cryptographically unpredictable shuffle/deal evidence with deterministic audit reconstruction after disclosure.
- [ ] Reconnect/resume projection tests proving hidden-state boundaries survive session recovery.
- [ ] Spectator/delayed-observer projection policy.
- [ ] Multi-table and multi-tenant isolation stress corpus.
- [ ] Game Integrity Controller end-to-end certification.

## Trick-taking legality boundary

The shared play engine accepts only an exact authoritative deck permutation for the selected rule pack, permits only the current player to act, rejects cards not owned by that player, enforces follow-suit from hidden authoritative hands, and recomputes trick winners server-side. It also enforces Spades/Hearts break restrictions, hidden-trump reveal conditions for 29 and Dehla Pakad centre-pile capture semantics. Public/seat projections expose no opponent hand contents.

Spades bidding accepts exactly one ordered numeric bid from each seat and match scoring accounts for contracts, bags, sandbag penalties and nil. Hearts passing is a commit-before-reveal flow: each player selects three owned cards, no transfer is applied until all four submissions exist, and then the left/right/across/no-pass cycle is applied atomically. Hearts cumulative scoring consumes the authoritative hand summary and resolves the match when the target is reached.

29 preserves its information boundary: only the first four cards per player are present during the auction, the dealer is forced to the configured minimum when the first three players pass, bids must strictly increase, only the high bidder can choose trump, and the second deal must complete the exact 32-card deck. Pair adjusts the bidder contract by four within the configured bounds; Pair declaration timing remains a later play-state control.

Court Piece and Dehla Pakad share a fail-closed five-card trump setup. The dealer first distributes five cards to every seat; only the dealer-right caller may select the announced trump, and the remaining eight cards per seat are accepted only when the full result is an exact 52-card deck. Seat projections expose only the viewer's own first five cards. Court Piece tracks majority deals, first-seven courts, seven-deal courts, 52-courts and the standard losing-team dealer progression. Dehla Pakad uses the online-safe announced-trump method rather than the honesty-dependent dynamic trump method, and tracks tens, four-ten Kots, seven-hand Kots and dealer progression.

## Persisted commitment boundary

`game_outcomes` is append-only and serializes one digest chain per tenant/table. Exact hand replay is idempotent; changed metadata for the same hand, sequence gaps, wrong previous digests, updates and deletes fail closed. Only commitment metadata is persisted in this slice; raw hidden state is deliberately not copied into the database by this mechanism.

The Financial Integrity Controller no longer accepts a free-form `outcomeDigest`. Before dual settlement verification it resolves the same tenant/table/hand/epoch from persisted Game Core commitments and injects that digest into both independent settlement verifiers. Missing or boundary-mismatched outcomes block financial persistence.

## Security boundary

The outcome digest is a tamper-evident commitment, not by itself proof that a malicious server generated a fair deal. Shuffle entropy, deal generation, the remaining four game families and server-authenticity controls are separate items in this gate and must be certified before game integrity can be GREEN.

## Launch boundary

No part of this gate authorizes real-money play. v2.0 protected-main governance remains unresolved, and real-money launch remains owner-authorized only after all mandatory gates are GREEN.
