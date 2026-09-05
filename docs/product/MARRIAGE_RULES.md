# 21-Card Marriage — Approved Baseline Rule Pack

Status: **Owner-approved baseline for implementation**

## Table configuration

- Three standard 52-card decks.
- 21 cards per player; 2–5 players.
- Anticlockwise play.
- `maalMode` is selected before the table starts and is immutable for that round:
  - `open`: Maal is visible to every player from the beginning.
  - `hidden`: each player individually unlocks Maal only after server-verified qualification.
- Printed Jokers are an optional table setting. When enabled, the three decks contribute two printed Jokers each.

## Maal

One natural card is selected by the authoritative server as Tiplu. Same-suit adjacent ranks define Jhiplu (one rank below) and Poplu (one rank above); rank adjacency wraps at A/K for Maal-family derivation.

Hidden-mode qualification is either:
- three server-verified pure melds; or
- seven Dublees.

A hidden-mode player's Maal access is private to that seat. One player's qualification does not reveal Maal to opponents or spectators.

## Approved scoring

| Item | Points |
| --- | ---: |
| 1 Jhiplu | 2 |
| 1 Tiplu | 3 |
| 1 Poplu | 2 |
| 2 Jhiplu | 5 |
| 2 Tiplu | 10 |
| 2 Poplu | 5 |
| Complete Marriage (Jhiplu + Tiplu + Poplu) | 10 |
| Natural Tunnela | 2 |
| Printed Joker | 1 |
| Dublee | 0 bonus |

Scoring consumes complete Marriages first, then scores residual pairs and singles. For three copies of one Maal role, the deterministic baseline is pair + single; this is an isolated rule-policy choice and can be changed without altering the game engine.

## Meld and Joker rules

- A Tunnela is three natural copies of the exact same rank and suit, one from each deck.
- A Dublee is two natural copies of the exact same rank and suit from different decks.
- Seven Dublees qualify for Maal in hidden mode.
- Eight Dublees satisfy the Dublee finish threshold; remaining cards must still be represented by valid submitted groups so the server can account for the complete 21-card hand.
- Printed Jokers may substitute only in impure runs/sets.
- Printed Jokers cannot be used in pure runs, pure sets, Tunnelas, or a natural Marriage.
- Maal-family cards may act as wild cards in impure meld validation only for a player who has access to Maal; they may still be used naturally where their printed rank/suit fits.

## Security and settlement boundary

The server owns card custody, draw/discard turn order, qualification, Maal visibility, meld validation and finish declaration. The client may propose actions/groups but cannot assert legality.

Marriage is a variable-win game under the approved commercial policy. Final monetary/chip settlement remains downstream of authoritative game outcome generation and will apply the approved 1% positive-winning-amount cut exactly once through the financial ledger.
