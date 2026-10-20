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

  describe('decodeCodeblock - SPP and MRP passes', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    // Zero cleanup data + zero SPP/MRP data: MEL runs stay -1 → the quad at
    // (row 1, col 1) becomes significant in the MagSgn pass; SPP and MRP
    // then propagate and refine it.
    function makePassData(lengths1, lengths2, scup) {
      const buf = new Uint8Array(lengths1 + lengths2).fill(0);
      buf[lengths1 - 2] = scup & 0x0f;
      buf[lengths1 - 1] = (scup >> 4) & 0xff;
      return buf;
    }

    it('decodes a 4×4 block with two passes', () => {
      const data = makePassData(24, 8, 4);
      const result = bd.decodeCodeblock(data, 0, 10, 2, 24, 8, 4, 4);
      expect(Array.from(result)).to.deep.equal([
        0, 0, 0, 0, 1572864, 0, 0, 0, 0, 0, 1572864, 0, 0, 0, 0, 0,
      ]);
    });

    it('decodes a 4×4 block with three passes', () => {
      const data = makePassData(24, 8, 4);
      const result = bd.decodeCodeblock(data, 0, 10, 3, 24, 8, 4, 4);
      expect(Array.from(result)).to.deep.equal([
        0, 0, 0, 0, 1310720, 0, 0, 0, 0, 0, 1310720, 0, 0, 0, 0, 0,
      ]);
    });

    it('decodes a 6×6 block with three passes and stripe-causal context', () => {
      const data = makePassData(24, 8, 4);
      const result = bd.decodeCodeblock(data, 0, 4, 3, 24, 8, 6, 6, true);
      // Sign coefficients land at flat indices 6, 10, 24, 26 and 28.
      const expected = new Array(36).fill(0);
      for (const idx of [6, 10, 24, 26, 28]) expected[idx] = 83886080;
      expect(Array.from(result)).to.deep.equal(expected);
    });

    it('clamps pass counts out of range', () => {
      // numPasses > 3 clamps to 3 (same result as the three-pass decode)...
      const data = makePassData(24, 8, 4);
      const five = bd.decodeCodeblock(data, 0, 10, 5, 24, 8, 4, 4);
      const three = bd.decodeCodeblock(data, 0, 10, 3, 24, 8, 4, 4);
      expect(Array.from(five)).to.deep.equal(Array.from(three));
      // ...and numPasses > 1 with lengths2 === 0 clamps to 1.
      const one = bd.decodeCodeblock(makeZero(24, 4), 0, 10, 2, 24, 0, 4, 4);
      const single = bd.decodeCodeblock(makeZero(24, 4), 0, 10, 1, 24, 0, 4, 4);
      expect(Array.from(one)).to.deep.equal(Array.from(single));
      // missingMSBs === 29 with extra passes also clamps to a single pass.
      const d2 = makePassData(24, 8, 4);
      const prec = bd.decodeCodeblock(d2, 0, 29, 2, 24, 8, 4, 4);
      const precOne = bd.decodeCodeblock(d2, 0, 29, 1, 24, 8, 4, 4);
      expect(Array.from(prec)).to.deep.equal(Array.from(precOne));
    });

    // 8×8 block: MEL region (5 trailing bytes) decodes the run pattern
    // 0,0,0,3,1,1,... producing sign segments for a full cleanup pass.
    function makeMultiRun(lengths2) {
      const b = new Uint8Array(16 + lengths2).fill(0);
      b[10] = 0xe8;
      b[14] = 5; // scup low nibble
      b[15] = 0; // scup high bits → scup = 5
      return b;
    }

    it('decodes an 8×8 block exercising multi-run MEL cleanup', () => {
      const words = Array.from(bd.decodeCodeblock(makeMultiRun(8), 0, 10, 1, 16, 8, 8, 8));
      const nonzero = words.filter((x) => x !== 0);
      expect(nonzero.length).to.be.greaterThan(0);
      for (const w of nonzero) expect(w).to.equal(0x180000);
    });

    it('refines the 8×8 multi-run block on pass three', () => {
      const words1 = Array.from(bd.decodeCodeblock(makeMultiRun(8), 0, 10, 1, 16, 8, 8, 8));
      const words3 = Array.from(bd.decodeCodeblock(makeMultiRun(8), 0, 10, 3, 16, 8, 8, 8));
      // Pass three adds refinement bits: every nonzero word must change value.
      const nz = words1.map((w, i) => [w, i]).filter(([w]) => w !== 0);
      expect(nz.length).to.be.greaterThan(0);
      for (const [, i] of nz) {
        expect(words3[i]).to.not.equal(words1[i]);
        expect(words3[i]).to.be.at.least(0);
      }
    });
  });

  describe('_maskBits', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('returns 0 for non-positive widths', () => {
      expect(bd._maskBits(0)).to.equal(0);
      expect(bd._maskBits(-3)).to.equal(0);
    });

    it('returns a full 32-bit mask for widths >= 32', () => {
      expect(bd._maskBits(32)).to.equal(0xffffffff);
      expect(bd._maskBits(40)).to.equal(0xffffffff);
    });

    it('returns (1 << bits) - 1 for widths 1..31', () => {
      expect(bd._maskBits(1)).to.equal(0x1);
      expect(bd._maskBits(5)).to.equal(0x1f);
      expect(bd._maskBits(31)).to.equal(0x7fffffff);
    });
  });

  describe('_shiftStateLeft / _shiftStateRight', () => {
    let bd;
    const state = () => ({ tmpHi: 0xdeadbeef, tmpLo: 0x12345678 });

    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('_shiftStateLeft ignores non-positive shifts', () => {
      const st = state();
      bd._shiftStateLeft(st, 0);
      expect(st.tmpHi).to.equal(0xdeadbeef);
      expect(st.tmpLo).to.equal(0x12345678);
    });

    it('_shiftStateLeft clears the buffer for shifts >= 64', () => {
      const st = state();
      bd._shiftStateLeft(st, 64);
      expect(st.tmpHi).to.equal(0);
      expect(st.tmpLo).to.equal(0);
    });

    it('_shiftStateLeft moves lo into hi for shifts in [32, 64)', () => {
      const st = state();
      bd._shiftStateLeft(st, 36);
      expect(st.tmpHi).to.equal((0x12345678 << 4) >>> 0);
      expect(st.tmpLo).to.equal(0);
    });

    it('_shiftStateLeft splices across the 32-bit boundary for small shifts', () => {
      const st = { tmpHi: 0xffffffff, tmpLo: 0xf0000000 };
      bd._shiftStateLeft(st, 4);
      expect(st.tmpHi).to.equal(0xffffffff);
      expect(st.tmpLo).to.equal(0x00000000);
    });

    it('_shiftStateRight ignores non-positive shifts', () => {
      const st = state();
      bd._shiftStateRight(st, -1);
      expect(st.tmpHi).to.equal(0xdeadbeef);
      expect(st.tmpLo).to.equal(0x12345678);
    });

    it('_shiftStateRight clears the buffer for shifts >= 64', () => {
      const st = state();
      bd._shiftStateRight(st, 100);
      expect(st.tmpHi).to.equal(0);
      expect(st.tmpLo).to.equal(0);
    });

    it('_shiftStateRight moves hi into lo for shifts in [32, 64)', () => {
      const st = state();
      bd._shiftStateRight(st, 36);
      expect(st.tmpLo).to.equal(0xdeadbeef >>> 4);
      expect(st.tmpHi).to.equal(0);
    });

    it('_shiftStateRight splices across the 32-bit boundary for small shifts', () => {
      const st = { tmpHi: 0x0000000f, tmpLo: 0x80000000 };
      bd._shiftStateRight(st, 4);
      expect(st.tmpLo).to.equal(0xf8000000);
      expect(st.tmpHi).to.equal(0);
    });
  });

  describe('_orWordAt / append+peek helpers', () => {
    let bd;
    const state = () => ({ tmpHi: 0, tmpLo: 0, bits: 0 });

    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('_orWordAt is a no-op for zero values', () => {
      const st = state();
      bd._orWordAt(st, 0, 4);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal(0);
    });

    it('_orWordAt merges words fully inside the low word', () => {
      const st = state();
      bd._orWordAt(st, 0xff, 8);
      expect(st.tmpLo).to.equal(0xff00);
      expect(st.tmpHi).to.equal(0);
    });

    it('_orWordAt spills into the high word at shifts > 0 and < 32', () => {
      const st = state();
      bd._orWordAt(st, 0xdeadbeef, 16);
      expect(st.tmpLo).to.equal(0xbeef0000);
      expect(st.tmpHi).to.equal(0x0000dead);
    });

    it('_orWordAt merges directly into the high word at shift 32', () => {
      const st = state();
      bd._orWordAt(st, 0x12345678, 32);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal(0x12345678);
    });

    it('_orWordAt shifts within the high word for shifts > 32', () => {
      const st = state();
      bd._orWordAt(st, 0xdeadbeef, 36);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal((0xdeadbeef << 4) >>> 0);
    });

    it('_appendBottomBits accumulates at the low end', () => {
      const st = state();
      bd._appendBottomBits(st, 0xab, 8);
      bd._appendBottomBits(st, 0xcd, 8);
      expect(st.bits).to.equal(16);
      expect(st.tmpLo).to.equal(0xcdab);
    });

    it('_appendTopBits accumulates at the high end', () => {
      const st = state();
      bd._appendTopBits(st, 0xab, 8);
      bd._appendTopBits(st, 0xcd, 8);
      expect(st.bits).to.equal(16);
      // Bytes land at the top of the 64-bit window: ab in bits [63:56], cd in [55:48].
      expect(st.tmpHi).to.equal(0xabcd0000);
      expect(st.tmpLo).to.equal(0);
    });

    it('_peekTopBits returns 0 for non-positive widths', () => {
      const st = state();
      bd._appendTopBits(st, 0xff, 8);
      expect(bd._peekTopBits(st, 0, 0)).to.equal(0);
    });

    it('_peekTopBits extracts fields below the 64-bit top', () => {
      const st = state();
      bd._appendTopBits(st, 0xa5, 8); // bits land at [63:56]
      expect(bd._peekTopBits(st, 0, 4)).to.equal(0xa);
      expect(bd._peekTopBits(st, 4, 4)).to.equal(0x5);
    });

    it('_peekTopBits reads a field starting exactly at bit 32', () => {
      const st = { tmpHi: 0x12345678, tmpLo: 0x9abcdef0, bits: 64 };
      expect(bd._peekTopBits(st, 0, 32)).to.equal(0x12345678);
    });

    it('_peekTopBits reads a field ending exactly at bit 32', () => {
      const st = { tmpHi: 0x12345678, tmpLo: 0x9abcdef0, bits: 64 };
      expect(bd._peekTopBits(st, 32, 32) >>> 0).to.equal(0x9abcdef0);
    });

    it('_peekTopBits splices across the 32-bit boundary', () => {
      // Window content (MSB-first) is 0x00000001_80000000: bit 31 (counted
      // from the top) is the last bit of tmpHi, followed by tmpLo's bits.
      const st = { tmpHi: 0x00000001, tmpLo: 0x80000000, bits: 64 };
      expect(bd._peekTopBits(st, 31, 1)).to.equal(1);
      expect(bd._peekTopBits(st, 31, 2)).to.equal(3);
      expect(bd._peekTopBits(st, 32, 1)).to.equal(1);
    });
  });

  describe('MEL reader', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('decodes zero-runs from an all-ones stream', () => {
      const data = new Uint8Array(64).fill(0xff);
      const st = bd._melInit(data, 0, 16, 10);
      expect(st.bits).to.equal(15);
      expect(st.size).to.equal(7);
      expect(st.pos).to.equal(8);
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push(bd._melGetRun(st));
      expect(runs).to.deep.equal([0, 0, 0, 2, 2]);
      expect(st.k).to.equal(8);
    });

    it('decodes unit runs from an all-zeros stream', () => {
      const data = new Uint8Array(64).fill(0);
      const st = bd._melInit(data, 0, 16, 10);
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push(bd._melGetRun(st));
      expect(runs).to.deep.equal([1, 1, 1, 1, 1]);
      expect(st.k).to.equal(0);
    });

    it('decodes a crafted variable-length run pattern', () => {
      const data = new Uint8Array(32).fill(0);
      data[11] = 0xe8; // first aligned MEL byte after _melInit alignment
      const st = bd._melInit(data, 0, 16, 5);
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push(bd._melGetRun(st));
      expect(runs).to.deep.equal([0, 0, 0, 3, 1]);
      expect(st.k).to.equal(0);
    });

    it('saturates the MEL state index at 12 on long zero streams', () => {
      const data = new Uint8Array(64).fill(0xff);
      const st = bd._melInit(data, 0, 32, 20);
      const runs = [];
      for (let i = 0; i < 14; i++) runs.push(bd._melGetRun(st));
      expect(runs).to.deep.equal([0, 0, 0, 2, 2, 2, 6, 6, 6, 14, 14, 30, 62, 62]);
      expect(st.k).to.equal(12);
    });

    it('_melGetRun returns 0 once the stream is exhausted', () => {
      const data = new Uint8Array(8).fill(0);
      const st = bd._melInit(data, 0, 4, 3);
      // Drain whatever the padded stream can produce, then keep pulling.
      let guard = 0;
      while (bd._melGetRun(st) !== 0 && guard++ < 1000) {
        /* drain */
      }
      expect(guard).to.be.below(1000);
      expect(bd._melGetRun(st)).to.equal(0);
    });
  });

  describe('REV (reverse VLC) reader', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('unpacks the nibble and appended bytes little-endian', () => {
      const data = Uint8Array.from([0x80, 0x10, 0x02, 0x08, 0x90, 0x20, 0x11, 0x00, 0x00, 0x00]);
      const st = bd._revInit(data, 0, 8, 6);
      expect(st.pos).to.equal(1);
      expect(st.size).to.equal(0);
      expect(st.bits).to.equal(60);
      expect(st.tmpLo).to.equal(0x20890201);
      expect(st.tmpHi).to.equal(0);
      expect(st.unstuff).to.be.false;
      expect(bd._revFetch(st)).to.equal(0x20890201);
    });

    it('applies 7-bit unstuffing after a byte greater than 0x8f', () => {
      const data = Uint8Array.from([0x00, 0x01, 0x7f, 0xff, 0x31]);
      const st = bd._revInit(data, 0, 5, 5);
      expect(st.pos).to.equal(-1);
      expect(st.size).to.equal(0);
      expect(st.bits).to.equal(58);
      expect(st.tmpLo).to.equal(0x7ff);
      expect(bd._revFetch(st)).to.equal(0x7ff);
    });

    it('_revAdvance shifts by small, medium and full widths', () => {
      const data = Uint8Array.from([0x80, 0x10, 0x02, 0x08, 0x90, 0x20, 0x11, 0x00]);
      const st = bd._revInit(data, 0, 8, 6);
      const base = 0x20890201;
      let next = bd._revAdvance(st, 4);
      expect(next).to.equal((base >>> 4) >>> 0);
      expect(st.tmpHi).to.equal(0);
      next = bd._revAdvance(st, 36);
      expect(next).to.equal(0);
      expect(st.tmpHi).to.equal(0);
      next = bd._revAdvance(st, 70);
      expect(next).to.equal(0);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal(0);
    });

    it('_revFetch refills via _revRead when the buffer runs low', () => {
      // A clean segment (bytes <= 0x8f) exercises the _revRead fast path
      // after advancing past the initial window.
      const data = Uint8Array.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x01, 0x02, 0x00, 0x00, 0x02,
      ]);
      const st = bd._revInit(data, 0, 12, 2);
      bd._revAdvance(st, 40);
      const word = bd._revFetch(st);
      expect(word).to.be.at.least(0);
      expect(st.bits).to.be.at.least(32);
    });

    it('handles a segment containing only the final scup bytes', () => {
      const data = Uint8Array.from([0x33, 0x22, 0x00, 0x00, 0x22]);
      const st = bd._revInit(data, 0, 4, 2);
      expect(st.pos).to.equal(1);
      expect(st.size).to.equal(0);
      expect(st.bits).to.equal(36);
      expect(st.tmpLo).to.equal(0);
      expect(bd._revFetch(st)).to.equal(0);
    });
  });

  describe('FRWD (forward VLC) reader', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('loads bytes little-endian from the segment start', () => {
      const data = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55]);
      const st = bd._frwdInit(data, 0, 5, 0);
      expect(st.pos).to.equal(5);
      expect(st.bits).to.equal(64);
      expect(st.tmpLo).to.equal(0x44332211);
      expect(st.tmpHi).to.equal(0x55);
      expect(bd._frwdFetch(st)).to.equal(0x44332211);
    });

    it('applies 7-bit unstuffing after 0xff bytes', () => {
      const data = Uint8Array.from([0xff, 0x00, 0x33, 0x44]);
      const st = bd._frwdInit(data, 0, 4, 0);
      expect(st.bits).to.equal(63);
      expect(st.tmpLo).to.equal(0x221980ff);
      expect(bd._frwdFetch(st)).to.equal(0x221980ff);
    });

    it('pads with the fill byte once the segment is exhausted', () => {
      const data = Uint8Array.from([0x11]);
      const st = bd._frwdInit(data, 0, 1, 0xff);
      expect(st.bits).to.equal(58);
      expect(st.tmpLo).to.equal(0xffffff11);
      expect(bd._frwdFetch(st)).to.equal(0xffffff11);
    });

    it('_frwdAdvance shifts by small, medium and full widths', () => {
      const data = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55]);
      const st = bd._frwdInit(data, 0, 5, 0);
      bd._frwdAdvance(st, 8);
      expect(st.tmpLo).to.equal(0x55443322);
      expect(st.tmpHi).to.equal(0);
      bd._frwdAdvance(st, 24);
      expect(st.tmpLo).to.equal(0x55);
      expect(st.tmpHi).to.equal(0);
      bd._frwdAdvance(st, 60);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal(0);
      expect(st.bits).to.equal(64 - 8 - 24 - 60);
    });

    it('_frwdFetch refills via _frwdRead when the buffer runs low', () => {
      // Clean bytes (no 0xff) exercise the _frwdRead fast path.
      const data = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x01]);
      const st = bd._frwdInit(data, 0, 8, 0);
      bd._frwdAdvance(st, 40);
      const word = bd._frwdFetch(st);
      expect(word).to.be.at.least(0);
      expect(st.bits).to.be.at.least(32);
    });

    it('supports the explicit-state variants used by SPP', () => {
      const st = {
        data: null,
        pos: 0,
        tmpHi: 0,
        tmpLo: 0,
        bits: 0,
        size: 0,
        unstuff: 0,
        fillByte: 0,
      };
      const data = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55]);
      bd._frwdInit2(st, data, 0, 5, 0);
      expect(st.tmpLo).to.equal(0x44332211);
      expect(bd._frwdFetch2(st)).to.equal(0x44332211);
      bd._frwdAdvance2(st, 8);
      expect(st.tmpLo).to.equal(0x55443322);
      bd._frwdAdvance2(st, 40);
      expect(st.tmpLo).to.equal(0);
      bd._frwdAdvance2(st, 70);
      expect(st.tmpHi).to.equal(0);
      expect(st.tmpLo).to.equal(0);
    });
  });

  describe('MRP (magnitude refinement) reader', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('loads a uniform stream backwards into both buffer words', () => {
      const data = new Uint8Array(8).fill(0x11);
      const st = bd._mrpInit(data, 0, 0, 8);
      expect(st.bits).to.equal(64);
      expect(st.tmpLo).to.equal(0x11111111);
      expect(st.tmpHi).to.equal(0x11111111);
      expect(bd._mrpFetch(st)).to.equal(0x11111111);
    });

    it('applies 7-bit unstuffing after bytes greater than 0x8f', () => {
      const data = Uint8Array.from([0x01, 0x7f, 0x9f, 0x02, 0x41]);
      const st = bd._mrpInit(data, 0, 0, 5);
      expect(st.bits).to.equal(63);
      expect(st.tmpLo).to.equal(0xff9f0241);
      expect(bd._mrpFetch(st)).to.equal(0xff9f0241);
    });

    it('_mrpAdvance shifts by small, medium and full widths', () => {
      const data = new Uint8Array(8).fill(0x11);
      const st = bd._mrpInit(data, 0, 0, 8);
      bd._mrpAdvance(st, 8);
      expect(st.tmpLo).to.equal(0x11111111);
      expect(st.tmpHi).to.equal(0x111111);
      bd._mrpAdvance(st, 40);
      expect(st.tmpLo).to.equal(0x1111);
      expect(st.tmpHi).to.equal(0);
      bd._mrpAdvance(st, 70);
      expect(st.tmpLo).to.equal(0);
      expect(st.tmpHi).to.equal(0);
      expect(st.bits).to.equal(64 - 8 - 40 - 70);
    });

    it('_mrpFetch refills via _mrpRead when the buffer runs low', () => {
      const data = new Uint8Array(16).fill(0x11);
      const st = bd._mrpInit(data, 0, 0, 16);
      bd._mrpAdvance(st, 40);
      const word = bd._mrpFetch(st);
      expect(word).to.be.at.least(0);
      expect(st.bits).to.be.at.least(32);
    });
  });

  describe('_popCount32', () => {
    let bd;
    beforeEach(() => {
      bd = new BlockDecoder();
    });

    it('counts bits over the full 32-bit range', () => {
      expect(bd._popCount32(0)).to.equal(0);
      expect(bd._popCount32(1)).to.equal(1);
      expect(bd._popCount32(0x0f0f0f0f)).to.equal(16);
      expect(bd._popCount32(0xffffffff)).to.equal(32);
    });
  });
});
