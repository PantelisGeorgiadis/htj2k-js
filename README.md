[![NPM version][npm-version-image]][npm-url] [![NPM downloads][npm-downloads-image]][npm-url] [![build][build-image]][build-url] [![MIT License][license-image]][license-url]

# htj2k-js
High-Throughput JPEG 2000 (HTJ2K) decoder for Node.js and browser.

### Note
**This effort is a work-in-progress and should not be used for production purposes.**

### Install
#### Node.js

	npm install htj2k-js

#### Browser

	<script type="text/javascript" src="https://unpkg.com/htj2k-js"></script>

### Build

	npm install
	npm run build

### Features
- Decodes HTJ2K raw codestreams (`.j2c`, `.jpc`) and boxed files (`.jp2`, `.jpx`, `.jph`).
- Supports both lossless (reversible, 5/3 LeGall wavelet) and lossy (irreversible, CDF 9/7 wavelet) compression.
- Handles grayscale and color (RGB) images, 8 and 16 bits per component, with signed and unsigned pixel values.
- Supports all five JPEG 2000 progression orders: LRCP, RLCP, RPCL, PCRL and CPRL.
- Outputs per-component pixel arrays (`Uint8Array`, `Uint16Array` or `Int16Array`) as well as a convenient RGBA `Uint8Array` suitable for HTML5 Canvas, WebGL and WebGPU.
- Provides a common bundle for both Node.js and browser.

### Usage
#### Basic decoding
```js
// Import objects in Node.js
const htj2kJs = require('htj2k-js');
const { Decoder } = htj2kJs;

// Import objects in Browser
const { Decoder } = window.htj2kJs;

// Create an ArrayBuffer with the contents of the HTJ2K byte stream.
const decoder = new Decoder(arrayBuffer);

// Read the image header.
const header = decoder.readHeader();

// Image width.
const width = header.width;
// Image height.
const height = header.height;
// Image bit depth.
const bitDepth = header.bitDepth;
// Image signedness.
const signed = header.signed;
// Number of image components.
const numComponents = header.components;

// Decode and render.
const result = decoder.decodeAndRender();

// Rendered per-component pixel arrays (Uint8Array / Uint16Array / Int16Array).
const components = result.components;
```

#### Advanced decoding
```js
// Import objects in Node.js
const htj2kJs = require('htj2k-js');
const { Decoder } = htj2kJs;

// Import objects in Browser
const { Decoder } = window.htj2kJs;

// Create decoder options.
const decoderOpts = {
  // Optional flag to enable segment marker logging.
  // If not provided, segment marker logging is disabled.
  logSegmentMarkers: false,
  // Optional flag to enable box logging (JP2/JPH file format).
  // If not provided, box logging is disabled.
  logBoxes: false,
};

// Create an ArrayBuffer with the contents of the HTJ2K byte stream.
const decoder = new Decoder(arrayBuffer, decoderOpts);

// Read the image header.
const header = decoder.readHeader();

// Image width.
const width = header.width;
// Image height.
const height = header.height;
// Image bit depth.
const bitDepth = header.bitDepth;
// Image signedness.
const signed = header.signed;
// Number of image components.
const numComponents = header.components;
// Number of wavelet decomposition levels.
const decompositionLevels = header.decompositionLevels;
// Progression order (e.g. 'LRCP', 'RPCL', 'CPRL', ...).
const progressionOrder = header.progressionOrder;

// Decode and render directly to RGBA.
const result = decoder.decodeAndRenderToRgba();

// RGBA pixel data as a flat Uint8Array (width × height × 4 bytes).
const rgba = result.data;
// Rendered image width.
const renderedWidth = result.width;
// Rendered image height.
const renderedHeight = result.height;
```

Please check a live example [here][htj2k-js-live-example-url].

### License
htj2k-js is released under the MIT License.

[npm-url]: https://npmjs.org/package/htj2k-js
[npm-version-image]: https://img.shields.io/npm/v/htj2k-js.svg?style=flat
[npm-downloads-image]: http://img.shields.io/npm/dm/htj2k-js.svg?style=flat

[build-url]: https://github.com/PantelisGeorgiadis/htj2k-js/actions/workflows/build.yml
[build-image]: https://github.com/PantelisGeorgiadis/htj2k-js/actions/workflows/build.yml/badge.svg?branch=master

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg?style=flat
[license-url]: LICENSE.txt

[htj2k-js-live-example-url]: https://unpkg.com/htj2k-js@latest/build/index.html
