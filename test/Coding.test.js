const { Tile, TilePart, TileComponent, Resolution, SubBand } = require('./../src/Coding');
const { SizSegment, CodSegment, QcdSegment, SotSegment } = require('./../src/Segment');
const { Point, Rectangle, Size } = require('./../src/Helpers');
const { SubBandType, WaveletTransform } = require('./../src/Constants');

const chai = require('chai');
const expect = chai.expect;

//#region Segment builder helpers
function makeBuffer(bytes) {
  const buf = Buffer.from(bytes);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function u32BE(v) {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u16BE(v) {
  return [(v >>> 8) & 0xff, v & 0xff];
}

// Builds a parsed SizSegment for an N-component image.
// getLength() = byteLength+2 must equal 38+3*components
function buildSiz({ w = 8, h = 8, components = 1, precisions, ssX, ssY } = {}) {
  precisions = precisions || new Array(components).fill(0x07);
  ssX = ssX || new Array(components).fill(1);
  ssY = ssY || new Array(components).fill(1);
  const compBytes = [];
  for (let i = 0; i < components; i++) {
    compBytes.push(precisions[i] & 0xff, ssX[i] & 0xff, ssY[i] & 0xff);
  }
  const buf = makeBuffer([
    ...u16BE(0x4000), // profile (bit 14 required)
    ...u32BE(w),
    ...u32BE(h),
    ...u32BE(0),
    ...u32BE(0), // imageOffset
    ...u32BE(w),
    ...u32BE(h), // tileSize
    ...u32BE(0),
    ...u32BE(0), // tileOffset
    ...u16BE(components),
    ...compBytes,
  ]);
  const seg = new SizSegment(0, buf);
  seg.parse();
  return seg;
}

// Builds a parsed CodSegment with no precincts.
// getLength() = byteLength+2; for no-precinct COD the parse just reads 10 bytes
// → byteLength must be 10 (allows decompositionLevels+1 default precinct entries)
function buildCod({
  decompositionLevels = 1,
  wavelet = WaveletTransform.Reversible_5_3,
  progressionOrder = 0,
  qualityLayers = 1,
  mct = 0,
  cbX = 2,
  cbY = 2,
  codingStyle = 0,
  cbStyle = 0,
} = {}) {
  const buf = makeBuffer([
    codingStyle,
    progressionOrder,
    ...u16BE(qualityLayers),
    mct,
    decompositionLevels,
    cbX,
    cbY,
    cbStyle,
    wavelet,
  ]);
  const seg = new CodSegment(0, buf);
  seg.parse();
  return seg;
}

// Builds a parsed QcdSegment for style 0 (no quantization) with the given decompositionLevels.
// getLength() = byteLength+2 must equal 4+3*D → byteLength = 2+3*D
function buildQcd(decompositionLevels = 1) {
  const steps = new Array(1 + 3 * decompositionLevels).fill(0x10);
  const buf = makeBuffer([0x00, ...steps]);
  const seg = new QcdSegment(0, buf);
  seg.parse();
  return seg;
}

// Builds a parsed SotSegment.
function buildSot({ tileIndex = 0, tilePartLength = 20 } = {}) {
  const buf = makeBuffer([...u16BE(tileIndex), ...u32BE(tilePartLength), 0, 1]);
  const seg = new SotSegment(0, buf);
  seg.parse();
  return seg;
}

// Standard minimal precinctParams / codeblockParams for manual Resolution/SubBand tests.
function makePrecinctParams({ numW = 1, numH = 1, pw = 8, ph = 8, psW = 8, psH = 8 } = {}) {
  return {
    precinctWidth: pw,
    precinctHeight: ph,
    precinctWidthInSubBand: psW,
    precinctHeightInSubBand: psH,
    numPrecinctsWide: numW,
    numPrecinctsHigh: numH,
    numPrecincts: numW * numH,
  };
}
function makeCodeblockParams(cbLogW = 2, cbLogH = 2, scale = 1) {
  return { codeblockSize: new Size(cbLogW, cbLogH), scale };
}

describe('Tile', () => {
  it('should store tileIndex and tileRect', () => {
    const siz = buildSiz();
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tile = new Tile(0, rect, siz, cod, qcd);
    expect(tile.getTileIndex()).to.equal(0);
    expect(tile.getTileRectangle()).to.equal(rect);
  });

  it('should compute getWidth() and getHeight() from rectangle', () => {
    const siz = buildSiz({ w: 16, h: 32 });
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(16, 32));
    const tile = new Tile(0, rect, siz, cod, qcd);
    expect(tile.getWidth()).to.equal(16);
    expect(tile.getHeight()).to.equal(32);
  });

  it('should create one TileComponent per SIZ component', () => {
    const siz = buildSiz({
      components: 3,
      precisions: [0x07, 0x07, 0x07],
      ssX: [1, 1, 1],
      ssY: [1, 1, 1],
    });
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tile = new Tile(0, rect, siz, cod, qcd);
    expect(tile.tileComponents.length).to.equal(3);
  });

  it('should store the COD segment via getCodingStyleParameters()', () => {
    const siz = buildSiz();
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tile = new Tile(0, rect, siz, cod, qcd);
    expect(tile.getCodingStyleParameters()).to.equal(cod);
  });

  it('should start with an empty tileParts array', () => {
    const siz = buildSiz();
    const cod = buildCod();
    const qcd = buildQcd();
    const tile = new Tile(0, new Rectangle(new Point(0, 0), new Size(8, 8)), siz, cod, qcd);
    expect(tile.tileParts).to.be.an('array').that.is.empty;
  });

  it('should add tile parts via addTilePart()', () => {
    const siz = buildSiz();
    const cod = buildCod();
    const qcd = buildQcd();
    const tile = new Tile(0, new Rectangle(new Point(0, 0), new Size(8, 8)), siz, cod, qcd);
    const tp = new TilePart(buildSot(), 50);
    tile.addTilePart(tp);
    expect(tile.tileParts.length).to.equal(1);
    expect(tile.tileParts[0]).to.equal(tp);
  });

  it('should include index and dimensions in toString()', () => {
    const siz = buildSiz({ w: 4, h: 4 });
    const cod = buildCod();
    const qcd = buildQcd();
    const tile = new Tile(2, new Rectangle(new Point(0, 0), new Size(4, 4)), siz, cod, qcd);
    const str = tile.toString();
    expect(str).to.include('Index: 2');
    expect(str).to.include('Width: 4');
    expect(str).to.include('Height: 4');
  });
});

describe('TilePart', () => {
  it('should store the SOT segment and sodPosition', () => {
    const sot = buildSot({ tileIndex: 3, tilePartLength: 100 });
    const tp = new TilePart(sot, 200);
    expect(tp.sotSegment).to.equal(sot);
    expect(tp.sodPosition).to.equal(200);
  });

  it('should reflect the tile index from the wrapped SOT segment', () => {
    const sot = buildSot({ tileIndex: 5 });
    const tp = new TilePart(sot, 0);
    expect(tp.sotSegment.getTileIndex()).to.equal(5);
  });
});

describe('TileComponent', () => {
  it('should store index and rectangle', () => {
    const siz = buildSiz();
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tc = new TileComponent(0, rect, siz, cod, qcd);
    expect(tc.getTileComponentIndex()).to.equal(0);
    expect(tc.getTileComponentRectangle()).to.equal(rect);
  });

  it('should compute getWidth() and getHeight() from rectangle', () => {
    const siz = buildSiz({ w: 16, h: 32 });
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(16, 32));
    const tc = new TileComponent(0, rect, siz, cod, qcd);
    expect(tc.getWidth()).to.equal(16);
    expect(tc.getHeight()).to.equal(32);
  });

  it('should expose getBitDepth() and isSigned() from the SIZ segment', () => {
    // precision 0x87 → 8-bit signed
    const siz = buildSiz({ precisions: [0x87] });
    const cod = buildCod();
    const qcd = buildQcd();
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const tc = new TileComponent(0, rect, siz, cod, qcd);
    expect(tc.getBitDepth()).to.equal(8);
    expect(tc.isSigned()).to.equal(true);
  });

  it('should expose getSubSamplingX() and getSubSamplingY() from SIZ', () => {
    const siz = buildSiz({ ssX: [2], ssY: [1] });
    const cod = buildCod();
    const qcd = buildQcd();
    const tc = new TileComponent(0, new Rectangle(new Point(0, 0), new Size(4, 4)), siz, cod, qcd);
    expect(tc.getSubSamplingX()).to.equal(2);
    expect(tc.getSubSamplingY()).to.equal(1);
  });

  it('should create decompositionLevels+1 resolutions', () => {
    const siz = buildSiz();
    const cod = buildCod({ decompositionLevels: 2 });
    const qcd = buildQcd(2);
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tc = new TileComponent(0, rect, siz, cod, qcd);
    expect(tc.resolutions.length).to.equal(3); // D+1 = 3
  });

  it('should give resolution 0 a lower scale than later resolutions', () => {
    const siz = buildSiz();
    const cod = buildCod({ decompositionLevels: 1 });
    const qcd = buildQcd(1);
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const tc = new TileComponent(0, rect, siz, cod, qcd);
    const scale0 = tc.resolutions[0].getCodeblockParameters().scale;
    const scale1 = tc.resolutions[1].getCodeblockParameters().scale;
    expect(scale0).to.be.greaterThan(scale1);
  });
});

describe('Resolution', () => {
  it('should store index, rectangle and decomposition level', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const res = new Resolution(0, rect, 0, makePrecinctParams(), makeCodeblockParams());
    expect(res.getResolutionIndex()).to.equal(0);
    expect(res.getResolutionRectangle()).to.equal(rect);
    expect(res.getDecompositionLevel()).to.equal(0);
  });

  it('should create a single LL sub-band at decomposition level 0', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const res = new Resolution(0, rect, 0, makePrecinctParams(), makeCodeblockParams());
    expect(res.subBands.length).to.equal(1);
    expect(res.subBands[0].getSubBandType()).to.equal(SubBandType.Ll);
  });

  it('should create HL, LH, HH sub-bands at decomposition level > 0', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const res = new Resolution(1, rect, 1, makePrecinctParams(), makeCodeblockParams());
    const types = res.subBands.map((sb) => sb.getSubBandType());
    expect(types).to.include(SubBandType.Hl);
    expect(types).to.include(SubBandType.Lh);
    expect(types).to.include(SubBandType.Hh);
    expect(res.subBands.length).to.equal(3);
  });

  it('should expose getPrecinctParameters() and getCodeblockParameters()', () => {
    const pp = makePrecinctParams();
    const cp = makeCodeblockParams();
    const res = new Resolution(0, new Rectangle(new Point(0, 0), new Size(4, 4)), 0, pp, cp);
    expect(res.getPrecinctParameters()).to.equal(pp);
    expect(res.getCodeblockParameters()).to.equal(cp);
  });
});

describe('SubBand', () => {
  it('should store index, type and rectangle', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const sb = new SubBand(1, SubBandType.Lh, rect);
    expect(sb.getSubBandIndex()).to.equal(1);
    expect(sb.getSubBandType()).to.equal(SubBandType.Lh);
    expect(sb.getSubBandRectangle()).to.equal(rect);
  });

  it('should have empty codeblocks and precincts when no params given', () => {
    const sb = new SubBand(0, SubBandType.Ll, new Rectangle(new Point(0, 0), new Size(4, 4)));
    expect(sb.codeblocks).to.be.an('array').that.is.empty;
    expect(sb.precincts).to.be.an('array').that.is.empty;
  });

  it('should create the correct number of codeblocks for an 8×8 sub-band with 4×4 codeblocks', () => {
    // rect 0→8 × 0→8, cbLogW=cbLogH=2 → cbW=cbH=4 → 2×2=4 codeblocks
    const rect = new Rectangle(new Point(0, 0), new Size(8, 8));
    const pp = makePrecinctParams({ numW: 1, numH: 1, pw: 8, ph: 8, psW: 4, psH: 4 });
    const cp = makeCodeblockParams(2, 2);
    const sb = new SubBand(0, SubBandType.Hl, rect, pp, cp);
    expect(sb.codeblocks.length).to.equal(4);
  });

  it('should initialise each codeblock with zero passes and null data', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const pp = makePrecinctParams({ numW: 1, numH: 1, pw: 8, ph: 8, psW: 4, psH: 4 });
    const cp = makeCodeblockParams(2, 2);
    const sb = new SubBand(0, SubBandType.Hl, rect, pp, cp);
    for (const cb of sb.codeblocks) {
      expect(cb.passes).to.equal(0);
      expect(cb.data).to.equal(null);
      expect(cb.coeffs).to.equal(null);
    }
  });

  it('should create one precinct for a 1×1 precinct grid', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const pp = makePrecinctParams({ numW: 1, numH: 1, pw: 8, ph: 8, psW: 4, psH: 4 });
    const cp = makeCodeblockParams(2, 2);
    const sb = new SubBand(0, SubBandType.Hl, rect, pp, cp);
    expect(sb.precincts.length).to.equal(1);
  });

  it('should attach inclusionTree and zeroBitTree to each precinct', () => {
    const rect = new Rectangle(new Point(0, 0), new Size(4, 4));
    const pp = makePrecinctParams({ numW: 1, numH: 1, pw: 8, ph: 8, psW: 4, psH: 4 });
    const cp = makeCodeblockParams(2, 2);
    const sb = new SubBand(0, SubBandType.Hl, rect, pp, cp);
    expect(sb.precincts[0].inclusionTree).to.not.equal(undefined);
    expect(sb.precincts[0].zeroBitTree).to.not.equal(undefined);
  });

  it('should produce no codeblocks when the sub-band rect is empty', () => {
    // x1 <= x0 triggers early return
    const rect = new Rectangle(new Point(4, 4), new Size(4, 4));
    const pp = makePrecinctParams();
    const cp = makeCodeblockParams(2, 2);
    const sb = new SubBand(0, SubBandType.Hl, rect, pp, cp);
    expect(sb.codeblocks.length).to.equal(0);
  });
});
