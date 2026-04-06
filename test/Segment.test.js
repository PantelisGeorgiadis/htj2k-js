const {
  CapSegment,
  CodSegment,
  ComSegment,
  QcdSegment,
  Segment,
  SizSegment,
  SotSegment,
  TlmSegment,
} = require('./../src/Segment');
const { Marker, ProgressionOrder, WaveletTransform } = require('./../src/Constants');

const chai = require('chai');
const expect = chai.expect;

// Helpers to write big-endian values into a byte array.
function uint32BE(val) {
  return [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
}

function uint16BE(val) {
  return [(val >>> 8) & 0xff, val & 0xff];
}

function makeBuffer(bytes) {
  const buf = Buffer.from(bytes);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Build a minimal 1-component SIZ payload.
// SIZ parse order: profile(2), refGridW(4), refGridH(4), imgOffX(4), imgOffY(4),
//                  tileW(4), tileH(4), tileOffX(4), tileOffY(4), components(2), [N×(prec,ssX,ssY)]
// getLength() = byteLength+2 must equal 38 + 3*components
function makeSizBuffer({
  profile = 0x4000,
  w = 256,
  h = 128,
  tileW = 256,
  tileH = 128,
  imgX = 0,
  imgY = 0,
  tileOffX = 0,
  tileOffY = 0,
  components = 1,
  precisions = [0x07],
  ssX = [1],
  ssY = [1],
} = {}) {
  const compBytes = [];
  for (let i = 0; i < components; i++) {
    compBytes.push(precisions[i] & 0xff, ssX[i] & 0xff, ssY[i] & 0xff);
  }
  return makeBuffer([
    ...uint16BE(profile),
    ...uint32BE(w),
    ...uint32BE(h),
    ...uint32BE(imgX),
    ...uint32BE(imgY),
    ...uint32BE(tileW),
    ...uint32BE(tileH),
    ...uint32BE(tileOffX),
    ...uint32BE(tileOffY),
    ...uint16BE(components),
    ...compBytes,
  ]);
}

// Build a minimal COD payload (no precincts).
// COD parse order: codingStyle(1), progressionOrder(1), qualityLayers(2),
//                  mct(1), decompositionLevels(1), cbX(1), cbY(1), cbStyle(1), wavelet(1)
function makeCodBuffer({
  codingStyle = 0,
  progressionOrder = 0,
  qualityLayers = 1,
  mct = 0,
  decompositionLevels = 1,
  cbX = 2,
  cbY = 2,
  cbStyle = 0,
  wavelet = WaveletTransform.Reversible_5_3,
} = {}) {
  return makeBuffer([
    codingStyle,
    progressionOrder,
    ...uint16BE(qualityLayers),
    mct,
    decompositionLevels,
    cbX,
    cbY,
    cbStyle,
    wavelet,
  ]);
}

// Build a minimal QCD payload for style & 0x1f === 0 (no quantization).
// getLength() = byteLength+2 must equal 4 + 3*decompositionLevels.
// Buffer size = 2 + 3*D → reads: style(1) + (1+3*D) uint8s.
function makeQcdBuffer0(decompositionLevels = 1) {
  const steps = new Array(1 + 3 * decompositionLevels).fill(0x10);
  return makeBuffer([0x00, ...steps]);
}

// Build a minimal SOT payload.
// SOT parse order: tileIndex(2), tilePartLength(4), tilePartIndex(1), tilePartCount(1)
function makeSotBuffer({
  tileIndex = 0,
  tilePartLength = 20,
  tilePartIndex = 0,
  tilePartCount = 1,
} = {}) {
  return makeBuffer([
    ...uint16BE(tileIndex),
    ...uint32BE(tilePartLength),
    tilePartIndex & 0xff,
    tilePartCount & 0xff,
  ]);
}

// Build a TLM payload with stlm=0x10 (st=1→8-bit Ttlm, sp=0→16-bit Ptlm).
// ztlm(1) + stlm(1) + N×(ttlm(1)+ptlm(2))
function makeTlmBuffer(
  tiles = [
    { ttlm: 0, ptlm: 100 },
    { ttlm: 1, ptlm: 200 },
  ]
) {
  const bytes = [0x00 /*ztlm*/, 0x10 /*stlm*/];
  for (const t of tiles) {
    bytes.push(t.ttlm & 0xff, ...uint16BE(t.ptlm));
  }
  return makeBuffer(bytes);
}

// Build a COM payload (Latin1 registration).
// registration(2) + string bytes
function makeComBuffer(comment = 'Hello') {
  const chars = [...comment].map((c) => c.charCodeAt(0));
  return makeBuffer([...uint16BE(1), ...chars]);
}

describe('Segment', () => {
  it('should store marker, position and buffer from constructor', () => {
    const buf = new ArrayBuffer(8);
    const seg = new Segment(Marker.Com, 100, buf);
    expect(seg.getMarker()).to.equal(Marker.Com);
    expect(seg.getPosition()).to.equal(100);
    expect(seg.getBuffer()).to.equal(buf);
  });

  it('should return byteLength + 2 from getLength()', () => {
    const buf = new ArrayBuffer(10);
    const seg = new Segment(Marker.Com, 0, buf);
    expect(seg.getLength()).to.equal(12);
  });

  it('should return 0 from getLength() when buffer is falsy', () => {
    const seg = new Segment(Marker.Com, 0, null);
    expect(seg.getLength()).to.equal(0);
  });

  it('should throw from parse()', () => {
    const seg = new Segment(Marker.Com, 0, new ArrayBuffer(4));
    expect(() => seg.parse()).to.throw('parse should be implemented');
  });

  it('should include marker name and position in toString()', () => {
    const seg = new Segment(Marker.Com, 256, new ArrayBuffer(4));
    expect(seg.toString()).to.include('Com');
    expect(seg.toString()).to.include('256');
  });

  it('should fall back to hex in toString() for unknown marker value', () => {
    const seg = new Segment(0xabcd, 0, new ArrayBuffer(4));
    expect(seg.toString()).to.include('0xabcd');
  });
});

describe('SizSegment', () => {
  it('should have Marker.Siz as its marker', () => {
    const seg = new SizSegment(0, makeSizBuffer());
    expect(seg.getMarker()).to.equal(Marker.Siz);
  });

  it('should parse width, height and components', () => {
    const seg = new SizSegment(0, makeSizBuffer({ w: 512, h: 256, components: 1 }));
    seg.parse();
    expect(seg.getWidth(0)).to.equal(512);
    expect(seg.getHeight(0)).to.equal(256);
    expect(seg.getComponents()).to.equal(1);
  });

  it('should parse bit depth and signedness from precision byte', () => {
    // precision 0x07 → 8-bit unsigned; 0x87 → 8-bit signed
    const seg = new SizSegment(0, makeSizBuffer({ precisions: [0x87] }));
    seg.parse();
    expect(seg.getBitDepth(0)).to.equal(8);
    expect(seg.isSigned(0)).to.equal(true);
  });

  it('should parse sub-sampling values', () => {
    const seg = new SizSegment(0, makeSizBuffer({ ssX: [2], ssY: [1] }));
    seg.parse();
    expect(seg.getSubSamplingX(0)).to.equal(2);
    expect(seg.getSubSamplingY(0)).to.equal(1);
  });

  it('should compute getNumberOfTiles() correctly', () => {
    // 256×128 image, 128×64 tiles → 2×2 tiles
    const seg = new SizSegment(0, makeSizBuffer({ w: 256, h: 128, tileW: 128, tileH: 64 }));
    seg.parse();
    const numTiles = seg.getNumberOfTiles();
    expect(numTiles.getWidth()).to.equal(2);
    expect(numTiles.getHeight()).to.equal(2);
  });

  it('should throw when profile bit 14 is not set', () => {
    const seg = new SizSegment(0, makeSizBuffer({ profile: 0x0000 }));
    expect(() => seg.parse()).to.throw('Profile bit 14 not set');
  });

  it('should throw when sub-sampling is zero', () => {
    const seg = new SizSegment(0, makeSizBuffer({ ssX: [0], ssY: [1] }));
    expect(() => seg.parse()).to.throw('Sub-sampling must be strictly positive');
  });

  it('should throw when component is out of range in getBitDepth()', () => {
    const seg = new SizSegment(0, makeSizBuffer({ components: 1 }));
    seg.parse();
    expect(() => seg.getBitDepth(2)).to.throw('Requested component is out of range');
  });
});

describe('CapSegment', () => {
  it('should have Marker.Cap as its marker', () => {
    // capabilities = 0x00020000, popcount = 1, buffer = 4 + 2 = 6 bytes
    const buf = makeBuffer([...uint32BE(0x00020000), 0x00, 0x00]);
    const seg = new CapSegment(0, buf);
    expect(seg.getMarker()).to.equal(Marker.Cap);
  });

  it('should parse capabilities value', () => {
    const buf = makeBuffer([...uint32BE(0x00020000), 0x00, 0x00]);
    const seg = new CapSegment(0, buf);
    seg.parse();
    expect(seg.getCapabilities()).to.equal(0x00020000);
  });

  it('should throw when HTJ2K bit 17 is not set', () => {
    // capabilities = 0x00000000 (bit 17 clear)
    const buf = makeBuffer([...uint32BE(0x00000000)]);
    const seg = new CapSegment(0, buf);
    expect(() => seg.parse()).to.throw('Capabilities should have its 15th MSB set');
  });

  it('should throw when unsupported option bits are set', () => {
    // capabilities has bits other than 0x00020000 set
    const buf = makeBuffer([...uint32BE(0x00030000), 0x00, 0x00, 0x00, 0x00]);
    const seg = new CapSegment(0, buf);
    expect(() => seg.parse()).to.throw('CAP segment has options that are not supported');
  });
});

describe('CodSegment', () => {
  it('should have Marker.Cod as its marker', () => {
    const seg = new CodSegment(0, makeCodBuffer());
    expect(seg.getMarker()).to.equal(Marker.Cod);
  });

  it('should parse progression order and decomposition levels', () => {
    const seg = new CodSegment(
      0,
      makeCodBuffer({ progressionOrder: ProgressionOrder.Rpcl, decompositionLevels: 3 })
    );
    seg.parse();
    expect(seg.getProgressionOrder()).to.equal(ProgressionOrder.Rpcl);
    expect(seg.getDecompositionLevels()).to.equal(3);
  });

  it('should report isReversible() correctly', () => {
    const segRev = new CodSegment(0, makeCodBuffer({ wavelet: WaveletTransform.Reversible_5_3 }));
    segRev.parse();
    expect(segRev.isReversible()).to.equal(true);

    const segIrv = new CodSegment(0, makeCodBuffer({ wavelet: WaveletTransform.Irreversible_9_7 }));
    segIrv.parse();
    expect(segIrv.isReversible()).to.equal(false);
  });

  it('should compute getCodeblockSize() from exponents', () => {
    // expnX=2, expnY=2 → size = 1<<4 = 16 each
    const seg = new CodSegment(0, makeCodBuffer({ cbX: 2, cbY: 2 }));
    seg.parse();
    const sz = seg.getCodeblockSize();
    expect(sz.getWidth()).to.equal(16);
    expect(sz.getHeight()).to.equal(16);
  });

  it('should report usePrecincts() false when coding style bit 0 is clear', () => {
    const seg = new CodSegment(0, makeCodBuffer({ codingStyle: 0 }));
    seg.parse();
    expect(seg.usePrecincts()).to.equal(false);
  });

  it('should report useSopMarker() and useEphMarker() for combined coding style', () => {
    const seg = new CodSegment(0, makeCodBuffer({ codingStyle: 0x06 /* SOP|EPH */ }));
    seg.parse();
    expect(seg.useSopMarker()).to.equal(true);
    expect(seg.useEphMarker()).to.equal(true);
  });

  it('should report isEmployingColorTransform() correctly', () => {
    const seg = new CodSegment(0, makeCodBuffer({ mct: 1 }));
    seg.parse();
    expect(seg.isEmployingColorTransform()).to.equal(true);
  });

  it('should throw when quality layers is zero', () => {
    const seg = new CodSegment(0, makeCodBuffer({ qualityLayers: 0 }));
    expect(() => seg.parse()).to.throw('Quality layers must be positive');
  });
});

describe('QcdSegment', () => {
  it('should have Marker.Qcd as its marker', () => {
    const seg = new QcdSegment(0, makeQcdBuffer0(1));
    expect(seg.getMarker()).to.equal(Marker.Qcd);
  });

  it('should parse decomposition levels for style 0 (no quantization)', () => {
    // D=2: buffer size = 2+3*2 = 8 bytes
    const seg = new QcdSegment(0, makeQcdBuffer0(2));
    seg.parse();
    expect(seg.getDecompositionLevels()).to.equal(2);
    expect(seg.getQuantizationStyle()).to.equal(0);
  });

  it('should parse step sizes for style 2 (scalar expounded quantization)', () => {
    // D=1: getLength() = 5+6 = 11, byteLength = 9
    // Reads: style(1) + 1+3*1=4 uint16s (8 bytes) = 9 bytes total
    const steps = [0x1111, 0x2222, 0x3333, 0x4444];
    const stepBytes = steps.flatMap((s) => uint16BE(s));
    const buf = makeBuffer([0x02, ...stepBytes]);
    const seg = new QcdSegment(0, buf);
    seg.parse();
    expect(seg.getDecompositionLevels()).to.equal(1);
  });

  it('should throw for style 1 (scalar derived, unsupported)', () => {
    const buf = makeBuffer([0x01]);
    const seg = new QcdSegment(0, buf);
    expect(() => seg.parse()).to.throw('Scalar derived quantization is not supported yet');
  });

  it('should throw for invalid quantization style value', () => {
    const buf = makeBuffer([0x03]);
    const seg = new QcdSegment(0, buf);
    expect(() => seg.parse()).to.throw('Invalid quantization style value');
  });
});

describe('SotSegment', () => {
  it('should have Marker.Sot as its marker', () => {
    const seg = new SotSegment(0, makeSotBuffer());
    expect(seg.getMarker()).to.equal(Marker.Sot);
  });

  it('should parse tileIndex, tilePartLength, tilePartIndex and tilePartCount', () => {
    const seg = new SotSegment(
      0,
      makeSotBuffer({ tileIndex: 3, tilePartLength: 100, tilePartIndex: 1, tilePartCount: 2 })
    );
    seg.parse();
    expect(seg.getTileIndex()).to.equal(3);
    expect(seg.getTilePartLength()).to.equal(100);
    expect(seg.getTilePartIndex()).to.equal(1);
    expect(seg.getTilePartCount()).to.equal(2);
  });

  it('should compute getPayloadLength() as tilePartLength - 14 when > 0', () => {
    const seg = new SotSegment(0, makeSotBuffer({ tilePartLength: 50 }));
    seg.parse();
    expect(seg.getPayloadLength()).to.equal(36);
  });

  it('should return 0 from getPayloadLength() when tilePartLength is 0', () => {
    const seg = new SotSegment(0, makeSotBuffer({ tilePartLength: 0 }));
    seg.parse();
    expect(seg.getPayloadLength()).to.equal(0);
  });

  it('should include tile info in toString()', () => {
    const seg = new SotSegment(0, makeSotBuffer({ tileIndex: 5 }));
    seg.parse();
    expect(seg.toString()).to.include('Tile index: 5');
  });
});

describe('TlmSegment', () => {
  it('should have Marker.Tlm as its marker', () => {
    const seg = new TlmSegment(0, makeTlmBuffer());
    expect(seg.getMarker()).to.equal(Marker.Tlm);
  });

  it('should parse Ztlm and Stlm', () => {
    const seg = new TlmSegment(0, makeTlmBuffer());
    seg.parse();
    expect(seg.getZtlm()).to.equal(0);
    expect(seg.getStlm()).to.equal(0x10);
  });

  it('should parse Ttlm and Ptlm arrays (st=1, sp=0)', () => {
    const seg = new TlmSegment(
      0,
      makeTlmBuffer([
        { ttlm: 0, ptlm: 100 },
        { ttlm: 1, ptlm: 200 },
      ])
    );
    seg.parse();
    expect(seg.getTtlm()).to.deep.equal([0, 1]);
    expect(seg.getPtlm()).to.deep.equal([100, 200]);
  });

  it('should set ltlm to the full segment length', () => {
    const buf = makeTlmBuffer([{ ttlm: 0, ptlm: 100 }]);
    const seg = new TlmSegment(0, buf);
    seg.parse();
    // getLength() = byteLength + 2 = (2+3) + 2 = 7
    expect(seg.getLtlm()).to.equal(seg.getLength());
  });

  it('should parse a single-tile TLM correctly', () => {
    const seg = new TlmSegment(0, makeTlmBuffer([{ ttlm: 7, ptlm: 512 }]));
    seg.parse();
    expect(seg.getTtlm()).to.deep.equal([7]);
    expect(seg.getPtlm()).to.deep.equal([512]);
  });
});

describe('ComSegment', () => {
  it('should have Marker.Com as its marker', () => {
    const seg = new ComSegment(0, makeComBuffer('test'));
    expect(seg.getMarker()).to.equal(Marker.Com);
  });

  it('should parse registration and comment for Latin1 (registration=1)', () => {
    const seg = new ComSegment(0, makeComBuffer('Hello'));
    seg.parse();
    expect(seg.getRegistration()).to.equal(1);
    expect(seg.getComment()).to.equal('Hello');
  });

  it('should leave comment undefined for non-Latin1 registration', () => {
    // registration = 0 (binary data, no string parsed)
    const buf = makeBuffer([...uint16BE(0), 0xde, 0xad]);
    const seg = new ComSegment(0, buf);
    seg.parse();
    expect(seg.getRegistration()).to.equal(0);
    expect(seg.getComment()).to.equal(undefined);
  });

  it('should include comment text in toString()', () => {
    const seg = new ComSegment(0, makeComBuffer('World'));
    seg.parse();
    expect(seg.toString()).to.include('World');
  });
});
