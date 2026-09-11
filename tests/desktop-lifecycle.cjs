// Run by desktop-lifecycle.test.mjs inside the real Electron runtime.
const { app, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.ECHOTRACE_TEST_PROFILE;
const mode = process.env.ECHOTRACE_TEST_MODE;
app.setPath('userData', root);
let checked = false;
app.on('will-quit', () => {
  if (checked) fs.writeFileSync(path.join(root, mode + '-passed.json'), JSON.stringify({ mode, passed: true }));
});
app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = (code) => window.webContents.executeJavaScript(code, true);
      await evaluate(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const timer = setInterval(() => {
          if (document.querySelector('[data-project-toggle]')) { clearInterval(timer); resolve(); }
          else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Workspace did not load')); }
        }, 50);
      })`);
      await evaluate(`document.querySelector('[data-project-toggle]').click(); document.querySelector('[data-project-nav-job-id="test-recording-01"]').click();`);
      assert.equal(await evaluate(`document.querySelectorAll('.speaker-tag, .speaker-summary').length`), 0);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      if (mode === 'active-close') {
        const response = await fetch(new URL('/api/jobs', window.webContents.getURL()), {
          method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-File-Name': 'shutdown-test.wav', 'X-Case-Id': 'case-fixture' },
          body: fs.readFileSync(path.join(root, 'data/incoming/synthetic.wav'))
        });
        assert.equal(response.status, 202);
        fs.writeFileSync(path.join(root, 'active-job.json'), JSON.stringify(await response.json()));
      }
      if (mode === 'failed-draft-close') {
        const draftPath = path.join(root, 'review-drafts.json');
        fs.rmSync(draftPath, { force: true });
        fs.mkdirSync(draftPath);
        let warned = false;
        dialog.showMessageBox = async () => { warned = true; return { response: 0 }; };
        window.close();
        const deadline = Date.now() + 8000;
        while (!warned && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
        assert.equal(warned, true, 'Failed draft backup must offer Keep open');
        assert.equal(window.isDestroyed(), false);
        assert.equal(await evaluate(`fetch('/api/jobs').then((response) => response.status)`), 200, 'Canceling exit must keep the backend usable');
        fs.rmdirSync(draftPath);
      }
      if (mode === 'draft-close') {
        await evaluate(`const editor = document.querySelector('[data-segment="segment-1"]'); editor.focus(); editor.innerText = 'Verified review draft retained after closing.'; editor.dispatchEvent(new Event('input', {bubbles:true}));`);
      } else if (mode === 'restore-menu-exit') {
        assert.equal(await evaluate(`document.querySelector('[data-segment="segment-1"]').innerText`), 'Verified review draft retained after closing.');
        await evaluate(`document.querySelector('#saveTranscriptButton').click();`);
        await evaluate(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const timer = setInterval(() => {
            if (document.querySelector('#saveTranscriptButton').disabled && document.querySelector('[data-segment]').contentEditable !== 'false') { clearInterval(timer); resolve(); }
            else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Correction save failed')); }
          }, 50);
        })`);
        await evaluate(`document.querySelector('[data-case-action="vocabulary"]').click(); document.querySelector('#vocabularyTerms').value = 'Yokubaitis\\nForensic interview'; document.querySelector('#vocabularyForm button[type="submit"]').click();`);
        await evaluate(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const timer = setInterval(() => {
            if (!document.querySelector('#vocabularyDialog').open) { clearInterval(timer); resolve(); }
            else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Vocabulary save failed')); }
          }, 50);
        })`);
        fs.writeFileSync(path.join(root, 'review.png'), (await window.webContents.capturePage()).toPNG());
      }
      checked = true;
      if (mode === 'restore-menu-exit') Menu.getApplicationMenu().items[0].submenu.items.find((item) => item.label === 'Exit').click();
      else window.close(); // Same BrowserWindow close event as the title-bar X.
    } catch (error) {
      fs.writeFileSync(path.join(root, 'failure.txt'), error.stack);
      app.exit(1);
    }
  });
});
require(process.env.ECHOTRACE_TEST_APP_ROOT ? path.join(process.env.ECHOTRACE_TEST_APP_ROOT, 'electron/main.cjs') : '../electron/main.cjs');


