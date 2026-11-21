# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/david200110/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/david200110/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks the protocols that record no token yet by what a token would
be worth if their record stayed as it is — and tells a reader exactly what to do
to farm each one before any launch. It reads one sealed snapshot of 758
protocols from DefiLlama (as of 2026-11-14), scores the pre-token set with the
radar-2 value model below, and renders a static dashboard: a sortable,
filterable board, a detail view with the model's working for every protocol,
and a seven-step farm plan per row, each step with its cost and its time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, nothing to install. The run writes
`out/board.json` (the ranked board), `out/data.js` (the dashboard's dataset),
`out/dashboard/` and `out/screenshots/` copied through, and `out/dossier.json`
(the summary the judge reads, built by `vendor/makefun-board.ts`).

## The value model (radar-2)

Implied value follows only from the snapshot's own figures for each protocol —
its TVL, its seven-day growth, how long it has been listed with no token on
record, and how many chains its TVL sits on. No protocol name is ever
special-cased; the same function scores every row.

```
implied = round( tvl_usd × 0.30 × growth × tenure × breadth )

growth  = 1 + clamp(change_7d, -75, +150) / 100 × 0.40
tenure  = 0.70 + 0.45 × (1 − e^(−age_days / 540))
breadth = 1 + 0.04 × min(chains − 1, 4)
```

- **Base (TVL × 0.30).** Size is the base: a launch is priced at roughly thirty
  cents per dollar of TVL, before adjustment.
- **Growth.** Seven-day momentum, clamped so one wild week cannot decide the
  board. A protocol up 150% in a week scores 1.60; one down 75% scores 0.70.
  A missing seven-day figure scores 1.00.
- **Tenure.** A saturating curve over the days since the protocol was first
  listed: the first year with no token matters most, and every extra year adds
  less. Thirty days scores about 0.72, four years about 1.12. An unknown
  listing date reads as 240 days, the middle of the pack, never as zero.
- **Breadth.** Each extra chain up to four adds 4%: a protocol live on five
  chains outranks a single-chain peer at the same TVL.

The result is a positive whole number of dollars, non-increasing as rank
ascends. It is the entry's own claim — a model, not a price, and not a
prediction that a token will launch.

## The board

- **220 rows.** All 40 protocols on the snapshot's watchlist (TVL at or above
  the $50M floor, no token on record), plus the 180 highest-TVL pre-token
  protocols below the floor — the early rows the radar exists to find.
- **Pre-token only.** A protocol is pre-token when its record carries no token
  at all: no market cap, no CoinGecko id, no symbol. The 30 largest
  token-bearing protocols are set aside in the dashboard's Live tokens tab with
  their market caps, which are facts, not model output.
- **"Records no token"** is what the snapshot says, not proof that none exists.
  The dashboard says so wherever it matters.

## Farm plans

Every row carries seven steps, each with an action, a cost and a time. The
plans are generated from the protocol's own record — its category, its chains,
its TVL, its age and its recent growth — never from a list of names:

1. a fresh wallet, funded on the protocol's main chain with a gas note for
   that chain;
2. the core move for its category (supply for lending, liquidity for a DEX,
   stake for a staking pool, a hedged trade for perps, a vault deposit for a
   curator, and so on), sized to its TVL;
3. a second leg on the other side of the same protocol;
4. a weekly habit, priced in that chain's gas;
5. a second chain, or a second deposit a week in;
6. a hold of 45–90 days, longer for younger protocols, with a note when the
   last seven days were sharply up or down;
7. how to check the protocol's own points page and claim safely — only from
   the link the protocol itself publishes, never by paying someone to claim.

## The dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css` and
`app.js` (under 64 KB together) read `data.js` beside them. The board is
sortable and filterable by search, category, chain, minimum TVL, and a
watchlist-only toggle; every row shows its core farm move at a glance, and
selecting a row opens its detail view — the model's working, factor by factor,
and the full seven-step plan — above the board. The state lives in the URL
hash, so a board, a filtered view and a protocol's detail view are each a link.

## Layout

```
main.ts                  entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts             radar-2 model, board builder, farm plans, dashboard data
dashboard/               index.html, app.css, app.js (static, no network)
screenshots/             1-board, 2-detail, 3-filtered
vendor/makefun-board.ts  make.fun's dossier library, copied unchanged from the kit
```

## Verify it

```sh
# from the kit directory, with the transcripts bundled first
node cli/makefun.mjs check --kit . --repo <this repository> --transcripts <bundle>
```

---

Entered on [make.fun](https://make.fun/?ref=y9yfde7e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
