import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLocale, localeFromRequest, t, directionFor, DEFAULT_LOCALE} from '../packages/shared/dist/index.js';

test('default locale is Persian RTL', () => {
  assert.equal(DEFAULT_LOCALE, 'fa-IR');
  assert.equal(parseLocale(undefined), 'fa-IR');
  assert.equal(directionFor('fa-IR'), 'rtl');
  assert.match(t('fa-IR', 'tagline'), /حیوانات/);
});

test('explicit English from query or Accept-Language', () => {
  assert.equal(localeFromRequest({searchParams: new URLSearchParams('hl=en')}), 'en');
  assert.equal(localeFromRequest({acceptLanguage: 'en-US,en;q=0.9'}), 'en');
  assert.equal(directionFor('en'), 'ltr');
  assert.equal(t('en', 'platform_name'), 'PETAVU');
});

test('query wins over Accept-Language; unknown falls back', () => {
  assert.equal(localeFromRequest({searchParams: new URLSearchParams('hl=fa'), acceptLanguage: 'en'}), 'fa-IR');
  assert.equal(parseLocale('de-DE'), 'fa-IR');
});
