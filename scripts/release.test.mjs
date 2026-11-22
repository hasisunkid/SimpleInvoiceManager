import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changelogEntry,
  checkRelease,
  guardProblems,
  parseNameStatus,
  readConfigVersion,
  readProductVersion,
  setConfigVersion,
} from './release.mjs';

const repo = path.resolve(import.meta.dirname, '..');

describe('config.yaml version (AR-21)', () => {
  const yaml = "# comment\nname: X\nversion: '0.7.0'\nslug: s\n";

  it('reads quoted and unquoted versions', () => {
    expect(readConfigVersion(yaml)).toBe('0.7.0');
    expect(readConfigVersion('version: "1.2.3"\n')).toBe('1.2.3');
    expect(readConfigVersion('version: 1.2.3 \n')).toBe('1.2.3');
    expect(() => readConfigVersion('name: X\n')).toThrow(/version/);
  });

  it('rewrites only the version line', () => {
    expect(setConfigVersion(yaml, '0.8.0')).toBe("# comment\nname: X\nversion: '0.8.0'\nslug: s\n");
  });

  it('the repository is consistent (package.json = config.yaml, changelog entry)', () => {
    expect(checkRelease(repo)).toEqual([]);
  });
});

describe('changelogEntry (AR-23)', () => {
  const md = [
    '# Changelog',
    '',
    '## 0.8.0',
    '',
    '### Minor Changes',
    '',
    '- Show the version.',
    '',
    '## 0.7.0 – first release',
    '',
    '- Everything.',
  ].join('\n');

  it('returns the entry of one version', () => {
    expect(changelogEntry(md, '0.8.0')).toBe('### Minor Changes\n\n- Show the version.');
    expect(changelogEntry(md, '0.7.0')).toBe('- Everything.');
  });

  it('does not confuse similar versions', () => {
    expect(changelogEntry(md, '0.8')).toBeNull();
    expect(changelogEntry(md, '0.8.1')).toBeNull();
  });
});

describe('changeset guard (AR-24)', () => {
  const changes = (text) => parseNameStatus(text);

  it('accepts changes outside the released paths', () => {
    expect(guardProblems(changes('M\tdocs/adr/0001.md\nM\tREADME.md\n'))).toEqual([]);
  });

  it('requires a changeset for app, package and ha-app changes', () => {
    for (const file of ['apps/backend/src/app.ts', 'packages/domain/src/x.ts', 'ha-app/run.sh']) {
      expect(guardProblems(changes(`M\t${file}\n`))).toHaveLength(1);
    }
  });

  it('accepts an added changeset, also an empty one', () => {
    expect(
      guardProblems(changes('M\tapps/backend/src/app.ts\nA\t.changeset/brave-lions-dance.md\n')),
    ).toEqual([]);
  });

  it('does not count the README or a deleted changeset as a new changeset', () => {
    expect(
      guardProblems(changes('M\tapps/backend/src/app.ts\nM\t.changeset/README.md\n')),
    ).toHaveLength(1);
    expect(
      guardProblems(changes('M\tapps/backend/src/app.ts\nD\t.changeset/old.md\n')),
    ).toHaveLength(1);
  });

  it('accepts the "Version Packages" commit that consumes changesets', () => {
    const versionCommit =
      'M\tha-app/package.json\nM\tha-app/config.yaml\nM\tha-app/CHANGELOG.md\nD\t.changeset/a.md\n';
    expect(guardProblems(changes(versionCommit))).toEqual([]);
  });

  it('uses the new path of renamed files', () => {
    expect(changes('R100\told/x.ts\tapps/x.ts\n')).toEqual([{ status: 'R', path: 'apps/x.ts' }]);
  });
});

/**
 * TR-20: `changeset version` with a test changeset bumps ha-app/package.json, config.yaml and
 * CHANGELOG.md consistently, so the release workflow's tag check passes. Runs the real CLI and
 * the real `version-packages` steps on a copy of the release-relevant files.
 */
describe('version flow (TR-20)', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  function run(command, args) {
    return execFileSync(command, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  }

  it('bumps package.json, config.yaml and CHANGELOG.md together', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sim-release-'));
    cpSync(path.join(repo, 'ha-app'), path.join(dir, 'ha-app'), { recursive: true });
    cpSync(path.join(repo, '.changeset/config.json'), path.join(dir, '.changeset/config.json'));
    symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'release-test', private: true, workspaces: ['ha-app'] }),
    );
    // npm workspaces are detected via the lockfile.
    writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ name: 'release-test', lockfileVersion: 3, packages: {} }),
    );
    // Offline changelog generator: the GitHub one needs a token and network.
    const config = JSON.parse(readFileSync(path.join(dir, '.changeset/config.json'), 'utf8'));
    config.changelog = '@changesets/cli/changelog';
    config.ignore = [];
    delete config.$schema;
    writeFileSync(path.join(dir, '.changeset/config.json'), JSON.stringify(config));
    writeFileSync(
      path.join(dir, '.changeset/test-change.md'),
      '---\n"@sim/ha-app": minor\n---\n\nShow the app version on the login screen.\n',
    );
    run('git', ['init', '-q']);
    run('git', ['add', '-A']);
    run('git', [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'test',
    ]);

    const before = readProductVersion(dir);
    const [major, minor] = before.split('.').map(Number);
    const expected = `${major}.${minor + 1}.0`;

    run(process.execPath, [path.join(repo, 'node_modules/@changesets/cli/bin.js'), 'version']);
    run(process.execPath, [path.join(repo, 'scripts/release.mjs'), 'sync']);

    expect(readProductVersion(dir)).toBe(expected);
    expect(readConfigVersion(readFileSync(path.join(dir, 'ha-app/config.yaml'), 'utf8'))).toBe(
      expected,
    );
    const changelog = readFileSync(path.join(dir, 'ha-app/CHANGELOG.md'), 'utf8');
    expect(changelogEntry(changelog, expected)).toContain(
      'Show the app version on the login screen.',
    );
    // Existing entries are kept (AR-23).
    expect(changelogEntry(changelog, before)).not.toBeNull();
    expect(checkRelease(dir, `v${expected}`)).toEqual([]);
    expect(checkRelease(dir, `v${before}`)).toHaveLength(1);
  });
});
