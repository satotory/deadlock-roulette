import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { GUIDE_STEPS, getGuideSteps, placeGuideCard, readGuideProgress } from '../src/guide.js';

test('guide points to real stable application controls in both languages, including an empty build', async () => {
  const source = (await Promise.all(['src/index.html', 'src/build-mode.js', 'src/app.js'].map(path => fs.readFile(new URL('../' + path, import.meta.url), 'utf8')))).join('\n');
  assert.equal(GUIDE_STEPS.length, 14);
  assert.equal(new Set(GUIDE_STEPS.map(step => step.id)).size, GUIDE_STEPS.length);
  for (const language of ['en', 'ru']) {
    const steps = getGuideSteps(language);
    assert.equal(steps.length, 14);
    for (const step of steps) {
      assert.ok(step.title.length > 5 && step.description.length > 20);
      assert.ok(step.selectors.some(selector => source.includes(selector.slice(1))), `No stable anchor for ${step.id}`);
    }
  }
  assert.notEqual(getGuideSteps('ru')[0].title, getGuideSteps('en')[0].title);
  assert.deepEqual(getGuideSteps('unrecognised'), getGuideSteps('en'));
});

test('tier guidance separates tier toggles from weight controls immediately after the pool filters', async () => {
  assert.equal(GUIDE_STEPS[1].id, 'weights');
  const tiers = GUIDE_STEPS[2];
  assert.equal(tiers.id, 'tiers');
  assert.equal(tiers.mode, 'roulette');
  assert.deepEqual(tiers.selectors, ['#tier-controls']);
  assert.equal(tiers.highlightSelector, '#tier-controls .tier-enable');
  const source = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /class="tier-enable" data-toggle-tier=/);
  for (const language of ['en', 'ru']) {
    const step = getGuideSteps(language).find(value => value.id === 'tiers');
    for (const label of ['T1', 'T2', 'T3', 'T4', '−/+', '0']) assert.ok(step.description.includes(label));
  }
});

test('section replay has a fixed order and never visits the other mode', () => {
  for (const section of ['roulette', 'build']) {
    const steps = getGuideSteps('en', section);
    assert.ok(steps.length > 4);
    assert.ok(steps.every(step => !step.mode || step.mode === section));
    assert.equal(steps.at(-1).id, 'links');
  }
});

test('spotlight card stays within small, normal and large viewports near every edge', () => {
  for (const viewport of [{ width: 320, height: 480 }, { width: 1366, height: 768 }, { width: 2560, height: 1440 }]) {
    for (const target of [null, { left: 0, top: 0, right: 100, bottom: 50 }, { left: viewport.width - 50, top: viewport.height - 50, right: viewport.width, bottom: viewport.height }, { left: 0, top: 0, right: viewport.width, bottom: viewport.height }]) {
      const card = placeGuideCard(target, viewport, { width: 382, height: 300 });
      assert.ok(card.left >= 0 && card.top >= 0);
      assert.ok(card.left + card.width <= viewport.width);
      assert.ok(card.top + card.height <= viewport.height);
    }
  }
  const card = placeGuideCard({ left: 300, top: 300, right: 700, bottom: 600 }, { width: 1366, height: 900 }, { width: 382, height: 300 });
  assert.equal(card.side, 'right');
  assert.ok(card.left > 700, 'Prefer a free side over covering the highlighted control.');
});

test('first-run progress survives malformed, restricted and existing local storage safely', () => {
  assert.deepEqual(readGuideProgress({ getItem: () => 'corrupt' }), { offered: false, completed: false });
  assert.deepEqual(readGuideProgress({ getItem: () => { throw new Error('Blocked'); } }), { offered: false, completed: false });
  assert.deepEqual(readGuideProgress({ getItem: () => '{"offered":true,"completed":false}' }), { offered: true, completed: false });
  assert.deepEqual(readGuideProgress({ getItem: () => '{"offered":"true","completed":1}' }), { offered: false, completed: false });
});
