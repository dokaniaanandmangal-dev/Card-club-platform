# Game Interface Benchmarks

Research date: 2026-09-06

Purpose: study strong, currently available card-game interfaces and extract reusable interaction patterns for the Card Club. We do **not** copy proprietary artwork, logos, deck skins, source code or exact layouts.

## Reference set by game

| Game | Three interface references | Patterns worth adopting |
| --- | --- | --- |
| 21-Card Marriage | Marriage Card Game by Bhoos; Marriage Card Game by Yarsa Games; Marriage Card Game by 3 Colors Interactive | large sortable hand, meld grouping, joker/maal status, score calculator, private-table entry |
| Spades | Trickster Spades; Spades Plus; CardGames.io Spades | table-first play, explicit bidding phase, partnership score, clear trick center, private-room flow |
| Hearts | Trickster Hearts; VIP Games Hearts; CardGames.io Hearts | passing phase as a dedicated interaction, penalty score always visible, uncluttered 4-seat table |
| 29 | 29cardgame.app; Card Game 29 by Z Level Apps; 29 Card Game Multiplayer | bidding overlay, hidden-trump state, compact partnership scoreboard, rules summary before table start |
| Sweep / Seep | Seep by Octro; Seep by VoidEdge; Seep by Jasvir Singh Cheema | large floor/capture area, capture-value emphasis, 2/4-player modes, score target always visible |
| Court Piece | Rung.gg; Court Piece by Artoon Games; Court Piece by Mobilix | fast room creation, caller/trump indicator, clean trick pile, configurable rule modes outside the live table |
| Dehla Pakad | Mindi by DroidVeda; MindiBit; Mindi Gold by GAMOSTAR | partnership layout, tens highlighted as objectives, Hide/Cut mode state, simple low-latency controls |
| Poker | PokerStars; PokerBaazi; Adda52 | oval table, stack/pot hierarchy, contextual fold/call/raise strip, lobby filters, compact hand history/status |
| Teen Patti | Octro Teen Patti; Junglee Teen Patti; Teen Patti Royal | five-seat social table, boot/pot prominence, blind/seen state, contextual chaal/raise/fold controls, private table entry |

## Interface principles we will use

1. **Table first.** Once play begins, promotions, shops and non-game chrome disappear.
2. **Player hand stays nearest the thumb zone.** Local cards/actions live at the bottom on mobile and lower center on desktop.
3. **One phase, one primary action group.** Bid, pass, play, capture, declare or bet controls do not compete simultaneously.
4. **Persistent game truth.** Turn, trump, bid, score, pot/board, team and connection state remain visible without opening menus.
5. **Private table is first-class.** Create room, share code/link, seat, ready and reconnect are consistent across all games.
6. **Rules live outside the live table.** Regional rule packs are selected and frozen before the first deal.
7. **Accessibility over decoration.** Large cards, strong contrast, readable numbers, reduced-motion support and no animation that hides legal actions.
8. **Server authority.** The interface only presents legal actions supplied by the authoritative game state; client visuals never decide outcomes.
9. **No hidden-state leakage.** Opponent private state is never sent merely to animate or pre-render the interface.
10. **Shared shell, specialized center.** Seats, avatars, timers, chat, reconnect and score components are shared; the center interaction changes by game family.

## Family-level UI architecture

- **Trick-taking shell:** Spades, Hearts, 29, Court Piece, Dehla Pakad.
- **Capture shell:** Sweep / Seep.
- **Marriage shell:** 21-Card Marriage with meld trays and joker/maal state.
- **Betting shell:** Poker and Teen Patti, with separate rule/settlement engines even though several controls are visually reusable.

The first implementation is deliberately a non-money visual shell. Game rules, legal-action engines and financial settlement remain separate certified layers.
