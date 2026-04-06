const PacketReader = require('./../src/PacketReader');
const { InclusionTree, TagTree } = require('./../src/Tree');

const chai = require('chai');
const expect = chai.expect;

function makeCod({ useSop = false, useEph = false } = {}) {
  return { useSopMarker: () => useSop, useEphMarker: () => useEph };
}

function makeEmptyResolution() {
  return {
    subBands: [],
    getPrecinctParameters: () => ({ numPrecinctsWide: 1 }),
  };
}

function makeResolutionWithEmptySb() {
  return {
    subBands: [{ codeblocks: [], precincts: [] }],
    getPrecinctParameters: () => ({ numPrecinctsWide: 1 }),
  };
}

// Builds a resolution containing one subband with one 2×2 codeblock in
// precinct (0,0).  The returned object also exposes the raw `cb` so tests
// can assert its state after readPacket().
function makeResolutionWithCb() {
  const cb = { cbx0: 0, cbx1: 2, cby0: 0, cby1: 2 };
  const precinct = {
    px: 0,
    py: 0,
    cbsW: 1,
    cbsH: 1,
    cbOffX: 0,
    cbOffY: 0,
    included: [0],
    inclusionTree: new InclusionTree(1, 1),
    zeroBitTree: new TagTree(1, 1),
  };
  const sb = { codeblocks: [cb], totalCbsWide: 1, precincts: [precinct] };
  return {
    subBands: [sb],
    getPrecinctParameters: () => ({ numPrecinctsWide: 1, numPrecinctsHigh: 1, numPrecincts: 1 }),
    cb,
  };
}

// Sets up the bit-reader state on an existing PacketReader instance directly
// so that _readBit / _readBits / _readNumPasses can be exercised in isolation.
function initBitReader(pr, bytes) {
  pr._buffer = new Uint8Array(bytes);
  pr._dataEnd = bytes.length;
  pr._bitPos = 0;
  pr._bitBuf = 0;
  pr._bitsLeft = 0;
  pr._skipMsb = false;
}

describe('PacketReader', () => {
  describe('constructor', () => {
    it('creates an instance of PacketReader', () => {
      const pr = new PacketReader();
      expect(pr).to.be.instanceOf(PacketReader);
    });
  });

  describe('readPacket - guard conditions', () => {
    it('returns pos unchanged when pos equals dataEnd', () => {
      const pr = new PacketReader();
      const buf = new Uint8Array(4);
      const result = pr.readPacket(buf, 4, 4, 0, makeEmptyResolution(), 0, makeCod());
      expect(result).to.equal(4);
    });

    it('returns pos unchanged when pos exceeds dataEnd', () => {
      const pr = new PacketReader();
      const buf = new Uint8Array(4);
      const result = pr.readPacket(buf, 10, 4, 0, makeEmptyResolution(), 0, makeCod());
      expect(result).to.equal(10);
    });
  });

  describe('readPacket - empty resolution', () => {
    it('advances pos by one byte for a resolution with no subBands', () => {
      const pr = new PacketReader();
      // 0x00 → first bit = 0 (empty-packet indicator)
      const buf = new Uint8Array([0x00]);
      const result = pr.readPacket(buf, 0, 1, 0, makeEmptyResolution(), 0, makeCod());
      expect(result).to.equal(1);
    });

    it('advances pos by one byte when all subBand codeblocks are empty', () => {
      const pr = new PacketReader();
      const buf = new Uint8Array([0x00]);
      const result = pr.readPacket(buf, 0, 1, 0, makeResolutionWithEmptySb(), 0, makeCod());
      expect(result).to.equal(1);
    });
  });

  describe('readPacket - marker handling', () => {
    it('skips the 6-byte SOP marker when useSop is true', () => {
      const pr = new PacketReader();
      // Bytes 0–5: SOP (0xff 0x91 + 4 padding),  byte 6: empty-packet byte
      const buf = new Uint8Array([0xff, 0x91, 0x00, 0x02, 0x00, 0x00, 0x00]);
      const result = pr.readPacket(
        buf,
        0,
        7,
        0,
        makeEmptyResolution(),
        0,
        makeCod({ useSop: true })
      );
      expect(result).to.equal(7);
    });

    it('skips the 2-byte EPH marker when useEph is true', () => {
      const pr = new PacketReader();
      // Byte 0: empty-packet bit (0x00),  bytes 1–2: EPH (0xff 0x92)
      const buf = new Uint8Array([0x00, 0xff, 0x92]);
      const result = pr.readPacket(
        buf,
        0,
        3,
        0,
        makeEmptyResolution(),
        0,
        makeCod({ useEph: true })
      );
      expect(result).to.equal(3);
    });
  });

  describe('readPacket - codeblock data', () => {
    // Packet layout for layer 0 with one 2×2 codeblock in precinct (0,0):
    //
    //   Bit  0: nonEmpty         = 1
    //   Bit  1: inclusion(0,0,0) = 1  → leaf immediately → included
    //   Bit  2: zeroBitplane     = 1  → nextLevel → value=0 → missingMSBs=0
    //   Bit  3: numPasses bit    = 0  → 1 pass
    //   Bit  4: lblock extension = 0  → lblock stays 3
    //   Bits 5–7: len1           = 1,0,0 = 4
    //
    //   Header byte: 1 1 1 0 0 1 0 0 = 0xE4
    //   Body: 4 bytes [0x11, 0x22, 0x33, 0x44]
    it('writes cb.data, lengths1, lengths2 and passes on first inclusion', () => {
      const pr = new PacketReader();
      const res = makeResolutionWithCb();
      const buf = new Uint8Array([0xe4, 0x11, 0x22, 0x33, 0x44]);
      const result = pr.readPacket(buf, 0, 5, 0, res, 0, makeCod());

      expect(result).to.equal(5);
      expect(res.cb.missingMSBs).to.equal(0);
      expect(res.cb.lblock).to.equal(3);
      expect(res.cb.passes).to.equal(1);
      expect(res.cb.lengths1).to.equal(4);
      expect(res.cb.lengths2).to.equal(0);
      expect(Array.from(res.cb.data)).to.deep.equal([0x11, 0x22, 0x33, 0x44]);
    });

    // Packet layout for layer 1, same codeblock (already known / included):
    //
    //   Bit  0: nonEmpty         = 1
    //   (inclusion: status already set → no bits read)
    //   (zeroBitplanes: already included → no bits read)
    //   Bit  1: numPasses bit    = 0  → 1 pass
    //   Bit  2: lblock extension = 0  → lblock stays 3
    //   Bits 3–5: len1           = 0,1,1 = 3
    //   Bits 6–7: padding        = 0,0
    //
    //   Header byte: 1 0 0 0 1 1 0 0 = 0x8C
    //   Body: 3 bytes [0xAA, 0xBB, 0xCC]
    it('concatenates cb.data and accumulates passes on second inclusion', () => {
      const pr = new PacketReader();
      const res = makeResolutionWithCb();

      // Layer 0
      pr.readPacket(new Uint8Array([0xe4, 0x11, 0x22, 0x33, 0x44]), 0, 5, 0, res, 0, makeCod());

      // Layer 1
      const result = pr.readPacket(
        new Uint8Array([0x8c, 0xaa, 0xbb, 0xcc]),
        0,
        4,
        1,
        res,
        0,
        makeCod()
      );

      expect(result).to.equal(4);
      expect(res.cb.passes).to.equal(2);
      expect(res.cb.lengths2).to.equal(0);
      expect(Array.from(res.cb.data)).to.deep.equal([0x11, 0x22, 0x33, 0x44, 0xaa, 0xbb, 0xcc]);
    });
  });

  describe('_readBit', () => {
    it('reads 8 bits MSB-first from a single byte', () => {
      const pr = new PacketReader();
      // 0xA5 = 1010 0101
      initBitReader(pr, [0xa5]);
      const bits = Array.from({ length: 8 }, () => pr._readBit());
      expect(bits).to.deep.equal([1, 0, 1, 0, 0, 1, 0, 1]);
    });

    it('returns 0 when reading past end of data', () => {
      const pr = new PacketReader();
      initBitReader(pr, []);
      expect(pr._readBit()).to.equal(0);
    });

    it('applies bit stuffing after a 0xFF byte (MSB of next byte is skipped)', () => {
      const pr = new PacketReader();
      // 0xFF sets skipMsb; next byte 0xFE = 1111 1110 becomes 111 1110 (7 bits, MSB stripped)
      initBitReader(pr, [0xff, 0xfe]);
      // First 8 bits from 0xFF: all ones
      const from0xff = Array.from({ length: 8 }, () => pr._readBit());
      expect(from0xff).to.deep.equal([1, 1, 1, 1, 1, 1, 1, 1]);
      // Next 7 bits from 0xFE with MSB stripped: 1,1,1,1,1,1,0
      const from0xfe = Array.from({ length: 7 }, () => pr._readBit());
      expect(from0xfe).to.deep.equal([1, 1, 1, 1, 1, 1, 0]);
    });
  });

  describe('_readBits', () => {
    it('reads n bits and reconstructs the value correctly', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0xa5]); // 10100101 → value 165 over 8 bits
      expect(pr._readBits(8)).to.equal(0xa5);
    });

    it('returns 0 for n equal to 0', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0xff]);
      expect(pr._readBits(0)).to.equal(0);
    });
  });

  describe('_readNumPasses', () => {
    it('returns 1 when first bit is 0', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0x00]); // 0...
      expect(pr._readNumPasses()).to.equal(1);
    });

    it('returns 2 when bits are 10', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0x80]); // 10 000000
      expect(pr._readNumPasses()).to.equal(2);
    });

    it('returns 3 when bits are 1100', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0xc0]); // 1100 0000  val=00 → 0+3=3
      expect(pr._readNumPasses()).to.equal(3);
    });

    it('returns 4 when bits are 1101', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0xd0]); // 1101 0000  val=01 → 1+3=4
      expect(pr._readNumPasses()).to.equal(4);
    });

    it('returns 5 when bits are 1110', () => {
      const pr = new PacketReader();
      initBitReader(pr, [0xe0]); // 1110 0000  val=10 → 2+3=5
      expect(pr._readNumPasses()).to.equal(5);
    });

    it('returns 6 when bits represent val=3 and readBits(5)=0', () => {
      const pr = new PacketReader();
      // 0xF0 = 1111 0000  → first two bits 11, val=11=3 (not <3), readBits(5) reads
      // bits 4–7 from 0xF0 (0,0,0,0) and bit 0 from 0x00 (0) = 0b00000 = 0 < 31 → 0+6=6
      initBitReader(pr, [0xf0, 0x00]);
      expect(pr._readNumPasses()).to.equal(6);
    });
  });
});
