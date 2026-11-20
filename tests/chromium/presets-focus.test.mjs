import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

async function openEditor(t, native) {
  // Use installed Chrome on developer machines and CI, or the existing
  // scripts/browser-setup.sh Chromium rig in the offline Linux sandbox.
  const dir = process.env.BROWSER_DIR;
  const browser = await chromium.launch(dir ? {
    executablePath: join(dir, 'chromium'),
    env: { ...process.env, LD_LIBRARY_PATH: join(dir, 'lib'), FONTCONFIG_FILE: join(dir, 'fonts.conf') },
  } : { channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ offline: true, viewport: { width: 1440, height: 900 } });
  if (!native) await page.addInitScript(() => { HTMLDialogElement.prototype.showModal = undefined; });
  await page.goto(new URL('../../index.html', import.meta.url).href);
  assert.equal(await page.evaluate(() => typeof HTMLDialogElement.prototype.showModal === 'function'), native);
  return page;
}

const focused = page => page.evaluate(() => document.activeElement.id || document.activeElement.tagName);

test('fallback presets contain real Tab navigation after a click on the heading', async t => {
  const page = await openEditor(t, false);
  await page.click('#btnPresets');
  assert.equal(await focused(page), 'btnPresetClose');

  // These must be actual pointer and keyboard inputs: jsdom does not perform
  // the browser's default focus change on a heading click or Tab navigation.
  await page.click('#presetsTitle');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(page), 'btnPresetClose', 'backward Tab from the heading lands on the last control');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'btnPresetSave', 'last wraps to first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(page), 'btnPresetClose', 'first wraps to last');
  await page.click('#presetsTitle');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'btnPresetSave', 'forward Tab from the heading lands on the first control');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'btnPresetClose', 'ordinary Tab still advances inside the dialog');

  await page.focus('#btnLang');
  assert.ok(await page.locator('#presetsOverlay').evaluate(el => el.contains(document.activeElement)), 'background focus is contained');
  await page.click('#btnPresetClose');
  assert.equal(await focused(page), 'btnPresets');
  await page.focus('#btnLang');
  assert.equal(await focused(page), 'btnLang', 'closing the fallback releases the background');
  await page.keyboard.press('Tab');
  assert.notEqual(await focused(page), 'btnLang', 'normal Tab navigation resumes');
});

for (const native of [false, true]) {
  test(`a nested preset prompt owns focus until Escape (${native ? 'native' : 'fallback'})`, async t => {
    const page = await openEditor(t, native);
    await page.click('#btnMatrixAddNode'); // a selection to save
    await page.click('#btnMenu');
    await page.click('#btnPresets');
    await page.click('#btnPresetSave');
    await page.locator('#appDialogInput:focus').waitFor();
    const prompt = page.locator('.app-dialog');
    assert.equal(await prompt.evaluate(el => el.matches(':modal')), native);
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('[data-dialog-cancel]').evaluate(el => el === document.activeElement));
    await page.focus('#btnPresetSave');
    assert.ok(await prompt.evaluate(el => el.contains(document.activeElement)), 'the outer modal cannot reclaim focus');

    await page.keyboard.press('Escape');
    await prompt.waitFor({ state: 'detached' });
    assert.equal(await focused(page), 'btnPresetSave');
    await page.keyboard.press('Escape');
    await page.locator('#presetsOverlay').waitFor({ state: 'hidden' });
    assert.equal(await focused(page), 'btnPresets');
    assert.equal(await page.getAttribute('#toolsPanel', 'aria-hidden'), 'false', 'neither Escape closed the sidebar');
  });
}
