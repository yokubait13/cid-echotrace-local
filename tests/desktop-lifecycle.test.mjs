import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { seedCaseFixture } from './case-fixture.mjs';

test('real Electron title-bar close, draft recovery, menu Exit, and vocabulary UI', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'echotrace-desktop-test-'));
  await seedCaseFixture(root);
  console.log('Desktop test artifacts:', root);
  for (const mode of ['clean-close', 'draft-close', 'restore-menu-exit', 'failed-draft-close', 'active-close']) {
    const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), ['tests/desktop-lifecycle.cjs'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ECHOTRACE_TEST_PROFILE: root, ECHOTRACE_TEST_MODE: mode,
        ECHOSCRIBE_ENGINE_DIR: mode === 'active-close' ? path.resolve('vendor/engine') : path.join(root, 'missing-engine'), ECHOSCRIBE_MODEL_DIR: mode === 'active-close' ? path.resolve('vendor/models') : path.join(root, 'missing-model') },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let output = '';
    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => output += data);
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${mode} did not exit: ${output}`)); }, 18000);
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    const failure = await fs.readFile(path.join(root, 'failure.txt'), 'utf8').catch(() => '');
    assert.equal(code, 0, `${mode}: ${failure}\n${output}`);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, mode + '-passed.json'))).passed, true);
    if (mode === 'draft-close') {
      assert.equal(JSON.parse(await fs.readFile(path.join(root, 'review-drafts.json')))['test-recording-01']['segment-1'], 'Verified review draft retained after closing.');
      const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/case-catalog.json')));
      assert.equal(catalog.jobs.find((job) => job.id === 'test-recording-01').transcript, 'This is a synthetic test recording.');
    }
  }
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/case-catalog.json')));
  assert.deepEqual(catalog.cases[0].vocabulary, ['Yokubaitis', 'Forensic interview']);
  assert.equal(catalog.jobs.find((job) => job.id === 'test-recording-01').segments[0].text, 'Verified review draft retained after closing.');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'review-drafts.json'))), {});
  const active = JSON.parse(await fs.readFile(path.join(root, 'active-job.json')));
  const stoppedJob = catalog.jobs.find((job) => job.id === active.job.id);
  assert.equal(stoppedJob.state, 'failed');
  assert.ok(await fs.stat(stoppedJob.sourcePath));
});

