import { Decoder } from './..';

import * as bmp from 'bmp-js';
import * as fs from 'fs';

async function renderToBmp(j2cFile: string, bmpFile: string) {
  const htJ2kFileBuffer = fs.readFileSync(j2cFile);
  const htJ2KArrayBuffer = htJ2kFileBuffer.buffer.slice(
    htJ2kFileBuffer.byteOffset,
    htJ2kFileBuffer.byteOffset + htJ2kFileBuffer.byteLength
  );

  const htJ2kDecoder = new Decoder(htJ2KArrayBuffer, { logSegmentMarkers: true, logBoxes: true });
  const htJ2kHeader = htJ2kDecoder.readHeader();
  console.log('Header:', htJ2kHeader);

  const renderingResult = htJ2kDecoder.decodeAndRenderToRgba();
  if (!renderingResult) {
    throw new Error('Failed to decode and render the HTJ2K image.');
  }
  console.log('Rendering Result:', renderingResult);

  const renderedPixels = renderingResult.data;

  // BMP lib expects ABGR and the rendering output is RGBA
  const argbPixels = Buffer.alloc(4 * renderingResult.width * renderingResult.height);
  for (let i = 0; i < 4 * renderingResult.width * renderingResult.height; i += 4) {
    argbPixels[i] = renderedPixels[i + 3];
    argbPixels[i + 1] = renderedPixels[i + 2];
    argbPixels[i + 2] = renderedPixels[i + 1];
    argbPixels[i + 3] = renderedPixels[i];
  }

  const encodedBmp = bmp.encode({
    data: argbPixels,
    width: renderingResult.width,
    height: renderingResult.height,
  });

  fs.writeFileSync(bmpFile, encodedBmp.data);
}

const args = process.argv.slice(2);
(async () => {
  const htj2kFile = args[0];
  if (!htj2kFile) {
    console.error('Please provide the path to the HTJ2K file as the first argument.');
    process.exit(1);
  }

  const bmpFile = args[1];
  if (!bmpFile) {
    console.error('Please provide the path to the BMP file as the second argument.');
    process.exit(1);
  }

  await renderToBmp(htj2kFile, bmpFile);
})();
