#!/usr/bin/env node
// Release tooling for the Changesets flow (AR-20..AR-24, docs/ha-release.md).
//
//   node scripts/release.mjs sync              ha-app/package.json version → ha-app/config.yaml
//   node scripts/release.mjs check [--tag vX]  package.json, config.yaml, CHANGELOG.md (and tag) agree
//   node scripts/release.mjs version           prints the product version
//   node scripts/release.mjs notes [version]   prints the CHANGELOG entry (GitHub Release text)
//   node scripts/release.mjs guard <base-ref>  fails if apps/, packages/ or ha-app/ changed
//                                              since <base-ref> without a changeset (AR-24)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_LINE = /^version:[ \t]*['"]?([^'"\s#]+)['"]?[ \t]*$/m;

/** The product version: Changesets versions the private package ha-app (AR-21). */
export function readProductVersion(root) {
  return JSON.parse(readFileSync(path.join(root, 'ha-app/package.json'), 'utf8')).version;
}

export function readConfigVersion(yaml) {
  const match = VERSION_LINE.exec(yaml);
  if (!match) throw new Error('ha-app/config.yaml has no "version:" line');
  return match[1];
}

/** Rewrites only the version line, keeping comments and formatting of config.yaml. */
export function setConfigVersion(yaml, version) {
  readConfigVersion(yaml);
  return yaml.replace(VERSION_LINE, `version: '${version}'`);
}

/** The body of the `## <version>` entry (a heading may continue, e.g. "## 0.7.0 – first …"). */
export function changelogEntry(markdown, version) {
  const lines = markdown.split('\n');
  const heading = new RegExp(`^## ${version.replaceAll('.', '\\.')}(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** Problems that would make a release inconsistent (TR-20); empty when everything matches. */
export function checkRelease(root, tag) {
  const problems = [];
  const version = readProductVersion(root);
  const configVersion = readConfigVersion(
    readFileSync(path.join(root, 'ha-app/config.yaml'), 'utf8'),
  );
  if (configVersion !== version) {
    problems.push(
      `ha-app/config.yaml has version ${configVersion}, ha-app/package.json ${version} – run "npm run version-packages"`,
    );
  }
  const changelog = readFileSync(path.join(root, 'ha-app/CHANGELOG.md'), 'utf8');
  if (!changelogEntry(changelog, version)) {
    problems.push(`ha-app/CHANGELOG.md has no entry "## ${version}"`);
  }
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(`tag ${tag} does not match version ${version} (expected v${version})`);
  }
  return problems;
}

/** Paths whose changes need a changeset (AR-24). */
const RELEASED_PATHS = /^(apps|packages|ha-app)\//;
const CHANGESET_FILE = /^\.changeset\/[^/]+\.md$/;

/**
 * AR-24: `changes` are `git diff --name-status` entries. A change to released paths needs an
 * added changeset (`npx changeset`, or `npx changeset --empty` for internal changes). The
 * "Version Packages" commit consumes changesets instead – it is recognised by its change of
 * ha-app/package.json together with deleted changesets.
 */
export function guardProblems(changes) {
  const relevant = changes.filter((c) => RELEASED_PATHS.test(c.path));
  if (relevant.length === 0) return [];
  const isChangeset = (c) => CHANGESET_FILE.test(c.path) && !c.path.endsWith('/README.md');
  if (changes.some((c) => c.status !== 'D' && isChangeset(c))) return [];
  const isVersionCommit =
    changes.some((c) => c.path === 'ha-app/package.json') &&
    changes.some((c) => c.status === 'D' && isChangeset(c));
  if (isVersionCommit) return [];
  return [
    `Changed ${relevant.length} file(s) in apps/, packages/ or ha-app/ without a changeset ` +
      `(e.g. ${relevant[0].path}). Run "npx changeset" and describe the change for users, ` +
      `or "npx changeset --empty" if it is internal only.`,
  ];
}

export function parseNameStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      // Renames/copies (R100, C75) list old and new path – the new one counts.
      return { status: status[0], path: paths[paths.length - 1] };
    });
}

function main([command, ...args]) {
  const root = process.cwd();
  switch (command) {
    case 'sync': {
      const file = path.join(root, 'ha-app/config.yaml');
      const version = readProductVersion(root);
      writeFileSync(file, setConfigVersion(readFileSync(file, 'utf8'), version));
      console.log(`ha-app/config.yaml → version ${version}`);
      return 0;
    }
    case 'check': {
      const tagIndex = args.indexOf('--tag');
      const problems = checkRelease(root, tagIndex === -1 ? undefined : args[tagIndex + 1]);
      for (const problem of problems) console.error(`✗ ${problem}`);
      if (problems.length === 0) console.log(`✓ release ${readProductVersion(root)} consistent`);
      return problems.length === 0 ? 0 : 1;
    }
    case 'version':
      console.log(readProductVersion(root));
      return 0;
    case 'notes': {
      const version = args[0] ?? readProductVersion(root);
      const entry = changelogEntry(
        readFileSync(path.join(root, 'ha-app/CHANGELOG.md'), 'utf8'),
        version,
      );
      if (!entry) {
        console.error(`ha-app/CHANGELOG.md has no entry for ${version}`);
        return 1;
      }
      console.log(entry);
      return 0;
    }
    case 'guard': {
      const base = args[0];
      if (!base) {
        console.error('usage: release.mjs guard <base-ref>');
        return 2;
      }
      const diff = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`], {
        encoding: 'utf8',
      });
      const problems = guardProblems(parseNameStatus(diff));
      for (const problem of problems) console.error(`✗ ${problem}`);
      if (problems.length === 0) console.log('✓ changeset present (or not needed)');
      return problems.length === 0 ? 0 : 1;
    }
    default:
      console.error(
        'usage: release.mjs sync | check [--tag vX.Y.Z] | version | notes [v] | guard <base>',
      );
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
