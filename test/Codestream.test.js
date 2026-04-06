const Codestream = require('./../src/Codestream');
const { Marker } = require('./../src/Constants');

const chai = require('chai');
const expect = chai.expect;

function u32BE(v) {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u16BE(v) {
  return [(v >>> 8) & 0xff, v & 0xff];
}

function makeBuffer(bytes) {
  const buf = Buffer.from(bytes);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Marker-only bytes (no payload)
const SOC = [0xff, 0x4f];
const SOD = [0xff, 0x93];
const EOC = [0xff, 0xd9];

// SIZ segment bytes.
function sizBytes({ w = 2, h = 2, components = 1, precisions, ssX, ssY } = {}) {
  precisions = precisions || new Array(components).fill(0x07);
  ssX = ssX || new Array(components).fill(1);
  ssY = ssY || new Array(components).fill(1);
  const payload = [
    ...u16BE(0x4000),
    ...u32BE(w),
    ...u32BE(h),
    ...u32BE(0),
    ...u32BE(0),
    ...u32BE(w),
    ...u32BE(h),
    ...u32BE(0),
    ...u32BE(0),
    ...u16BE(components),
  ];
  for (let i = 0; i < components; i++) {
    payload.push(precisions[i], ssX[i], ssY[i]);
  }
  return [0xff, 0x51, ...u16BE(payload.length + 2), ...payload];
}

// COD segment bytes (no precincts).
function codBytes({
  decomp = 1,
  progressionOrder = 0,
  wavelet = 0x01,
  qualityLayers = 1,
  mct = 0,
} = {}) {
  const payload = [
    0x00,
    progressionOrder,
    ...u16BE(qualityLayers),
    mct,
    decomp,
    0x02,
    0x02,
    0x00,
    wavelet,
  ];
  return [0xff, 0x52, ...u16BE(payload.length + 2), ...payload];
}

// QCD segment bytes for style 0 (no quantization).
function qcdBytes(decomp = 1) {
  const steps = new Array(1 + 3 * decomp).fill(0x10);
  const payload = [0x00, ...steps];
  return [0xff, 0x5c, ...u16BE(payload.length + 2), ...payload];
}

// SOT segment bytes.
function sotBytes({
  tileIndex = 0,
  tilePartLength = 0,
  tilePartIndex = 0,
  tilePartCount = 1,
} = {}) {
  const payload = [...u16BE(tileIndex), ...u32BE(tilePartLength), tilePartIndex, tilePartCount];
  return [0xff, 0x90, ...u16BE(payload.length + 2), ...payload];
}

// COM segment bytes.
function comBytes(comment = 'test') {
  const chars = [...comment].map((c) => c.charCodeAt(0));
  const payload = [...u16BE(1), ...chars];
  return [0xff, 0x64, ...u16BE(payload.length + 2), ...payload];
}

// Minimal header-only codestream: SOC + SIZ + COD + QCD + SOT.
// readHeader() stops at SOT and returns without consuming it.
function makeHeaderStream({
  w = 2,
  h = 2,
  decomp = 1,
  progressionOrder = 0,
  wavelet = 0x01,
  signed = false,
  components = 1,
} = {}) {
  const prec = signed ? 0x87 : 0x07;
  return makeBuffer([
    ...SOC,
    ...sizBytes({ w, h, components, precisions: new Array(components).fill(prec) }),
    ...codBytes({ decomp, progressionOrder, wavelet }),
    ...qcdBytes(decomp),
    ...sotBytes(),
  ]);
}

// Complete decode codestream: SOC + SIZ + COD + QCD + SOT(Psot=0) + SOD + EOC.
// Psot=0 means "last tile part, length unknown"; dataEnd evaluates to < dataStart
// so no packet data is consumed and all wavelet coefficients remain zero.
function makeDecodeStream({ w = 2, h = 2, decomp = 1, signed = false } = {}) {
  const prec = signed ? 0x87 : 0x07;
  return makeBuffer([
    ...SOC,
    ...sizBytes({ w, h, precisions: [prec] }),
    ...codBytes({ decomp }),
    ...qcdBytes(decomp),
    ...sotBytes({ tilePartLength: 0 }),
    ...SOD,
    ...EOC,
  ]);
}

describe('Codestream', () => {
  describe('constructor', () => {
    it('creates an instance of Codestream', () => {
      const cs = new Codestream(new ArrayBuffer(0));
      expect(cs).to.be.instanceOf(Codestream);
    });

    it('initializes segments as an empty array', () => {
      const cs = new Codestream(new ArrayBuffer(0));
      expect(cs.getSegments()).to.be.an('array').that.is.empty;
    });

    it('initializes tiles as an empty array', () => {
      const cs = new Codestream(new ArrayBuffer(0));
      expect(cs.tiles).to.be.an('array').that.is.empty;
    });

    it('accepts logSegmentMarkers option without error', () => {
      const buf = makeHeaderStream();
      expect(() => new Codestream(buf, { logSegmentMarkers: true })).to.not.throw();
    });
  });

  describe('getSegments()', () => {
    it('returns an empty array before readHeader() is called', () => {
      const cs = new Codestream(makeHeaderStream());
      expect(cs.getSegments()).to.be.an('array').that.is.empty;
    });

    it('returns the parsed segments after readHeader()', () => {
      const cs = new Codestream(makeHeaderStream());
      cs.readHeader();
      expect(cs.getSegments()).to.have.length.greaterThan(0);
    });
  });

  describe('readHeader() — error cases', () => {
    it('throws when the buffer is empty', () => {
      const cs = new Codestream(new ArrayBuffer(0));
      expect(() => cs.readHeader()).to.throw('Codestream ended before finding a tile segment');
    });

    it('throws when no SOT marker is present', () => {
      const cs = new Codestream(makeBuffer([...SOC]));
      expect(() => cs.readHeader()).to.throw('Codestream ended before finding a tile segment');
    });

    it('throws when SIZ, COD and QCD are all absent', () => {
      const cs = new Codestream(makeBuffer([...SOC, ...sotBytes()]));
      expect(() => cs.readHeader()).to.throw(
        'SIZ, COD and QCD segments are required and were not found'
      );
    });

    it('throws when COD is missing', () => {
      const cs = new Codestream(makeBuffer([...SOC, ...sizBytes(), ...qcdBytes(), ...sotBytes()]));
      expect(() => cs.readHeader()).to.throw(
        'SIZ, COD and QCD segments are required and were not found'
      );
    });

    it('throws when QCD is missing', () => {
      const cs = new Codestream(makeBuffer([...SOC, ...sizBytes(), ...codBytes(), ...sotBytes()]));
      expect(() => cs.readHeader()).to.throw(
        'SIZ, COD and QCD segments are required and were not found'
      );
    });

    it('throws when SIZ is missing', () => {
      const cs = new Codestream(makeBuffer([...SOC, ...codBytes(), ...qcdBytes(), ...sotBytes()]));
      expect(() => cs.readHeader()).to.throw(
        'SIZ, COD and QCD segments are required and were not found'
      );
    });
  });

  describe('readHeader() — success', () => {
    it('returns the correct image width and height', () => {
      const cs = new Codestream(makeHeaderStream({ w: 4, h: 8 }));
      const header = cs.readHeader();
      expect(header.width).to.equal(4);
      expect(header.height).to.equal(8);
    });

    it('returns bitDepth=8 and signed=false for unsigned 8-bit', () => {
      const cs = new Codestream(makeHeaderStream());
      const header = cs.readHeader();
      expect(header.bitDepth).to.equal(8);
      expect(header.signed).to.equal(false);
    });

    it('returns signed=true for a signed component', () => {
      const cs = new Codestream(makeHeaderStream({ signed: true }));
      const header = cs.readHeader();
      expect(header.signed).to.equal(true);
    });

    it('returns the correct component count', () => {
      const cs = new Codestream(makeHeaderStream({ components: 3 }));
      const header = cs.readHeader();
      expect(header.components).to.equal(3);
    });

    it('returns reversible=true for the 5/3 wavelet', () => {
      const cs = new Codestream(makeHeaderStream({ wavelet: 0x01 }));
      const header = cs.readHeader();
      expect(header.reversible).to.equal(true);
    });

    it('returns reversible=false for the CDF 9/7 wavelet', () => {
      const cs = new Codestream(makeHeaderStream({ wavelet: 0x00 }));
      const header = cs.readHeader();
      expect(header.reversible).to.equal(false);
    });

    it('returns the correct decomposition level count', () => {
      const cs = new Codestream(makeHeaderStream({ decomp: 2, w: 4, h: 4 }));
      const header = cs.readHeader();
      expect(header.decompositionLevels).to.equal(2);
    });

    it('returns progressionOrder="LRCP" for progression order 0', () => {
      const cs = new Codestream(makeHeaderStream({ progressionOrder: 0 }));
      const header = cs.readHeader();
      expect(header.progressionOrder).to.equal('LRCP');
    });

    it('returns progressionOrder="RPCL" for progression order 2', () => {
      const cs = new Codestream(makeHeaderStream({ progressionOrder: 2 }));
      const header = cs.readHeader();
      expect(header.progressionOrder).to.equal('RPCL');
    });

    it('populates segments with SIZ, COD and QCD entries', () => {
      const cs = new Codestream(makeHeaderStream());
      cs.readHeader();
      const segments = cs.getSegments();
      expect(segments.some((s) => s.getMarker() === Marker.Siz)).to.equal(true);
      expect(segments.some((s) => s.getMarker() === Marker.Cod)).to.equal(true);
      expect(segments.some((s) => s.getMarker() === Marker.Qcd)).to.equal(true);
    });

    it('resets segments on a subsequent readHeader() call', () => {
      const cs = new Codestream(makeHeaderStream());
      cs.readHeader();
      const countFirst = cs.getSegments().length;
      cs.readHeader();
      expect(cs.getSegments()).to.have.lengthOf(countFirst);
    });

    it('parses a COM segment without error and adds it to segments', () => {
      const buf = makeBuffer([
        ...SOC,
        ...sizBytes(),
        ...codBytes(),
        ...comBytes('Created by htj2k-js'),
        ...qcdBytes(),
        ...sotBytes(),
      ]);
      const cs = new Codestream(buf);
      expect(() => cs.readHeader()).to.not.throw();
      expect(cs.getSegments().some((s) => s.getMarker() === Marker.Com)).to.equal(true);
    });
  });

  describe('decode()', () => {
    it('implicitly calls readHeader() when segments have not been parsed', () => {
      const cs = new Codestream(makeDecodeStream());
      cs.decode();
      expect(cs.getSegments()).to.have.length.greaterThan(0);
    });

    it('returns an object with components, width, height, bitDepth and signed', () => {
      const cs = new Codestream(makeDecodeStream());
      const result = cs.decode();
      expect(result).to.include.keys('components', 'width', 'height', 'bitDepth', 'signed');
    });

    it('returns the correct width and height', () => {
      const cs = new Codestream(makeDecodeStream({ w: 2, h: 2 }));
      const result = cs.decode();
      expect(result.width).to.equal(2);
      expect(result.height).to.equal(2);
    });

    it('returns one component for a single-component codestream', () => {
      const cs = new Codestream(makeDecodeStream());
      const result = cs.decode();
      expect(result.components).to.have.lengthOf(1);
    });

    it('returns a Uint8Array component for unsigned 8-bit depth', () => {
      const cs = new Codestream(makeDecodeStream());
      const result = cs.decode();
      expect(result.components[0]).to.be.instanceOf(Uint8Array);
    });

    it('returns an Int16Array component for signed 8-bit depth', () => {
      const cs = new Codestream(makeDecodeStream({ signed: true }));
      const result = cs.decode();
      expect(result.components[0]).to.be.instanceOf(Int16Array);
    });

    it('returns pixels equal to the level-shift value for an all-zero codestream', () => {
      // Reversible, unsigned 8-bit: level shift = 2^(8-1) = 128.
      // No payload → all wavelet coefficients are zero → all output pixels = 0 + 128 = 128.
      const cs = new Codestream(makeDecodeStream());
      const pixels = cs.decode().components[0];
      expect(Array.from(pixels).every((v) => v === 128)).to.equal(true);
    });

    it('returns the correct number of pixels for width × height', () => {
      const cs = new Codestream(makeDecodeStream({ w: 2, h: 2 }));
      const result = cs.decode();
      expect(result.components[0]).to.have.lengthOf(4);
    });
  });
});
