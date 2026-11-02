import test from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../src/core/profanity.js';

test('bad words become #####', () => {
  assert.equal(clean('what the fuck'), 'what the #####');
  assert.equal(clean('ไอ้เหี้ย'), 'ไอ้#####');
});

test('normal words are left alone', () => {
  assert.equal(clean('class assignment'), 'class assignment');
  assert.equal(clean('กูเกิล'), 'กูเกิล');
  assert.equal(clean(''), '');
  assert.equal(clean(null), '');
});

import { normalizeLink } from '../src/core/links.js';

test('social links accept only their own site', () => {
  assert.equal(normalizeLink('youtube', 'youtube.com/@abc'), 'https://youtube.com/@abc');
  assert.equal(normalizeLink('youtube', 'https://youtu.be/xyz'), 'https://youtu.be/xyz');
  assert.equal(normalizeLink('youtube', 'https://tiktok.com/@abc'), null);
  assert.equal(normalizeLink('x', 'https://evil.com/x.com'), null);
  assert.equal(normalizeLink('x', 'https://x.com.evil.com/a'), null);
  assert.equal(normalizeLink('discord', 'javascript:alert(1)'), null);
  assert.equal(normalizeLink('tiktok', ''), '');
});
