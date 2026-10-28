import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { messages, translate, localizedItemName, secondaryItemName } from '../src/i18n.js';

test('every interface translation and its variables exist in both languages', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ru).sort());
  const variables = text => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
  for (const key of Object.keys(messages.ru)) {
    assert.ok(messages.ru[key].trim(), `Empty Russian translation: ${key}`);
    assert.ok(messages.en[key].trim(), `Empty English translation: ${key}`);
    assert.deepEqual(variables(messages.ru[key]), variables(messages.en[key]), `Variables differ: ${key}`);
  }
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/\bdata-i18n(?:-(?:html|label|title|placeholder))?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(messages.en, match[1]), `Missing UI translation: ${match[1]}`);
  }
});

test('switching item language keeps both names and handles incomplete localization', () => {
  const item = { name: 'Ricochet', nameRu: 'Рикошет' };
  assert.equal(localizedItemName(item, 'ru'), 'Рикошет');
  assert.equal(localizedItemName(item, 'en'), 'Ricochet');
  assert.equal(secondaryItemName(item, 'ru'), 'Ricochet');
  assert.equal(localizedItemName({ name: 'Ricochet' }, 'ru'), 'Ricochet');
  assert.equal(translate('en', 'ritual', { number: '007' }), 'RITUAL No. 007');
});
