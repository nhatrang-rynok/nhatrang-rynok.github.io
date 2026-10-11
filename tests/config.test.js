// Защита от опечаток в настройках сайта (site/config.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_URL, FALLBACK_CONTACTS, SITE_TITLE } from '../site/config.js';

test('API_URL: пусто (режим заглушки) или адрес веб-приложения Apps Script', () => {
  assert.match(API_URL, /^$|^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/);
});

test('запасные контакты и название заданы', () => {
  assert.ok(SITE_TITLE.length > 0);
  assert.match(FALLBACK_CONTACTS.whatsapp, /^\d{8,15}$/, 'WhatsApp — только цифры');
  assert.match(FALLBACK_CONTACTS.telegram, /^[A-Za-z0-9_]{3,}$/, 'ник Telegram без @');
  assert.ok(FALLBACK_CONTACTS.phone.startsWith('+'));
});

test('в config.js нет секретов (токен бота, адрес почты)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
  assert.ok(!/\d{8,10}:[A-Za-z0-9_-]{30,}/.test(text), 'токен Telegram-бота');
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(text), 'почта');
});
