import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, maskPhone, phoneHint } from "../../src/lib/auth/phone.ts";
import { isValidPinFormat, isWeakPin } from "../../src/lib/auth/pin.ts";

test("local Ghana numbers become international", () => {
  assert.equal(normalisePhone("0241110000"), "+233241110000");
  assert.equal(normalisePhone("024 111 0000"), "+233241110000");
  assert.equal(normalisePhone("024-111-0000"), "+233241110000");
});

test("numbers already in international form are kept", () => {
  assert.equal(normalisePhone("+233241110000"), "+233241110000");
  assert.equal(normalisePhone("+233 24 111 0000"), "+233241110000");
  assert.equal(normalisePhone("+44 7700 900123"), "+447700900123");
});

test("the same number in different spellings normalises to one value", () => {
  const forms = ["0241110000", "+233241110000", "233241110000", "024 111 0000"];
  const normalised = new Set(forms.map(normalisePhone));
  assert.equal(normalised.size, 1, `got ${[...normalised].join(", ")}`);
});

test("nonsense is rejected rather than mangled", () => {
  assert.equal(normalisePhone(""), null);
  assert.equal(normalisePhone("   "), null);
  assert.equal(normalisePhone("12"), null);
  assert.equal(normalisePhone("abc"), null);
});

test("only the last four digits are ever shown", () => {
  const masked = maskPhone("+233241110000");
  assert.match(masked, /0000$/);
  assert.ok(!masked.includes("233"), `masked value leaked the prefix: ${masked}`);
  assert.ok(!masked.includes("24111"), `masked value leaked the body: ${masked}`);
  assert.equal(phoneHint("+233241110000"), "0000");
});

test("a PIN must be exactly four digits", () => {
  for (const good of ["1024", "4837", "0007", "9999"]) {
    assert.ok(isValidPinFormat(good), `${good} should be accepted`);
  }
  for (const bad of ["12345", "123456", "abc1", "12", "", "1 24", "12.4", "١٢٣٤"]) {
    assert.ok(!isValidPinFormat(bad), `${bad} should be rejected`);
  }
});

test("the most guessable PINs are refused when one is chosen", () => {
  for (const weak of ["0000", "1111", "1234", "4321", "2024"]) {
    assert.ok(isWeakPin(weak), `${weak} should count as weak`);
  }
  for (const fine of ["1024", "4837", "7291", "5610"]) {
    assert.ok(!isWeakPin(fine), `${fine} should be allowed`);
  }
});

test("the initial Super Administrator PIN is a permitted value", () => {
  assert.ok(isValidPinFormat("1024"));
  assert.ok(!isWeakPin("1024"), "1024 must be assignable, not blocked as weak");
});
