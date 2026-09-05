# Trick-Taking Engine Foundation

Status: **implemented and certification-tested** for the play-phase legality core.

This module is the reusable server-authoritative play engine for the five approved trick-taking games: Spades, Hearts, 29, Court Piece and Dehla Pakad. Game setup/auction/match scoring remains separated so regional variants can be configured without weakening card-ownership, turn-order or follow-suit controls.

## Standard rule baselines

The initial rule packs use the current standard descriptions on Pagat as the baseline:

- Spades: four players, clockwise, fixed spade trump, follow suit, spades cannot be led before broken unless only spades remain.
- Hearts: four players, clockwise, no trump, 2C opens the first trick, follow suit, hearts cannot be led before broken unless only hearts remain. The optional first-trick penalty-card ban is intentionally not assumed because it is a variation.
- 29: four players in partnerships, clockwise, 32-card J-9-A-10-K-Q-8-7 ranking, hidden selected trump, follow suit, first void player must trigger trump reveal. Card points are J=3, 9=2, A=1, 10=1. The last-trick point is configurable and defaults off.
- Court Piece: four players in fixed partnerships, anticlockwise, standard 52-card ranking, selected trump active during play, mandatory follow suit.
- Dehla Pakad: four players in fixed partnerships, anticlockwise, standard 52-card ranking, selected trump, mandatory follow suit, centre pile captured when the same player wins two consecutive tricks; the last trick captures any remainder. Online play uses the explicit announced-trump method rather than an honesty-dependent hidden method.

Sources consulted: https://www.pagat.com/auctionwhist/spades.html, https://www.pagat.com/reverse/hearts.html, https://www.pagat.com/jass/29.html, https://www.pagat.com/whist/rang.html, https://www.pagat.com/pointtrk/dehlapakad.html

## Security invariants

- The engine accepts a complete authoritative deal only if it is an exact permutation of the rule pack's deck; duplicate, missing, extra or invalid cards fail closed.
- Only the current player can act and only a card actually owned by that player can be played.
- Follow-suit is enforced by the server state, never trusted to the client.
- Spade/heart break restrictions are enforced server-side.
- Hidden 29 trump cannot become active through client assertion; a reveal request is legal only for the current player after a lead when that player's authoritative hand is void in the led suit.
- Trick winners are recomputed from authoritative cards and rule-specific rank/trump semantics.
- Dehla Pakad centre-pile custody is maintained by the authoritative state machine.
- Public projections expose only hand counts; a seat projection exposes only that viewer's own hand.
- State and projections are recursively frozen to reduce accidental mutation paths.

## Evidence

The Node test suite includes direct adversarial legality tests plus 2,500 deterministic complete-hand simulations across all five rule packs. Every simulation must consume and capture the exact deck with no card duplication/loss while preserving turn order and legal-card constraints.

This is not shuffle-fairness certification. Cryptographic shuffle/deal entropy, setup phases (Spades bidding, Hearts passing, 29 auction, Court/Dehla trump selection), complete match scoring and regional rule-pack choices are separately certified slices.
