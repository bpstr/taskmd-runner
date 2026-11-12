const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const { Writable } = require('node:stream');

const createWriteStream = fs.createWriteStream;
const writeFileSync = fs.writeFileSync;
let failed = false;
const noSpace = () => Object.assign(new Error('ENOSPC: prepared storage failure'), { code: 'ENOSPC' });

fs.createWriteStream = function (file, ...options) {
  if (path.basename(file) !== process.env.PREPARED_FAIL_LOG) return createWriteStream.call(this, file, ...options);
  return new Writable({
    write(_chunk, _encoding, callback) {
      failed = true;
      callback(noSpace());
    },
  });
};
fs.writeFileSync = function (file, data, ...options) {
  if (failed && process.env.PREPARED_FAIL_TERMINAL === '1' && typeof file === 'string' &&
      (path.basename(file).startsWith('summary.json.') || (String(data).includes('"state":"exited"') && file.endsWith('.tmp')))) {
    throw noSpace();
  }
  return writeFileSync.call(this, file, data, ...options);
};
syncBuiltinESMExports();
