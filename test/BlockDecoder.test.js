const BlockDecoder = require('./../src/BlockDecoder');

const chai = require('chai');
const expect = chai.expect;

// Builds a Uint8Array of (offset + lengths1) bytes filled with 0xff, with the
// scup field encoded in the last two bytes at position (offset + lengths1).
function makeData(lengths1, scup = 2, offset = 0) {
  const buf = new Uint8Array(offset + lengths1).fill(0xff);
  buf[offset + lengths1 - 2] = scup & 0x0f;
  buf[offset + lengths1 - 1] = (scup >> 4) & 0xff;
  return buf;
}

// Builds a Uint8Array of (offset + lengths1) bytes filled with 0x00, with the
// scup field encoded in the last two bytes at position (offset + lengths1).
// All-zero MEL data causes MEL run = 1 → run-2 = -1 → t0 preserved → significant coefficients.
function makeZero(lengths1, scup, offset = 0) {
  const buf = new Uint8Array(offset + lengths1).fill(0);
  buf[offset + lengths1 - 2] = scup & 0x0f;
  buf[offset + lengths1 - 1] = (scup >> 4) & 0xff;
  return buf;
}

describe('BlockDecoder', () => {
  describe('constructor', () => {
    it('creates an instance of BlockDecoder', () => {
      const bd = new BlockDecoder();
      expect(bd).to.be.instanceOf(BlockDecoder);
    });

    it('MEL_EXP has 13 entries', () => {
      const bd = new BlockDecoder();
      expect(bd.MEL_EXP).to.have.lengthOf(13);
    });

    it('MEL_EXP matches the standard MEL threshold exponent table', () => {
      const bd = new BlockDecoder();
      expect(Array.from(bd.MEL_EXP)).to.deep.equal([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5]);
    });
  });

  describe('decodeCodeblock - null guard conditions', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('returns null when lengths1 < 2', () => {
      const data = new Uint8Array(10);
      expect(bd.decodeCodeblock(data, 0, 0, 1, 1, 0, 2, 2)).to.be.null;
    });

    it('returns null when missingMSBs > 30', () => {
      const data = new Uint8Array(10);
      expect(bd.decodeCodeblock(data, 0, 31, 1, 4, 0, 2, 2)).to.be.null;
    });

    it('returns null when missingMSBs === 30', () => {
      const data = new Uint8Array(10);
      expect(bd.decodeCodeblock(data, 0, 30, 1, 4, 0, 2, 2)).to.be.null;
    });

    it('returns null when scup < 2', () => {
      // scup = (data[1] << 4) | (data[0] & 0xf) = (0 << 4) | 1 = 1
      const data = new Uint8Array([0x01, 0x00]);
      expect(bd.decodeCodeblock(data, 0, 0, 1, 2, 0, 2, 2)).to.be.null;
    });

    it('returns null when scup > lengths1', () => {
      // scup = (0x10 << 4) | (0 & 0xf) = 256 > lengths1=4
      const data = new Uint8Array([0x00, 0x00, 0x00, 0x10]);
      expect(bd.decodeCodeblock(data, 0, 0, 1, 4, 0, 2, 2)).to.be.null;
    });

    it('returns null when scup > 4079', () => {
      // scup = (0xff << 4) | (0xf & 0xf) = 4095 > 4079
      const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      expect(bd.decodeCodeblock(data, 0, 0, 1, 4, 0, 2, 2)).to.be.null;
    });
  });

  describe('decodeCodeblock - return type and size', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('returns an Int32Array for a valid 2×2 block', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 2, 2);
      expect(result).to.be.instanceOf(Int32Array);
    });

    it('returned array length equals width×height for a 2×2 block', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 2, 2);
      expect(result.length).to.equal(4);
    });

    it('returned array length equals width×height for a 4×4 block', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 4, 4);
      expect(result.length).to.equal(16);
    });

    it('returned array length equals width×height for a 2×4 block', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 2, 4);
      expect(result.length).to.equal(8);
    });

    it('returned array length equals width×height for an 8×8 block', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 8, 8);
      expect(result.length).to.equal(64);
    });
  });

  describe('decodeCodeblock - known output', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('produces the expected coefficient values for a known 2×2 bitstream', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 8, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, -536870912, 0]);
    });

    it('produces identical output when a non-zero offset is used', () => {
      const data = makeData(8, 2, 4); // offset=4, so total buffer length is 12
      const result = bd.decodeCodeblock(data, 4, 0, 1, 8, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, -536870912, 0]);
    });
  });

  describe('decodeCodeblock - clamping behaviour', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('clamps numPasses > 3 to 3 and still returns Int32Array', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 5, 8, 0, 2, 2);
      expect(result).to.be.instanceOf(Int32Array);
    });

    it('clamps numPasses to 1 when lengths2 is 0', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 2, 8, 0, 2, 2);
      expect(result).to.be.instanceOf(Int32Array);
    });

    it('clamps numPasses to 1 when missingMSBs is 29', () => {
      const data = makeData(8, 2);
      const result = bd.decodeCodeblock(data, 0, 29, 2, 8, 0, 2, 2);
      expect(result).to.be.instanceOf(Int32Array);
    });
  });

  describe('decodeCodeblock - significant coefficients (zero data)', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    // All-zero MEL stream → run=1, run-2=-1 → t0 preserved → significance bits set → _frwdFetch called
    it('returns expected coefficients for a 2×2 block with zero data (missingMSBs=0)', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 16, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, 1610612736, 0]);
    });

    it('returns expected coefficients for a 2×2 block with zero data (missingMSBs=5)', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 5, 1, 16, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, 50331648, 0]);
    });

    it('returns expected coefficients for a 2×2 block with zero data (missingMSBs=10)', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 10, 1, 16, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, 1572864, 0]);
    });

    it('returns expected coefficients for a 2×2 block with zero data (missingMSBs=15)', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 15, 1, 16, 0, 2, 2);
      expect(Array.from(result)).to.deep.equal([0, 0, 49152, 0]);
    });

    it('returns Int32Array(16) for a 4×4 block with zero data', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 16, 0, 4, 4);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(16);
    });

    it('returns Int32Array(64) for an 8×8 block with zero data', () => {
      const data = makeZero(16, 4);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 16, 0, 8, 8);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(64);
    });
  });

  describe('decodeCodeblock - MEL reader paths', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    // lcup=64, scup=2: MEL segment is 62 bytes, after align only 1 byte remains → _melRead size=0 path
    it('exercises _melRead size=0 fill path (16×16 lcup=64 scup=2)', () => {
      const data = makeZero(64, 2);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 64, 0, 16, 16);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(256);
    });

    // lcup=64, scup=6: MEL segment is 58 bytes, after align 3 bytes remain → _melRead size 1-4 byte path
    it('exercises _melRead size 1-4 bytes path (16×16 lcup=64 scup=6)', () => {
      const data = makeZero(64, 6);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 64, 0, 16, 16);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(256);
    });

    // lcup=200, scup=10: MEL segment is 190 bytes, after align 5 bytes remain → _melRead size>4 four-byte read path
    it('exercises _melRead size>4 four-byte read path (16×16 lcup=200 scup=10)', () => {
      const data = makeZero(200, 10);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 200, 0, 16, 16);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(256);
    });

    // 0xff MEL data with lcup=64, scup=10: MEL symbols terminate quickly → k increments to 12 path in _melDecode
    it('exercises _melDecode k-increment path (4×4 lcup=64 scup=10 ff data)', () => {
      const data = makeData(64, 10);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 64, 0, 4, 4);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(16);
    });
  });

  describe('decodeCodeblock - REV/FRWD reader paths', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    // lcup=32, scup=8: REV segment is 8 bytes, _revInit reads 5 → 3 remain → _revRead size>0 path
    it('exercises _revRead size>0 path (4×4 lcup=32 scup=8)', () => {
      const data = makeZero(32, 8);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 32, 0, 4, 4);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(16);
    });

    // lcup=32, scup=4: MagSgn segment is 28 bytes, _frwdInit reads 4 → 24 remain → _frwdRead size>3 path
    it('exercises _frwdRead size>3 path (4×4 lcup=32 scup=4)', () => {
      const data = makeZero(32, 4);
      const result = bd.decodeCodeblock(data, 0, 0, 1, 32, 0, 4, 4);
      expect(result).to.be.instanceOf(Int32Array);
      expect(result.length).to.equal(16);
    });
  });
});
