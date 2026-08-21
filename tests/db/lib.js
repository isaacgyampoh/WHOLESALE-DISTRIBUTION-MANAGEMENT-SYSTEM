const { Client } = require('pg');
const fs = require('fs');

// WDMS_DB lets the same suites run against a database built by the
// consolidated installer instead of by the migrations.
const CONN = {
  host: '127.0.0.1', port: 55432, user: 'postgres',
  database: process.env.WDMS_DB || 'wdms',
};

// Split SQL on semicolons that are not inside string literals, dollar-quoted
// blocks, or comments. Needed so a failing statement can be reported exactly.
function splitStatements(sql) {
  const out = [];
  let buf = '', i = 0, tag = null;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (!tag) {
      if (rest.startsWith('--')) { const n = sql.indexOf('\n', i); const e = n === -1 ? sql.length : n; buf += sql.slice(i, e); i = e; continue; }
      if (rest.startsWith('/*')) { const n = sql.indexOf('*/', i); const e = n === -1 ? sql.length : n + 2; buf += sql.slice(i, e); i = e; continue; }
      const m = rest.match(/^\$[A-Za-z_]*\$/);
      if (m) { tag = m[0]; buf += tag; i += tag.length; continue; }
      if (sql[i] === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") { j++; break; } else j++; } buf += sql.slice(i, j); i = j; continue; }
      if (sql[i] === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; i++; continue; }
      buf += sql[i]; i++;
    } else {
      if (rest.startsWith(tag)) { buf += tag; i += tag.length; tag = null; continue; }
      buf += sql[i]; i++;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function runFile(client, path, label) {
  const sql = fs.readFileSync(path, 'utf8');
  const stmts = splitStatements(sql);
  for (let k = 0; k < stmts.length; k++) {
    try {
      await client.query(stmts[k]);
    } catch (e) {
      const line = sql.slice(0, sql.indexOf(stmts[k].slice(0, 40))).split('\n').length;
      console.error(`\n  FAIL ${label} statement ${k + 1} (near line ${line})`);
      console.error(`  ${e.severity || 'ERROR'} ${e.code}: ${e.message}`);
      if (e.detail) console.error(`  DETAIL: ${e.detail}`);
      if (e.hint) console.error(`  HINT: ${e.hint}`);
      console.error(`  --- statement ---\n${stmts[k].split('\n').slice(0, 14).join('\n')}`);
      throw e;
    }
  }
  return stmts.length;
}

// Run a block of work as if a given user were calling through PostgREST.
async function asUser(client, uid, role = 'authenticated', fn) {
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role })]);
  await client.query(`set local role ${role}`);
  try { return await fn(); }
  finally { await client.query('rollback'); }
}

module.exports = { Client, CONN, splitStatements, runFile, asUser };
