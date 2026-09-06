# Online Card Club — Canonical Project Decisions

This file is the durable working source for owner-approved product, architecture, governance and game-rule decisions that were previously spread across multiple project chats. It intentionally excludes duplicate chatter, temporary operational notes, superseded proposals and rejected alternatives.

When older chat wording conflicts with this file, the newer owner-approved rule or merged implementation evidence wins. Current certification files and merged code remain authoritative for technical implementation details.

## Governance and PM authority

- ChatGPT acts as project manager and may sequence, design, implement, test, audit, review and advance routine project work independently.
- Do not pause for routine acknowledgements or repeated permission.
- Escalate only genuine owner-level decisions: material business/economic changes, legal or jurisdiction choices, capital commitments, credentials/access, contractual commitments, irreversible product choices, or real-money launch authorization.
- Silence is not a blocker for routine technical work.
- Security and integrity gates may fail closed; real-money operation remains disabled until all mandatory certification gates are GREEN and explicit owner launch authorization is recorded.
- Privileged/admin-security direction is conservative: dual-control and recoverable/auditable administration are preferred over convenience.

## Locked architecture

The V1.2 direction remains the architectural baseline, organized around five cooperating cores:

1. Game Core
2. Financial Core
3. Security Core
4. Risk Core
5. Resilience / Crisis Core

Durable invariants:

- Owner-managed external payments; platform players do not directly mint money-like value.
- Club-specific redeemable chip ledgers with strict tenant isolation.
- Table custody/escrow for value committed to play.
- Immutable double-entry accounting.
- Value Control Plane governing value mutation.
- Independent deterministic settlement verification / shadow verification.
- Financial Integrity Controller binding settlement to authoritative persisted game outcomes.
- Hidden-state isolation between players, spectators and tenants.
- Anti-cheat / fraud graph and risk controls.
- Resilience, recovery, crisis handling and auditability are first-class architecture concerns.

## Product catalogue

The approved nine-game catalogue is:

1. 21-Card Marriage
2. Spades
3. Hearts
4. 29
5. Sweep / Seep
6. Court Piece
7. Dehla Pakad
8. Poker — No-Limit Texas Hold'em
9. Teen Patti — Classic Teen Patti baseline

Game-family architecture:

- Trick-taking shared core: Spades, Hearts, 29, Court Piece, Dehla Pakad.
- Capture/table-card core: Sweep / Seep.
- Dedicated meld/joker core: 21-Card Marriage.
- Variable-betting cores: No-Limit Texas Hold'em and Classic Teen Patti.

## Revenue and settlement policy

The earlier 2.5% proposal is cancelled. The only approved baseline is 1%.

Fixed-amount win games:

- Spades
- Hearts
- 29
- Sweep / Seep
- Court Piece
- Dehla Pakad

Policy: **1% board fee on the fixed board amount**.

Variable-win games:

- 21-Card Marriage
- No-Limit Texas Hold'em
- Teen Patti

Policy: **1% cut from positive winning amount**.

Accounting invariants:

- Pure game outcome is computed first; revenue is a separate downstream layer.
- No double charging.
- Losing players do not pay a winner cut.
- Revenue posts explicitly to dedicated club-revenue ledger accounts; no silent rake.
- Integer minor-unit arithmetic and deterministic rounding only.

## Infrastructure boundary

- Synology DS923+ is completely excluded from Card Club.
- No NAS or home-hosted component may be part of production, staging, backup, logs or recovery.
- Production is cloud-hosted behind a WAF/load-balancer with multiple application/game nodes, managed/separate PostgreSQL, Redis-class coordination/cache service, and encrypted cloud backups in a separate backup location/account.
- Exact compute sizing remains benchmark-driven rather than permanently locked.
- The Dell workstation/AIO is for development or administration only, never a production dependency.

## 21-Card Marriage canonical baseline

Table configuration:

- Support both **Open Maal** and **Hidden Maal**.
- `maalMode` is selected before dealing and is immutable for the round/table configuration.
- Hidden Maal is revealed per seat only after that seat qualifies; one player's qualification never reveals it to opponents or spectators.
- Standard implementation baseline uses three decks, 21 cards per player and 2–5 players.

Maal definition and qualification:

- The selected natural Maal card is Tiplu.
- Same-suit adjacent lower rank is Jhiplu; same-suit adjacent higher rank is Poplu.
- Normal qualification: 3 valid pure melds.
- Alternative qualification: 7 Dublees.
- 8 Dublees meets the Dublee finish threshold.

Approved points:

- 1 Jhiplu = 2
- 1 Tiplu = 3
- 1 Poplu = 2
- 2 Jhiplu = 5
- 2 Tiplu = 10
- 2 Poplu = 5
- Complete natural Marriage (Jhiplu + Tiplu + Poplu) = 10 total; do not add the three component single-card values again for the same consumed cards.
- Tunnela = 2
- Dublee = 0 bonus points
- Printed Joker = 1 point when Jokers are used

Joker purity rule:

- Printed Joker may act as a wildcard only in **impure** combinations.
- Printed Joker cannot make or complete a pure sequence/set.
- Printed Joker cannot create a pure Tunnela.
- Printed Joker cannot substitute inside a natural Marriage.

## Trick-taking and capture baselines

The merged server-authoritative implementations are the working standard baseline for the five trick-taking games and Sweep / Seep. Important durable choices include:

- Exact-deck validation, server turn authority, ownership checks and hidden-state isolation.
- Spades: ordered bidding, standard contract/nil/bag scoring and spade-break restrictions.
- Hearts: standard pass cycle and cumulative target scoring.
- 29: partial-deal auction, strict increasing bids, hidden selected trump and deterministic contract scoring.
- Court Piece: 5+8 setup, dealer-right trump caller, majority/court progression.
- Dehla Pakad: announced trump, four-ten/consecutive-hand Kot logic and centre-pile capture semantics.
- Sweep / Seep: northern Indian 100-point baseline, 9–13 opening bid, houses/capture/cement logic, 50-point normal sweep, 25-point opening sweep, no final-play sweep bonus, and Baazi progression.

Regional variants not explicitly approved must remain isolated rather than silently mixed into these baselines.

## Poker canonical baseline

Poker means **No-Limit Texas Hold'em**.

Current baseline includes:

- 2–9 players.
- Correct blind/action order including heads-up positioning.
- Fold/check/call/bet/raise/all-in legality.
- Full minimum-raise sizing and short-all-in non-reopen semantics.
- Automatic runout where appropriate.
- Best-five-of-seven deterministic ranking.
- Main/side-pot construction and independent side-pot resolution.
- Deterministic odd-chip allocation and strict chip conservation.
- Hole cards remain hidden from public/opponents until legitimate showdown disclosure.

## Teen Patti canonical baseline

Teen Patti means the approved **Classic Teen Patti** baseline:

- Blind/seen play.
- Chaal.
- Pack.
- Seen-to-seen paid sideshow under server-enforced eligibility.
- Showdown.
- Ranking: Trail > Pure Sequence > Sequence > Color > Pair > High Card.
- A-K-Q is the highest sequence; A-2-3 is second-highest in the implemented baseline.
- Hidden cards remain isolated; sideshow comparison does not leak cards.
- Pure game pot/result is conserved before downstream revenue accounting.

## Integrity and certification state

Current certified lineage establishes:

- Server-rule cores exist for all nine approved games.
- The auditable commit-reveal fair-shuffle primitive is merged and CI-certified.
- Shuffle commitments are bound to tenant/table/hand/game context; server and participant entropy drive rejection-sampled Fisher-Yates shuffling with deterministic post-hand reconstruction.
- The table shuffle orchestrator persists the commitment manifest before reveal consumption, persists the exact deck digest before routing, and rejects raw or forged decks from the audited routing path.
- Post-commit aborts are append-only terminal events that prevent later deck issuance; once a deck is issued the same hand cannot be relabelled as aborted.
- Disclosure evidence is cryptographically verified before its digest is appended, while live audit tables deliberately do not persist plaintext seed reveals.
- v2.2 remains AMBER pending reconnect/resume hidden-state tests, spectator/delayed-observer policy, multi-table/multi-tenant isolation stress, and full Game Integrity Controller certification.
- v2.0 repository-governance status remains AMBER because `main` is still unprotected; issue #3 tracks protected-main governance.
- Real-money operation is disabled.

## Explicitly superseded / rejected — do not resurrect

The following are non-canonical and must not re-enter design or implementation unless the owner explicitly changes them later:

- **2.5% fee/cut** — superseded by 1%.
- **Hidden-only Maal** — superseded by selectable Open/Hidden Maal before play.
- **NAS / DS923+ / home production hosting** — explicitly excluded.
- **Printed Joker as pure-card substitute** — rejected; Joker wild behavior is impure-only.
- **Double-counting a complete Marriage plus the same component-card single scores** — rejected.
- Unapproved alternate Poker variants — Poker baseline is No-Limit Texas Hold'em.
- Unapproved Teen Patti variants — Classic baseline is canonical.
- Regional game variants that were merely discussed but not approved.
- Old progress percentages — temporary estimates, not project truth.
- Historical failed CI runs that were subsequently fixed — useful debugging history only, not current status.
- The 7 September Codex-token-reset note — temporary operational chatter, not architecture or product policy.
- Repeated “yes / go ahead / continue” acknowledgements — execution permission already captured by the PM governance rule above.
- Historical v1.9 conversational/generated evidence that was never regenerated or committed — not authoritative certification evidence.

## Working rule for future conversations

Carry forward this file plus current merged code/certification evidence. Do not revive discarded chat proposals simply because they appeared earlier. New explicit owner decisions override this file and should be folded back into it when they materially change the project.
