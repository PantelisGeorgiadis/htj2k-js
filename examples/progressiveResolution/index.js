const log = require('../../src/log');
const fs = require('fs');
const getResolutionRange = require('./getResolutionRange');

log.setLevel('info');

(async () => {
  if (process.argv.length < 3) {
    console.log('Usage:');
    console.log('node index.js <filename> [startResolution=0] [endResolution=undefined]');
    return;
  }
  const fileName = process.argv[2];
  const startLevel = parseInt(process.argv[3]) || 0;
  const endLevel = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const readable = fs.createReadStream(fileName);

  const responseBuffer = await getResolutionRange(readable, startLevel, endLevel);
  console.log('responseBuffer of length', responseBuffer.length);
})();
