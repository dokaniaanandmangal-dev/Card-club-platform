# Game Catalogue & Revenue Policy

Status: **OWNER-APPROVED PRODUCT POLICY**

This document records the approved initial game catalogue and the club revenue model. It is product policy, not implementation evidence and does not authorize real-money launch.

## Approved game catalogue

1. 21-Card Marriage
2. Spades
3. Hearts
4. 29
5. Sweep / Seep
6. Court Piece
7. Dehla Pakad
8. Poker
9. Teen Patti / 3 Patti

## Settlement classes

### Fixed-amount games

- Spades
- Hearts
- 29
- Sweep / Seep
- Court Piece
- Dehla Pakad

The table/board amount is declared before play begins and cannot be changed after the hand/board starts.

### Variable-win games

- 21-Card Marriage
- Poker
- Teen Patti / 3 Patti

The positive winning amount is determined by the game result, scoring or betting flow according to that game's certified rules.

## Revenue policy

- **Fixed-amount games:** club revenue is **1% of the fixed board amount**.
- **Variable-win games:** club revenue is **1% of each positive winning amount**.
- The former 2.5% proposal is cancelled and must not be implemented.
- No player may be charged both a board fee and winner cut for the same settlement path.
- Losing amounts do not attract a winner cut.
- Revenue must be posted to explicit club-revenue ledger accounts and must never be hidden in game arithmetic.
- All calculations use integer minor units and one deterministic rounding rule.

## Architecture rule

The certified pure game result remains separate from revenue calculation. The implementation sequence is:

`authoritative game result -> gross settlement -> approved 1% revenue allocation -> net player settlement -> append-only ledger`

Revenue configuration must be versioned and fixed before a board/hand begins so a table cannot change economics after cards are dealt.

## Rules boundary

Several games have regional variants. Exact rule packs for Marriage, 29, Sweep/Seep, Court Piece and Dehla Pakad must be separately locked before their game engines are certified. Programmers must not choose regional rules implicitly.

## Launch boundary

This policy authorizes development of the revenue layer only. Real-money operation remains disabled until all mandatory technical, governance, security and owner-launch gates are satisfied.
