// Starts/stops a throwaway PostgreSQL 17 instance for the test suite.
// Unix sockets are disabled because the repo path can exceed the 103-byte
// socket path limit on macOS; the tests connect over TCP instead.
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');

const BIN = path.join(__dirname, 'node_modules', '@embedded-postgres',
                      `${process.platform}-${process.arch}`, 'native', 'bin');
const DATA = path.join(__dirname, '.pgdata');
const PORT = process.env.PGPORT || '55432';

const run = (cmd, args) =>
  execFileSync(path.join(BIN, cmd), args, { stdio: 'inherit' });

const cmd = process.argv[2];
if (cmd === 'start') {
  if (!fs.existsSync(DATA)) {
    run('initdb', ['-D', DATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C']);
  }
  run('pg_ctl', ['-D', DATA, '-l', path.join(__dirname, '.pg.log'), '-o',
      `-p ${PORT} -c unix_socket_directories= -c listen_addresses=127.0.0.1`, 'start']);
} else if (cmd === 'stop') {
  run('pg_ctl', ['-D', DATA, '-m', 'fast', 'stop']);
} else {
  console.error('usage: node pgctl.js start|stop');
  process.exit(1);
}
