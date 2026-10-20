const {
  CapSegment,
  CodSegment,
  ComSegment,
  NltSegment,
  PpmSegment,
  QccSegment,
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

  it('should expose the raw profile value via getProfile()', () => {
    const seg = new SizSegment(0, makeSizBuffer({ profile: 0x4000 }));
    seg.parse();
    expect(seg.getProfile()).to.equal(0x4000);
  });

  it('should include image info in toString()', () => {
    const seg = new SizSegment(0, makeSizBuffer({ w: 256, h: 128 }));
    seg.parse();
    const str = seg.toString();
    expect(str).to.include('Width: 256');
    expect(str).to.include('Height: 128');
    expect(str).to.include('Bit depth: 8');
    expect(str).to.include('Signed: false');
    expect(str).to.include('Components: 1');
  });

  it('should throw for out-of-range component in per-component getters', () => {
    const seg = new SizSegment(0, makeSizBuffer({ components: 1 }));
    seg.parse();
    expect(() => seg.getSubSamplingX(5)).to.throw('Requested component is out of range [5]');
    expect(() => seg.getSubSamplingY(5)).to.throw('Requested component is out of range [5]');
    expect(() => seg.getWidth(5)).to.throw('Requested component is out of range [5]');
    expect(() => seg.getHeight(5)).to.throw('Requested component is out of range [5]');
    expect(() => seg.isSigned(5)).to.throw('Requested component is out of range [5]');
  });

  it('should throw when reference grid width or height is zero', () => {
    expect(() => new SizSegment(0, makeSizBuffer({ w: 0 })).parse()).to.throw(
      'Reference grid width and height must be above zero'
    );
    expect(() => new SizSegment(0, makeSizBuffer({ h: 0 })).parse()).to.throw(
      'Reference grid width and height must be above zero'
    );
  });

  it('should throw when image offset is at the maximal value', () => {
    expect(() => new SizSegment(0, makeSizBuffer({ imgX: 0xffffffff })).parse()).to.throw(
      'Image offset must be below the maximal value for the reference grid'
    );
    expect(() => new SizSegment(0, makeSizBuffer({ imgY: 0xffffffff })).parse()).to.throw(
      'Image offset must be below the maximal value for the reference grid'
    );
  });

  it('should throw when tile width or height is zero', () => {
    expect(() => new SizSegment(0, makeSizBuffer({ tileW: 0 })).parse()).to.throw(
      'Reference tile width and height must be above zero'
    );
    expect(() => new SizSegment(0, makeSizBuffer({ tileH: 0 })).parse()).to.throw(
      'Reference tile width and height must be above zero'
    );
  });

  it('should throw when tile offset is at the maximal value', () => {
    expect(() => new SizSegment(0, makeSizBuffer({ tileOffX: 0xffffffff })).parse()).to.throw(
      'Tile offset must be below the maximal value for the tile size'
    );
  });

  it('should throw when component count is out of range', () => {
    expect(() => new SizSegment(0, makeSizBuffer({ components: 0, precisions: [], ssX: [], ssY: [] })).parse()).to.throw(
      'Component count out of valid range [0]'
    );
    expect(() => new SizSegment(0, makeSizBuffer({ components: 20000 })).parse()).to.throw(
      'Component count out of valid range'
    );
  });

  it('should throw when component count and length disagree', () => {
    // Declare 1 component but omit the 3 component bytes (L=38, expected 41)
    const buf = makeBuffer([
      ...uint16BE(0x4000),
      ...uint32BE(1),
      ...uint32BE(1),
      ...uint32BE(0),
      ...uint32BE(0),
      ...uint32BE(1),
      ...uint32BE(1),
      ...uint32BE(0),
      ...uint32BE(0),
      ...uint16BE(1),
    ]);
    expect(() => new SizSegment(0, buf).parse()).to.throw(
      'Component count and length of SIZ segment do not agree'
    );
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

  it('should throw when capabilities count and length disagree', () => {
    // popcount(0x00020000) = 1 → expected length 8, but buffer gives length 6
    const buf = makeBuffer([...uint32BE(0x00020000)]);
    const seg = new CapSegment(0, buf);
    expect(() => seg.parse()).to.throw(
      'Capabilities count and length of CAP segment do not agree'
    );
  });

  it('should include binary capabilities in toString()', () => {
    const buf = makeBuffer([...uint32BE(0x00020000), 0x00, 0x00]);
    const seg = new CapSegment(0, buf);
    seg.parse();
    expect(seg.toString()).to.include('Capabilities: 100000000000000000');
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

  it('should throw when coding style byte exceeds valid bits', () => {
    // valid bits are 0x07 (UsePrecincts|UseSopMarker|UseEphMarker = 1|2|4)
    expect(() => new CodSegment(0, makeCodBuffer({ codingStyle: 0x08 })).parse()).to.throw(
      'Invalid coding style'
    );
  });

  it('should throw when multiple component transform is greater than 1', () => {
    expect(() => new CodSegment(0, makeCodBuffer({ mct: 2 })).parse()).to.throw(
      'Multiple component transform must be 0 or 1'
    );
  });

  it('should throw when decomposition levels exceed 32', () => {
    expect(() => new CodSegment(0, makeCodBuffer({ decompositionLevels: 33 })).parse()).to.throw(
      'Decomposition levels must be 32 or less'
    );
  });

  it('should throw when codeblock height exponent is out of range', () => {
    expect(() => new CodSegment(0, makeCodBuffer({ cbY: 17 })).parse()).to.throw(
      'Codeblock width and height must be at most 1K samples'
    );
  });

  it('should expose coding parameters via getters', () => {
    const seg = new CodSegment(
      0,
      makeCodBuffer({
        codingStyle: 0,
        qualityLayers: 5,
        cbX: 2,
        cbY: 3,
        cbStyle: 0x01,
        wavelet: WaveletTransform.Irreversible_9_7,
      })
    );
    seg.parse();
    expect(seg.getCodingStyle()).to.equal(0);
    expect(seg.getQualityLayers()).to.equal(5);
    expect(seg.getLogCodeblockSize()).to.deep.equal({ width: 4, height: 5 });
    expect(seg.getCodeblockStyle()).to.equal(0x01);
    expect(seg.getWaveletFilter()).to.equal(WaveletTransform.Irreversible_9_7);
  });

  it('should include uppercase progression order in toString()', () => {
    const seg = new CodSegment(0, makeCodBuffer({ progressionOrder: ProgressionOrder.Rpcl }));
    seg.parse();
    const str = seg.toString();
    expect(str).to.include('Progression order: RPCL');
    expect(str).to.include('Decomposition levels: 1');
    expect(str).to.include('Reversible: true');
  });

  it('should default precinct sizes to 0xf per level when precincts are unused', () => {
    const seg = new CodSegment(0, makeCodBuffer({ decompositionLevels: 2 }));
    seg.parse();
    expect(seg.getPrecinctSize(0)).to.deep.equal({ width: 15, height: 15 });
    expect(seg.getPrecinctSize(2)).to.deep.equal({ width: 15, height: 15 });
    expect(() => seg.getPrecinctSize(3)).to.throw('Requested precinct is out of range [3]');
  });

  it('should parse per-level precinct exponents when precincts are used', () => {
    // codingStyle 0x01 = UsePrecincts, D=1 → expected length 12+1+1=14 → byteLength 12.
    // Fixed part is 10 bytes + (D+1)=2 precinct bytes.
    const bytes = [
      0x01,
      0x00,
      ...uint16BE(1),
      0x00,
      0x01,
      0x04,
      0x04,
      0x00,
      0x01,
      0x53,
      0x42,
    ];
    const seg = new CodSegment(0, makeBuffer(bytes));
    seg.parse();
    expect(seg.usePrecincts()).to.equal(true);
    // val & 0xf → X exponent, (val >> 4) & 0xf → Y exponent
    expect(seg.getPrecinctSize(0)).to.deep.equal({ width: 3, height: 5 });
    expect(seg.getPrecinctSize(1)).to.deep.equal({ width: 2, height: 4 });
  });

  it('should throw on precinct length mismatch', () => {
    // UsePrecincts set but no precinct bytes supplied
    const bytes = [0x01, 0x00, ...uint16BE(1), 0x00, 0x01, 0x04, 0x04, 0x00, 0x01];
    expect(() => new CodSegment(0, makeBuffer(bytes)).parse()).to.throw(
      'Size mismatch in COD marker segment for precinct specs'
    );
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

  it('should throw for style 0 when length disagrees with step count', () => {
    // style 0: steps = getLength() - 3 must satisfy steps % 3 === 1.
    // byteLength 2 → L=4 → steps=1 → valid; byteLength 3 → L=5 → steps=2 → invalid.
    const buf = makeBuffer([0x00, 0x10, 0x10]);
    expect(() => new QcdSegment(0, buf).parse()).to.throw(
      'Invalid length value in QCD segment'
    );
  });

  it('should expose parsed step sizes for style 0 via getQuantizationStepSize()', () => {
    const seg = new QcdSegment(0, makeBuffer([0x00, 0x11, 0x22, 0x33, 0x44]));
    seg.parse();
    // 4 protection/step bytes → exponent/mantissa values as parsed
    expect(seg.getQuantizationStepSize()).to.deep.equal([0x11, 0x22, 0x33, 0x44]);
  });

  it('should expose parsed uint16 step sizes for style 2 via getQuantizationStepSize()', () => {
    const steps = [0x1111, 0x2222, 0x3333, 0x4444];
    const seg = new QcdSegment(0, makeBuffer([0x02, ...steps.flatMap(uint16BE)]));
    seg.parse();
    expect(seg.getQuantizationStyle()).to.equal(2);
    expect(seg.getQuantizationStepSize()).to.deep.equal(steps);
  });

  it('should throw for style 2 when length disagrees with step count', () => {
    // style 2: (getLength() - 3) must be even with steps % 3 === 1.
    // byteLength 4 → L=6 → (6-3)=3 is odd → invalid length
    const buf = makeBuffer([0x02, 0x00, 0x10, 0x10]);
    expect(() => new QcdSegment(0, buf).parse()).to.throw(
      'Invalid length value in QCD marker'
    );
  });

  it('should include decomposition levels and style in toString()', () => {
    const seg = new QcdSegment(0, makeQcdBuffer0(1));
    expect(seg.toString()).to.include('Quantization style: 0x0');
  });
});

describe('QccSegment', () => {
  // QCC payload mirrors QCD with a leading component byte:
  // component(1), style(1), then step bytes. Style 0: L = 4 + 3*(1+3D).
  function makeQccBuffer0(component = 0, decompositionLevels = 1) {
    const steps = new Array(1 + 3 * decompositionLevels).fill(0x10);
    return makeBuffer([component, 0x00, ...steps]);
  }

  it('should have Marker.Qcc as its marker', () => {
    const seg = new QccSegment(0, makeQccBuffer0());
    expect(seg.getMarker()).to.equal(Marker.Qcc);
  });

  it('should parse component, style, levels and step sizes for style 0', () => {
    const seg = new QccSegment(0, makeBuffer([0x02, 0x00, 0x11, 0x22, 0x33, 0x44]));
    seg.parse();
    expect(seg.getComponent()).to.equal(2);
    expect(seg.getQuantizationStyle()).to.equal(0);
    expect(seg.getDecompositionLevels()).to.equal(1);
    expect(seg.getQuantizationStepSize()).to.deep.equal([0x11, 0x22, 0x33, 0x44]);
  });

  it('should parse uint16 step sizes for style 2', () => {
    const steps = [0x1111, 0x2222, 0x3333, 0x4444];
    const seg = new QccSegment(0, makeBuffer([0x01, 0x02, ...steps.flatMap(uint16BE)]));
    seg.parse();
    expect(seg.getComponent()).to.equal(1);
    expect(seg.getDecompositionLevels()).to.equal(1);
    expect(seg.getQuantizationStepSize()).to.deep.equal(steps);
  });

  it('should throw for style 1 (scalar derived, unsupported)', () => {
    expect(() => new QccSegment(0, makeBuffer([0x00, 0x01])).parse()).to.throw(
      'Scalar derived quantization is not supported yet in QCC segment'
    );
  });

  it('should throw for invalid quantization style value', () => {
    expect(() => new QccSegment(0, makeBuffer([0x00, 0x03])).parse()).to.throw(
      'Invalid quantization style value in QCC segment'
    );
  });

  it('should throw for style 0 when length disagrees with step count', () => {
    // style 0: steps = getLength() - 4 must satisfy steps % 3 === 1.
    // byteLength 4 → L=6 → steps=2 → invalid.
    expect(() => new QccSegment(0, makeBuffer([0x00, 0x00, 0x10, 0x10])).parse()).to.throw(
      'Invalid length value in QCC segment'
    );
  });

  it('should throw for style 2 when length disagrees with step count', () => {
    // style 2 with 3 remaining step bytes → not divisible by 2
    expect(() =>
      new QccSegment(0, makeBuffer([0x00, 0x02, 0x00, 0x01, 0x02, 0x03, 0x04])).parse()
    ).to.throw('Invalid length value in QCC segment');
  });

  it('should include component in toString()', () => {
    const seg = new QccSegment(0, makeQccBuffer0(2, 1));
    seg.parse();
    expect(seg.toString()).to.include('Component: 2');
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

  it('should parse TLM without Ttlm values (stlm=0x00, 16-bit Ptlm)', () => {
    // ztlm(1) + stlm(1) + N×ptlm(2)
    const buf = makeBuffer([0x00, 0x00, ...uint16BE(300), ...uint16BE(400)]);
    const seg = new TlmSegment(0, buf);
    seg.parse();
    expect(seg.getTtlm()).to.deep.equal([]);
    expect(seg.getPtlm()).to.deep.equal([300, 400]);
  });

  it('should parse TLM with 16-bit Ttlm (stlm=0x20)', () => {
    // ztlm(1) + stlm(1) + ttlm(2) + ptlm(2)
    const buf = makeBuffer([0x00, 0x20, ...uint16BE(7), ...uint16BE(300)]);
    const seg = new TlmSegment(0, buf);
    seg.parse();
    expect(seg.getTtlm()).to.deep.equal([7]);
    expect(seg.getPtlm()).to.deep.equal([300]);
  });

  it('should parse TLM with 32-bit Ptlm (stlm=0x40)', () => {
    // ztlm(1) + stlm(1) + ptlm(4)
    const buf = makeBuffer([
      0x00,
      0x40,
      (70000 >>> 24) & 0xff,
      (70000 >>> 16) & 0xff,
      (70000 >>> 8) & 0xff,
      70000 & 0xff,
    ]);
    const seg = new TlmSegment(0, buf);
    seg.parse();
    expect(seg.getTtlm()).to.deep.equal([]);
    expect(seg.getPtlm()).to.deep.equal([70000]);
  });

  it('should throw for unknown Stlm value', () => {
    // stlm=17 is not in the valid table {0,16,32,64,80,96}
    const buf = makeBuffer([0x00, 0x11, 0x00, 0x00, 0x00, 0x00]);
    expect(() => new TlmSegment(0, buf).parse()).to.throw(Error);
  });

  it('should include tile-part lengths in toString()', () => {
    const seg = new TlmSegment(0, makeTlmBuffer([{ ttlm: 3, ptlm: 128 }]));
    seg.parse();
    const str = seg.toString();
    expect(str).to.include('Ztlm: 0');
    expect(str).to.include('Stlm: 16');
    expect(str).to.include('Ttlm: 3');
    expect(str).to.include('Ptlm: 128');
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

  it('should fall back to empty comment in toString() when not parsed', () => {
    const str = new ComSegment(0, makeBuffer([...uint16BE(0)])).toString();
    expect(str).to.include('Comment: ]');
  });
});

describe('PpmSegment', () => {
  it('should have Marker.Ppm as its marker', () => {
    const seg = new PpmSegment(0, makeBuffer([0x00]));
    expect(seg.getMarker()).to.equal(Marker.Ppm);
  });

  it('should parse Zppm and remaining payload bytes', () => {
    const seg = new PpmSegment(0, makeBuffer([0x02, 0xaa, 0xbb, 0xcc]));
    seg.parse();
    expect(seg.getZppm()).to.equal(2);
    expect(Array.from(seg.getPayload())).to.deep.equal([0xaa, 0xbb, 0xcc]);
  });

  it('should parse an empty payload when only Zppm is present', () => {
    const seg = new PpmSegment(0, makeBuffer([0x00]));
    seg.parse();
    expect(seg.getZppm()).to.equal(0);
    expect(seg.getPayload().length).to.equal(0);
  });

  it('should include Zppm and payload size in toString()', () => {
    const seg = new PpmSegment(0, makeBuffer([0x02, 0xaa, 0xbb, 0xcc]));
    seg.parse();
    const str = seg.toString();
    expect(str).to.include('Zppm: 2');
    expect(str).to.include('Payload bytes: 3');
  });
});

describe('NltSegment', () => {
  it('should have Marker.Nlt as its marker', () => {
    const seg = new NltSegment(0, makeBuffer([0xff, 0xff, 0x07, 0x03]));
    expect(seg.getMarker()).to.equal(Marker.Nlt);
  });

  it('should parse all-components marker and signed bit depth', () => {
    // Cnlt=0xffff, BDnlt raw 0x87 → bit depth 8, signed; Tnlt=1 with gamma E,L,T.
    // Gamma bytes are only read when byteLength - 5 >= 3, so pad one extra byte.
    const seg = new NltSegment(0, makeBuffer([0xff, 0xff, 0x87, 0x01, 0x05, 0x03, 0x02, 0x00]));
    seg.parse();
    expect(seg.isForAllComponents()).to.equal(true);
    expect(seg.getComponent()).to.equal(0xffff);
    expect(seg.getBitDepth()).to.equal(8);
    expect(seg.isSigned()).to.equal(true);
    expect(seg.getType()).to.equal(1);
  });

  it('should parse a specific component with unsigned depth and no gamma bytes', () => {
    // Cnlt=2, BDnlt raw 0x07 → bit depth 8 unsigned; Tnlt=1 but <3 remaining bytes
    const seg = new NltSegment(0, makeBuffer([0x00, 0x02, 0x07, 0x01]));
    seg.parse();
    expect(seg.isForAllComponents()).to.equal(false);
    expect(seg.getComponent()).to.equal(2);
    expect(seg.getBitDepth()).to.equal(8);
    expect(seg.isSigned()).to.equal(false);
    expect(seg.getType()).to.equal(1);
  });

  it('should parse a LUT (Tnlt=2) with leading Npts', () => {
    // Cnlt=0, BDnlt=8, Tnlt=2, Npts=3, then 3 raw table bytes
    const seg = new NltSegment(0, makeBuffer([0x00, 0x00, 0x07, 0x02, 0x00, 0x03, 0x11, 0x22, 0x33]));
    expect(() => seg.parse()).to.not.throw();
    expect(seg.getType()).to.equal(2);
  });

  it('should parse a LUT (Tnlt=2) with only Npts and no table bytes', () => {
    const seg = new NltSegment(0, makeBuffer([0x00, 0x00, 0x07, 0x02, 0x00, 0x01]));
    expect(() => seg.parse()).to.not.throw();
  });

  it('should parse two\'s-complement type (Tnlt=3) without parameters', () => {
    const seg = new NltSegment(0, makeBuffer([0x00, 0x00, 0x07, 0x03]));
    seg.parse();
    expect(seg.getType()).to.equal(3);
  });

  it('should include Cnlt, bit depth and type in toString()', () => {
    const all = new NltSegment(0, makeBuffer([0xff, 0xff, 0x87, 0x01]));
    all.parse();
    expect(all.toString()).to.include('Cnlt: ALL');
    expect(all.toString()).to.include('Signed: true');

    const one = new NltSegment(0, makeBuffer([0x00, 0x01, 0x07, 0x03]));
    one.parse();
    expect(one.toString()).to.include('Cnlt: 1');
    expect(one.toString()).to.include('Signed: false');
  });
});
