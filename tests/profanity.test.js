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
