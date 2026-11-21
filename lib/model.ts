// Token Radar's value model, board builder and farm-plan generator.
//
// The radar reads one sealed snapshot of the protocol universe and answers two
// questions from that snapshot alone: what would a protocol's token be worth if
// its record stayed as it is, and what should a reader do to farm it before any
// token exists. Nothing here names a protocol. Every number below is computed
// from the snapshot's own figures for that protocol: its TVL, its seven-day
// growth, how long it has been listed with no token on record, and how many
// chains its TVL sits on.
//
// The value model ("radar-2") is a product of four factors:
//
//   implied = round( tvl_usd
//                    x 0.30
//                    x growthFactor(change_7d)
//                    x tenureFactor(age_days)
//                    x breadthFactor(chains) )
//
//   growthFactor  = 1 + clamp(change_7d, -75, +150) / 100 x 0.40
//                   A protocol growing 150% in a week scores 1.60; one down 75%
//                   scores 0.70. The clamp keeps a single wild week from
//                   deciding the board, and a missing 7-day figure scores 1.00.
//
//   tenureFactor  = 0.70 + 0.45 x (1 - e^(-age_days / 540))
//                   A saturating curve, not a straight line: the first year
//                   with no token matters most, and every extra year adds less.
//                   A protocol listed 30 days ago scores about 0.72; one listed
//                   four years ago scores about 1.12. An unknown listing date
//                   is read as 240 days, the middle of the pack, never as zero.
//
//   breadthFactor = 1 + 0.04 x min(max(chains - 1, 0), 4)
//                   Each extra chain up to four adds 4%: a protocol live on
//                   five chains scores 1.16 against a single-chain peer.
//
// The base multiple 0.30 says a token launch is priced at roughly thirty cents
// per dollar of TVL before the three adjustments. That is the model's claim,
// stated here and in the dashboard, not a market fact: the snapshot carries no
// price, and the board never pretends otherwise.
//
// The board ranks pre-token protocols only. A protocol is pre-token when its
// snapshot record carries no token at all: no market cap, no CoinGecko id, no
// symbol. Protocols whose token already trades are set aside in the Live view
// with their market caps, which are facts, not model output. The board covers
// every slug on the snapshot's watchlist, then adds the highest-TVL pre-token
// protocols below the watchlist floor, the early rows the radar exists to find.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The constants of the radar-2 model, as the dashboard prints them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_scale_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.4,
  growth_floor: -75,
  growth_cap: 150,
  tenure_floor: 0.7,
  tenure_range: 0.45,
  tenure_scale_days: 540,
  unknown_age_days: 240,
  breadth_step: 0.04,
  breadth_max_extra_chains: 4,
};

/** The model's version label, printed by the dashboard and the run log. */
export const MODEL_VERSION = 'radar-2';

/** Early rows: pre-token protocols below the watchlist floor, by TVL. */
export const EARLY_ROWS = 180;

/** Live-token protocols shown apart from the ranking, by market cap. */
export const LIVE_ROWS = 30;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_factor: number;
    tenure_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row as the dashboard reads it: the same figures, structured steps. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_factor: number;
  tenure_factor: number;
  breadth_factor: number;
  watchlist: boolean;
  farm_steps: FarmStep[];
}

/** A live-token protocol, shown apart with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs to render, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/**
 * One protocol's implied value under the radar-2 model, with each factor kept
 * apart so the dashboard can show the working, not just the answer.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthFactor: number; tenureFactor: number; breadthFactor: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finiteNumber(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForTenure = age ?? model.unknown_age_days;
  const tenureFactor =
    model.tenure_floor + model.tenure_range * (1 - Math.exp(-Math.max(ageForTenure, 0) / model.tenure_scale_days));
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra_chains);
  const breadthFactor = 1 + model.breadth_step * extraChains;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * model.base_multiple * growthFactor * tenureFactor * breadthFactor),
  );
  return { implied, growthPct, growthFactor, tenureFactor, breadthFactor, age };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not an exchange, not versioned. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The board's rows, strongest implied value first, ranked 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the floor, highest TVL first.
  // A chosen protocol stays chosen; the early rows only ever add to the board.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.v.growthPct,
      growth_factor: round4(s.v.growthFactor),
      tenure_factor: round4(s.v.tenureFactor),
      breadth_factor: round4(s.v.breadthFactor),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepToString),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One farm step as the single string board.json carries. */
export function stepToString(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

// ------------------------------------------------------------ farm plans

/** The first chain a protocol names, or a neutral phrase when it names none. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position takes, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 400;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: the younger it is, the longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 45;
}

/** What one transaction costs on a chain, in words a reader can budget with. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $4 to $12 of gas per transaction on Ethereum';
  if (c.includes('solana')) return 'a fraction of a cent in fees per transaction on Solana';
  if (c.includes('bitcoin')) return 'about $1 to $5 of on-chain fees per transaction on Bitcoin';
  if (c.includes('tron')) return 'about $1 to $2 of energy and fees per transaction on Tron';
  if (c.includes('binance') || c === 'bsc' || c.includes('bnb')) return 'about $0.10 to $0.30 of gas per transaction on BNB Chain';
  if (c.includes('avalanche')) return 'about $0.20 to $0.80 of gas per transaction on Avalanche';
  if (c.includes('sui') || c.includes('aptos') || c.includes('near')) return 'a few cents of gas per transaction';
  return 'a few cents to about $1 of gas per transaction on this chain';
}

/** The weekly cadence cost on a chain: cheap chains cost almost nothing to revisit. */
function weeklyGasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $4 of gas a week';
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos')) return 'pennies of fees a week';
  return 'well under $1 of gas a week';
}

/** A category playbook: the core move, its second leg, and the weekly habit.
 * `secondCost` names what the second leg costs when it needs no new capital
 * (it reuses what the core move already put in); otherwise the second leg
 * costs about a quarter of the position. */
interface Playbook {
  core: string;
  second: string;
  weekly: string;
  secondCost?: string;
}

/** Placeholders are filled in from the protocol, in either spelling. */
function fill(template: string, ctx: { name: string; capital: number; chain: string; tvl: string; gas: string; quarter: number }): string {
  return template
    .replaceAll('${name}', ctx.name)
    .replaceAll('{name}', ctx.name)
    .replaceAll('${capital}', String(ctx.capital))
    .replaceAll('{capital}', String(ctx.capital))
    .replaceAll('${chain}', ctx.chain)
    .replaceAll('{chain}', ctx.chain)
    .replaceAll('${tvl}', ctx.tvl)
    .replaceAll('{tvl}', ctx.tvl)
    .replaceAll('${gas}', ctx.gas)
    .replaceAll('{gas}', ctx.gas)
    .replaceAll('${quarter}', String(ctx.quarter))
    .replaceAll('{quarter}', String(ctx.quarter));
}

const PLAYBOOKS: Array<{ match: RegExp; play: Playbook }> = [
  {
    match: /lend|cdp|collateral/,
    play: {
      core: 'Supply $${capital} of USDC to {name} on {chain} as collateral, at a conservative loan-to-value so a price swing never liquidates you.',
      second:
        'Borrow about a quarter of what you supplied, in a stablecoin, and either hold it or repay it within the same week so the borrow side of your activity is on record too.',
      weekly:
        'Top the supply up by $10 or repay a little of the borrow each week, and check the borrow rate before you do.',
    },
  },
  {
    match: /dex|yield|leveraged farm|liquidity manager|farm/,
    play: {
      core: 'Provide $${capital} of liquidity to {name}\u2019s deepest pool on {chain}, in the pair the protocol itself routes most volume through.',
      second:
        'Swap about a quarter of the deposit through the same pool in both directions, so your wallet has both a liquidity position and swap history on {name}.',
      weekly: 'Claim or compound the pool fees once a week, and rebalance the range if the price has drifted out of it.',
    },
  },
  {
    match: /bridge|canonical bridge|cross chain/,
    play: {
      core: 'Bridge $${capital} of USDC to {chain} through {name}, choosing the route the protocol marks as its own rather than a third-party hop.',
      second:
        'Use the bridged funds on the destination chain: deposit them into that chain\u2019s largest lending market or DEX for at least a week, so the bridge is a move, not a round trip.',
      secondCost: 'no new capital, just ${gas}',
      weekly: 'Route one small transfer, $10 to $25, through {name} to a different destination chain each week.',
    },
  },
  {
    match: /stak|restak/,
    play: {
      core: 'Stake $${capital} of the chain\u2019s staking asset through {name} on {chain} and hold the receipt token it issues.',
      second:
        'Put the receipt token to work once: supply it to a lending market or a liquidity pool on {chain}, so the position earns in two places.',
      secondCost: 'no new capital, just ${gas}',
      weekly: 'Restake the staking rewards once a week instead of letting them sit idle.',
    },
  },
  {
    match: /perpetual|derivative|options vault|basis trad/,
    play: {
      core: 'Deposit $${capital} of USDC as margin on {name} and open one small hedged position, sized so a 10% move against you costs under $5.',
      second:
        'Close the first position after a day and open a second one in the opposite direction, so your history shows more than a single trade.',
      secondCost: 'no new capital, just ${gas}',
      weekly: 'Place one small trade a week, alternating long and short, and never let open margin exceed half your deposit.',
    },
  },
  {
    match: /prediction/,
    play: {
      core: 'Fund {name} with $${capital} and take a position in one market that settles within the next two weeks, on an outcome you have actually read up on.',
      second:
        'Take a second, smaller position in a different market on {name}, so the wallet shows breadth rather than a single bet.',
      weekly: 'Resolve or roll one market a week, and keep a note of which markets you entered and why.',
    },
  },
  {
    match: /curator|allocator|risk/,
    play: {
      core: 'Deposit $${capital} into one of {name}\u2019s curated vaults on {chain}, picking the vault whose strategy document you have read end to end.',
      second:
        'Allocate a quarter of the deposit to a second vault from the same curator, with a different risk profile, so the position is diversified inside {name}.',
      weekly: 'Read the vault\u2019s weekly allocation note and move up to 10% of the position if the strategy has changed.',
    },
  },
  {
    match: /stable|dual-token/,
    play: {
      core: 'Mint or deposit $${capital} of the stable asset through {name} on {chain}, and hold it in the wallet that will farm the protocol.',
      second:
        'Provide the stable asset as liquidity against USDC on {chain}\u2019s largest DEX, so the position earns fees while it waits.',
      weekly: 'Check the peg once a week; if it has slipped more than 0.5%, move the position back to USDC and re-enter later.',
    },
  },
  {
    match: /rwa/,
    play: {
      core: 'Mint $${capital} of {name}\u2019s yield-bearing asset on {chain} and hold it in the farming wallet.',
      second:
        'Use the yield asset as collateral in a lending market on {chain} to borrow a small amount of USDC, then repay it within the week.',
      weekly: 'Claim the accrued yield once a week and restake or re-mint it into the same asset.',
    },
  },
  {
    match: /insurance/,
    play: {
      core: 'Buy $${capital} of cover from {name} on {chain} for a risk you actually hold, such as a lending position or a stablecoin depeg.',
      second:
        'Stake a small amount into {name}\u2019s cover pool as an underwriter, so your wallet appears on both sides of the market.',
      weekly: 'Review the active cover once a week and renew it before it lapses rather than letting it gap.',
    },
  },
  {
    match: /yield aggregator/,
    play: {
      core: 'Deposit $${capital} into {name}\u2019s highest-TVL vault on {chain} and let its strategy run.',
      second:
        'Split a quarter of the deposit into a second vault with a different underlying strategy, so the farm is not one vault deep.',
      weekly: 'Harvest the vault rewards once a week and redeposit them into the same vault.',
    },
  },
  {
    match: /chain$/,
    play: {
      core: 'Bridge $${capital} of USDC onto {chain} and swap half of it for the chain\u2019s native token through {name}\u2019s own DEX or router.',
      second:
        'Stake a portion of the native token with a validator or staking pool on {chain}, and keep the rest liquid for dapps.',
      secondCost: 'no new capital, just ${gas}',
      weekly: 'Make one on-chain transaction a week on {chain}: a swap, a stake top-up, or a vote in a dapp you use.',
    },
  },
  {
    match: /payment|crypto card/,
    play: {
      core: 'Load $${capital} onto {name}\u2019s card or payments balance on {chain} and make one real purchase with it.',
      second:
        'Set up a recurring payment or a second purchase in a different category, so the account shows repeat use, not a single load.',
      weekly: 'Spend a small amount each week through {name} and keep the receipts in your farm log.',
    },
  },
  {
    match: /privacy/,
    play: {
      core: 'Deposit $${capital} into {name}\u2019s shielded pool on {chain} and withdraw it to a fresh address a day later.',
      second:
        'Make one private transfer through {name} to an address you control, and keep the note or key the protocol gives you.',
      weekly: 'Use the shielded pool once a week for a small amount, keeping a steady pattern rather than one large move.',
    },
  },
  {
    match: /governance/,
    play: {
      core: 'Lock or delegate $${capital} of voting power through {name} on {chain} and vote on the next live proposal.',
      second:
        'Delegate a portion of the position to a second delegate or vote on a second proposal in the same cycle.',
      secondCost: 'no new capital, just ${gas}',
      weekly: 'Vote on every new proposal each week, and read the forum thread before you cast the vote.',
    },
  },
  {
    match: /index/,
    play: {
      core: 'Buy $${capital} of {name}\u2019s index token on {chain} and hold it in the farming wallet.',
      second:
        'Provide the index token as liquidity against USDC on {chain}\u2019s largest DEX, so the position earns fees while it waits.',
      weekly: 'Check the index composition once a week; if a rebalance is announced, hold through it rather than selling.',
    },
  },
];

const DEFAULT_PLAY: Playbook = {
  core: 'Deposit $${capital} of USDC into {name} on {chain} and keep the position open, using the protocol\u2019s main feature rather than a side page.',
  second:
    'Use a second feature of {name} once: if it has a swap, a vault, a vote or a borrow, do one of them with $25 so the wallet is not one-action deep.',
  weekly: 'Do one qualifying action a week on {name} \u2014 a deposit, a swap, a vote or a claim \u2014 and keep the pattern steady.',
};

/** The playbook for a protocol's category, by keyword; the default when none matches. */
function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) if (entry.match.test(c)) return entry.play;
  return DEFAULT_PLAY;
};

/** A short money figure: $2.75B, $514M, $48K. */
function moneyShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record \u2014 category, chains,
 * TVL, age and recent growth \u2014 never from a hand-written list of names.
 * Two protocols in the same category share a shape, never a sentence: the
 * name, the chain, the capital, the TVL and the hold all come from the record.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const play = playbookFor(p);
  const ctx = { name: p.name, capital, chain, tvl: moneyShort(p.tvl_usd), gas: gasNote(chain), quarter: Math.round(capital / 4) };
  const growth = p.change_7d;
  const growthNote =
    growth === null
      ? ''
      : growth < 0
        ? ` TVL fell ${Math.abs(growth).toFixed(1)}% in the last 7 days, so a longer hold matters more than a bigger deposit.`
        : growth > 20
          ? ` TVL is up ${growth.toFixed(1)}% in 7 days and the crowd is arriving; a steady position beats chasing the move.`
          : '';
  const steps: FarmStep[] = [
    {
      action: `Open a fresh wallet that holds only this farm's funds, and write its seed phrase on paper, never in a screenshot or a chat. Fund it with $${capital} of USDC on ${chain}, plus enough of the chain's native token for gas.`,
      cost: gasNote(chain),
      time: '10 minutes to set up',
    },
    {
      action: `${fill(play.core, ctx)} ${p.name} already holds ${moneyShort(p.tvl_usd)} of TVL, so a $${capital} position is a small, liquid slice of it.`,
      cost: `$${capital} of capital and ${gasNote(chain)}`,
      time: '15 minutes to set up',
    },
    {
      action: fill(play.second, ctx),
      cost: play.secondCost !== undefined ? fill(play.secondCost, ctx) : `about $${Math.round(capital / 4)} of capital and ${gasNote(chain)}`,
      time: '10 minutes',
    },
    {
      action: fill(play.weekly, ctx),
      cost: weeklyGasNote(chain),
      time: '10 minutes a week',
    },
    secondChain === null
      ? {
          action: `Deepen the position instead of widening it: add about half the capital again after the first week, as a second, separate deposit, so the farm shows activity across two deposits rather than one.`,
          cost: `about $${Math.round(capital / 2)} of extra capital`,
          time: '10 minutes, one week in',
        }
      : {
          action: `Repeat the core position a second time on ${secondChain}, with about half the capital, so the farm is visible on two chains instead of one.`,
          cost: `about $${Math.round(capital / 2)} of extra capital and ${gasNote(secondChain)}`,
          time: '15 minutes',
        },
    {
      action: `Keep every position open for at least ${hold} days so the activity is counted in more than one snapshot.${growthNote}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      action: `Once a week, open ${p.name}'s own points or rewards page from the link the protocol itself publishes and check what counted. Claim only from that link, never pay anyone to claim for you, and write the wallet, the dates and every transaction hash in a farm log.`,
      cost: 'free to check, and never pay to claim',
      time: '10 minutes a week',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with its farm plan attached. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_factor: row.model.growth_factor,
    tenure_factor: row.model.tenure_factor,
    breadth_factor: row.model.breadth_factor,
    watchlist: onWatchlist,
    farm_steps: farmSteps(
      {
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        mcap_usd: row.mcap_usd,
        listed_at: row.listed_at,
        gecko_id: row.gecko_id,
        symbol: row.symbol,
      },
      row.age_days,
    ),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape scored. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot file is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('the snapshot file does not hold a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('the snapshot carries no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('the snapshot carries no source string');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('the snapshot carries no positive whole floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('the snapshot carries no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('the snapshot carries no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`protocol ${i} of the snapshot is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} of the snapshot lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Check a board against the gate's shape and say why it would be refused,
 * or null when it passes. The checks are the gate's own rows: every watchlist
 * slug covered, ranks exactly 1..N, implied values never rising with rank, at
 * least two distinct values, and every row's farm plan within its bounds.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const onBoard = new Set<string>();
  for (const r of board) onBoard.add(r.slug);
  const absent = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (absent.length > 0) {
    return `${absent.length} watchlist protocol${absent.length === 1 ? ' is' : 's are'} missing from the board: ${absent.slice(0, 5).join(', ')}`;
  }
  const seenRanks = new Set<number>();
  for (const r of board) {
    if (!Number.isSafeInteger(r.rank) || r.rank < 1 || r.rank > board.length) {
      return `${r.slug} carries rank ${r.rank}, outside 1..${board.length}`;
    }
    if (seenRanks.has(r.rank)) return `rank ${r.rank} appears twice`;
    seenRanks.add(r.rank);
  }
  let top = Number.POSITIVE_INFINITY;
  let distinct = 0;
  let previous: number | null = null;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}, not a positive whole number of dollars`;
    }
    if (r.implied_value_usd > top) return `${r.slug} is ranked below a row worth less than it`;
    top = r.implied_value_usd;
    if (previous === null || r.implied_value_usd !== previous) distinct++;
    previous = r.implied_value_usd;
  }
  if (board.length >= 2 && distinct < 2) {
    return `all ${board.length} rows are worth the same $${board[0]!.implied_value_usd}: the board ranks nothing`;
  }
  for (const r of board) {
    const n = r.farm_steps.length;
    if (n < 3 || n > 12) return `${r.slug} carries ${n} farm steps, outside 3..12`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters, outside 20..600`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: `window.RADAR = {...};`, no fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
