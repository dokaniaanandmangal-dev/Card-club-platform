# Sweep / Seep — 100-point Standard Rule Core

Status: **server-authoritative core implemented**.

The baseline follows the northern Indian 100-point Seep rules documented by Pagat and cross-checks current Octro/Seep interface descriptions. This is the approved `Sweep / Seep` fixed-board game family.

References:
- https://www.pagat.com/fishing/seep.html
- https://seep.cards/rules
- https://seep.octro.com/

## Implemented

- four-player fixed partnerships and anticlockwise turn order
- dealer-right opening bidder receives four cards while four floor cards remain hidden
- opening bid must be 9–13 and backed by a matching card in the bidder's authoritative hand
- floor is revealed only after a valid bid
- opening play can establish the bid house or use the bid card for a mandatory capture/throw path
- exact full-deck verification when the remaining 44 cards are dealt
- loose-card capture by non-overlapping groups whose values equal the played card
- all matching houses and all remaining possible loose captures must be taken when a card is used to capture
- ordinary houses 9–13 with mandatory retained capture card
- house breaking only from a hand card, with new reserve-card enforcement
- cemented/pukka houses cannot be broken
- duplicate-value houses and exact loose cards are consolidated/cemented
- house ownership reserve obligations are checked after every action
- mid-hand sweep = 50 points, opening sweep = 25, last-play sweep = 0
- last-capture team receives leftover loose floor cards at the end
- scoring uses all spades at capture value, non-spade aces = 1, 10D = 6; base deck points conserve to exactly 100
- accumulated score difference, 100-point Baazi, under-9 instant Baazi and dealer progression
- viewer projections never expose opponent hands or the hidden initial floor.

## Security boundary

The server moves cards between authoritative hand/floor/house/capture zones; clients submit actions but cannot provide resulting state. Every card is identified by its unique deck code. The initial eight cards and the 44-card completion must form the exact 52-card deck, preventing duplicate/substituted deals. Capture maximality and house reserve obligations fail closed.

The 30-point Punjab variant, limited-two-house variant and alternate 10D/majority-card scoring are not silently mixed into this standard rule pack; they require explicit variant configuration and separate tests.
