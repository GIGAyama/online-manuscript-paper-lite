/* 原稿用紙の組版（中核ロジック）のテスト。
 * 禁則処理は「先生が印刷して配るもの」に直接出るので、ここが崩れると気づかれにくい。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenko } from '../src/genko-parser.js';

const S20 = { charsPerLine: 20, kinsokuMode: 'burasagari' };
const S20o = { charsPerLine: 20, kinsokuMode: 'oidashi' };
const empty = { title: '', class: '', name: '', content: '' };

test('題名は2マス下げて置かれる', () => {
  const lines = parseGenko({ ...empty, title: 'あき' }, S20);
  assert.equal(lines[0][0], '');
  assert.equal(lines[0][1], '');
  assert.equal(lines[0][2], 'あ');
  assert.equal(lines[0][3], 'き');
});

test('学年と氏名は下から1マス空けて置かれる', () => {
  const lines = parseGenko({ ...empty, class: '三年', name: 'やまだ' }, S20);
  const footer = lines.find((line) => line.join('').includes('やまだ'));
  assert.ok(footer, '氏名の行が無い');
  assert.equal(footer[19], '');            // いちばん下は1マス空ける
  assert.equal(footer.slice(13, 19).join(''), '三年 やまだ');
});

test('20文字ちょうどで次の行に折り返す', () => {
  const content = 'あ'.repeat(45);
  const lines = parseGenko({ ...empty, content }, S20);
  const body = lines.slice(1); // 先頭は空の題名行
  assert.equal(body[0].length, 20);
  assert.equal(body[1].length, 20);
  assert.equal(body[2].length, 5);
});

test('ぶら下がり：行末を越えた句点はマスの外に付く', () => {
  const content = `${'あ'.repeat(20)}。つづき`;
  const lines = parseGenko({ ...empty, content }, S20);
  const first = lines[1];
  assert.equal(first.length, 21, '20マス＋ぶら下がり1文字');
  assert.equal(first[20], '。');
  assert.equal(lines[2].join(''), 'つづき');
});

test('追い出し：行頭に来られない文字が続くと、前の行の最後を送る', () => {
  const content = `${'あ'.repeat(20)}。つづき`;
  const lines = parseGenko({ ...empty, content }, S20o);
  const first = lines[1];
  assert.equal(first.length, 19, '最後の1マスを次の行へ送る');
  assert.equal(lines[2][0], 'あ');
  assert.equal(lines[2][1], '。');
});

test('「。」と「」」は1マスにまとめる', () => {
  const lines = parseGenko({ ...empty, content: 'はい。」つぎ' }, S20);
  assert.equal(lines[1][2], '。」');
  assert.equal(lines[1][3], 'つ');
});

test('行末に開き括弧が来ない（次の行へ送る）', () => {
  const content = `${'あ'.repeat(19)}「はなし」`;
  const lines = parseGenko({ ...empty, content }, S20);
  assert.equal(lines[1].length, 19, '19マスで打ち切る');
  assert.equal(lines[2][0], '「');
});

test('空行はそのまま1行として残る', () => {
  const lines = parseGenko({ ...empty, content: 'いち\n\nに' }, S20);
  assert.equal(lines[2].join(''), '', '2行目は空行');
  assert.equal(lines[3].join(''), 'に');
});

test('15文字設定でも同じように折り返す', () => {
  const lines = parseGenko({ ...empty, content: 'あ'.repeat(16) }, { charsPerLine: 15, kinsokuMode: 'burasagari' });
  assert.equal(lines[1].length, 15);
  assert.equal(lines[2].length, 1);
});

test('サロゲートペア（絵文字）を1文字として数える', () => {
  const lines = parseGenko({ ...empty, content: '𩸽をたべた' }, S20);
  assert.equal(lines[1][0], '𩸽');
  assert.equal(lines[1][1], 'を');
});

test('何も入力しなくても1行は返る（用紙が消えない）', () => {
  const lines = parseGenko(empty, S20);
  assert.ok(lines.length >= 1);
  assert.equal(lines[0].length, 20);
});
