// Token Radar's entrypoint (Node 22, standard library only).
//
// Run it from the repository root:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// It reads the sealed snapshot, scores every pre-token protocol with the
// radar-2 model in lib/model.ts, and writes the whole entry to the output
// directory: board.json (the ranked board), data.js (the dashboard's dataset),
// dashboard/ and screenshots/ copied through unchanged, and dossier.json, the
// summary the judge reads, built by the vendored make.fun library.
//
// The grader runs this program twice in a sandbox with no network, a read-only
// repository and a writable /output; both runs must write the same bytes.
// Nothing here reaches for the network, the clock, or a random number.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap and the gate's screenshot and dashboard caps. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const DASH_CAP = { max_files: 400, max_bytes: 4_194_304 };

/** A dossier image name: a letter, digit or underscore first, then those plus . and -. */
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Stop the run with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

/** The value after `--name <value>` or `--name=<value>`, else `fallback`. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot file: --input names a file or the directory holding it. */
function snapshotPath(): string {
  const given = flagValue('input', '/input');
  const file = given.endsWith('.json') ? given : join(given, 'snapshot.json');
  if (!existsSync(file)) {
    fail(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
  return file;
}

/** The output directory: --output, else MAKEFUN_OUTPUT_DIR, else /output. */
function outputDir(): string {
  return flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/**
 * Copy a directory tree of regular files into `to`, skipping dot-names and
 * returning the relative paths copied, in order.
 */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  const walk = (dir: string, rel: string): void => {
    mkdirSync(join(to, rel), { recursive: true });
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      if (statSync(path).isDirectory()) walk(path, childRel);
      else if (statSync(path).isFile()) {
        copyFileSync(path, join(to, childRel));
        copied.push(childRel);
      }
    }
  };
  walk(from, '');
  return copied;
}

const snapshot = parseSnapshot(readFileSync(snapshotPath(), 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const out = outputDir();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyTree(join(repoRoot, 'dashboard'), join(out, 'dashboard'));
if (dashboardFiles.length === 0) fail('dashboard/ holds no files to copy');
const shots = copyTree(join(repoRoot, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and
// compares the bytes, so it must be built from exactly what was just written.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_CAP, dashboard: DASH_CAP }),
);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist\n` +
    `token-radar: ${board.length} rows on the board (${radar.early_size} early rows below the floor), ${radar.live_size} live-token protocols set aside\n` +
    `token-radar: top implied value $${board[0]!.implied_value_usd.toLocaleString('en-US')} (${board[0]!.name}), ` +
    `lowest $${board[board.length - 1]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `token-radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
