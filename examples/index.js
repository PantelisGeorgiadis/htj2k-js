const htJ2kJs = require('./../src');
const { Decoder } = htJ2kJs;

const fs = require('fs');
const fileName = process.argv[2] || './examples/ct_tlm.j2c';
const fileBuffer = fs.readFileSync(fileName);
const arrayBuffer = fileBuffer.buffer.slice(
  fileBuffer.byteOffset,
  fileBuffer.byteOffset + fileBuffer.byteLength
);

const htj2kd = new Decoder(arrayBuffer, { logSegmentMarkers: true, logBoxes: true });
const ret = htj2kd.readHeader();
const ret2 = htj2kd.decode();

console.log('ret:', ret);
