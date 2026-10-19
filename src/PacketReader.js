//#region PacketTagTrees
/**
 * Fresh-per-packet quad/tag trees for HTJ2K packet headers, mirroring the
 * `tag_tree` structures that OpenJPH re-initialises for every packet parse
 * (ojph_precinct.cpp precinct::parse). Two trees are kept: an inclusion tree
 * (values 0/1) and a missing-MSBs tree (unary counts). Each level of a tree
 * spans ceil(w / 2^level) x ceil(h / 2^level) nodes; level `numLevels` holds
 * the single root node.
 */
class PacketTagTrees {
  /**
   * Creates an instance of PacketTagTrees.
   * @constructor
   * @param {number} w - Codeblock grid width of the precinct portion.
   * @param {number} h - Codeblock grid height of the precinct portion.
   */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.numLevels = 1 + Math.max(PacketTagTrees._log2ceil(w), PacketTagTrees._log2ceil(h));
    // Precompute per-level origins for values and flags (leaf level first).
    this.valueOrigins = [];
    this.flagOrigins = [];
    const levelDims = [];
    let total = 0;
    for (let lev = 0; lev <= this.numLevels; lev++) {
      levelDims.push([Math.ceil(w / Math.pow(2, lev)), Math.ceil(h / Math.pow(2, lev))]);
    }
    // OpenJPH's num_levels includes the root implicitly: level dims shrink
    // until 1x1 at numLevels.
    for (let lev = 0; lev <= this.numLevels; lev++) {
      this.valueOrigins.push(total);
      this.flagOrigins.push(total);
      total += levelDims[lev][0] * levelDims[lev][1];
    }
    this.levelDims = levelDims;
    this.incValues = new Uint8Array(total);
    this.incFlags = new Uint8Array(total);
    this.mmsbValues = new Uint8Array(total);
    this.mmsbFlags = new Uint8Array(total);
  }

  static _log2ceil(v) {
    if (v <= 1) {
      return 0;
    }
    let n = 0;
    let p = 1;
    while (p < v) {
      p *= 2;
      n++;
    }
    return n;
  }

  _index(x, y, lev) {
    const w = this.levelDims[lev][0];
    return this.valueOrigins[lev] + y * w + x;
  }

  incValue(x, y, lev) {
    return this.incValues[this._index(x, y, lev)];
  }

  incFlagged(x, y, lev) {
    return this.incFlags[this._index(x, y, lev)] !== 0;
  }

  setInc(x, y, lev, value, flagged) {
    const i = this._index(x, y, lev);
    this.incValues[i] = value;
    this.incFlags[i] = flagged ? 1 : 0;
  }

  mmsbValue(x, y, lev) {
    return this.mmsbValues[this._index(x, y, lev)];
  }

  mmsbFlagged(x, y, lev) {
    return this.mmsbFlags[this._index(x, y, lev)] !== 0;
  }

  setMmsb(x, y, lev, value, flagged) {
    const i = this._index(x, y, lev);
    this.mmsbValues[i] = value;
    this.mmsbFlags[i] = flagged ? 1 : 0;
  }
}
//#endregion

//#region PacketReader
class PacketReader {
  /**
   * Creates an instance of PacketReader.
   * @constructor
   */
  constructor() {
    // When non-null, packet *header* bits are pulled from this source (typically
    // bytes accumulated from PPM/PPT markers) while packet *body* bytes still come
    // from the main tile-part buffer. The bit-reader state for the pph source must
    // persist across packets within a tile-part (per ISO/IEC 15444-1 B.10).
    this._pphActive = false;
    this._pphBuffer = null;
    this._pphPos = 0;
    this._pphEnd = 0;
    this._pphBitBuf = 0;
    this._pphBitsLeft = 0;
    this._pphSkipMsb = false;
  }

  /**
   * Sets a packed-packet-header (PPM/PPT) source whose bytes will be used for
   * packet header bit-reading until {@link clearPphSource} is called. Body bytes
   * continue to be read from the main tile-part buffer passed to readPacket.
   * @method
   * @param {Uint8Array} buffer - Header byte source.
   * @param {number} pos - Starting position within buffer.
   * @param {number} end - Exclusive end position within buffer.
   */
  setPphSource(buffer, pos, end) {
    this._pphActive = true;
    this._pphBuffer = buffer;
    this._pphPos = pos;
    this._pphEnd = end;
    this._pphBitBuf = 0;
    this._pphBitsLeft = 0;
    this._pphSkipMsb = false;
  }

  /**
   * Clears any previously installed packed-packet-header source.
   * @method
   */
  clearPphSource() {
    this._pphActive = false;
    this._pphBuffer = null;
  }

  /**
   * Returns true when no more packet data is available. When a packed-packet-header
   * source is installed, this also reports exhaustion of that header source — the
   * inline body-buffer pos alone is not a reliable progression signal because
   * empty packets do not advance it.
   * @method
   * @param {number} pos - Current main-buffer position.
   * @param {number} dataEnd - Exclusive end of the main-buffer tile-part data.
   * @returns {boolean} True when no more packets can be read.
   */
  isExhausted(pos, dataEnd) {
    if (pos >= dataEnd) {
      return true;
    }
    if (this._pphActive && this._pphPos >= this._pphEnd) {
      return true;
    }
    return false;
  }

  /**
   * Read one HTJ2K packet header + body.
   * Updates codeblock data (cb.data, cb.missingMSBs, cb.passes, etc.)
   * in the SubBand structures for this resolution / precinct.
   * @method
   * @param {Uint8Array} buffer - Full codestream byte array.
   * @param {number} pos - Current byte position in buffer.
   * @param {number} dataEnd - Exclusive end of tile-part data in buffer.
   * @param {number} layer - Quality layer index (0-based).
   * @param {Object} resolution - Resolution object from tile component.
   * @param {number} precinctIdx - Flat precinct index (py * nPrecinctsWide + px).
   * @param {CodSegment} cod - Coding style segment.
   * @returns {number} New byte position after this packet.
   */
  readPacket(buffer, pos, dataEnd, layer, resolution, precinctIdx, cod) {
    if (pos >= dataEnd) {
      return pos;
    }

    const initialPos = pos;
    const initialPphPos = this._pphActive ? this._pphPos : 0;
    const useSop = cod.useSopMarker();
    // Per Rec. ITU-T T.800 Figure B.10 the EPH marker sits at the end of the
    // packet HEADER. When headers are packed via PPM/PPT, the EPH markers are
    // stored as literal 0xff92 bytes inside the packed-header data (this is
    // what Kakadu writes and what OpenJPEG consumes from ppm_data). SOP
    // markers, in contrast, stay inline in the tile-part body.
    const useEph = cod.useEphMarker();
    const subBands = resolution.subBands;
    const pp = resolution.getPrecinctParameters();
    const numPrecinctsWide = pp.numPrecinctsWide;

    // Skip SOP (0xFF91 + 2-byte length + 2-byte sequence = 6 bytes) if present
    if (useSop && pos + 5 < dataEnd && buffer[pos] === 0xff && buffer[pos + 1] === 0x91) {
      pos += 6;
    }

    // Initialize bit-reader state for packet header parsing. When a packed-header
    // source is active (PPM/PPT), header bits come from there; otherwise from the
    // main tile-part buffer at the current pos.
    if (this._pphActive) {
      this._buffer = this._pphBuffer;
      this._dataEnd = this._pphEnd;
      this._bitPos = this._pphPos;
      this._bitBuf = this._pphBitBuf;
      this._bitsLeft = this._pphBitsLeft;
      this._skipMsb = this._pphSkipMsb;
    } else {
      this._buffer = buffer;
      this._dataEnd = dataEnd;
      this._bitPos = pos;
      this._bitBuf = 0;
      this._bitsLeft = 0;
      this._skipMsb = false;
    }

    // Find precinct by (px, py) coordinates in the subband's precincts array.
    const pxVal = precinctIdx % numPrecinctsWide;
    const pyVal = Math.floor(precinctIdx / numPrecinctsWide);

    // Determine if any subband has codeblocks for this precinct
    let hasNonEmpty = false;
    for (let si = 0; si < subBands.length; si++) {
      const sb = subBands[si];
      if (sb.codeblocks.length === 0) {
        continue;
      }
      const pr = sb.precincts.find((p) => p.px === pxVal && p.py === pyVal);
      if (pr && pr.cbsW > 0 && pr.cbsH > 0) {
        hasNonEmpty = true;
        break;
      }
    }

    // Codeblocks scheduled for body reading (filled during header parse)
    const cbsToRead = [];

    if (!hasNonEmpty) {
      // Resolution has no codeblocks: read the sole 0-bit "empty packet" indicator
      this._readBit();
    } else {
      // Read the empty-packet indicator (first bit of the header)
      const nonEmpty = this._readBit();
      if (nonEmpty) {
        for (let si = 0; si < subBands.length; si++) {
          const sb = subBands[si];
          if (sb.codeblocks.length === 0) {
            continue;
          }
          const precinct = sb.precincts.find((p) => p.px === pxVal && p.py === pyVal);
          if (!precinct || precinct.cbsW === 0 || precinct.cbsH === 0) {
            continue;
          }

          // HTJ2K tag trees are rebuilt FRESH for every packet: inclusion and
          // missing-MSB values never persist across packets (each HT codeblock
          // segment is self-contained). See OpenJPH precinct::parse, which
          // re-initialises the trees inside the per-band loop of every packet.
          const trees = new PacketTagTrees(precinct.cbsW, precinct.cbsH);

          for (let cbLocalY = 0; cbLocalY < precinct.cbsH; cbLocalY++) {
            for (let cbLocalX = 0; cbLocalX < precinct.cbsW; cbLocalX++) {
              const cbGlobalX = precinct.cbOffX + cbLocalX;
              const cbGlobalY = precinct.cbOffY + cbLocalY;
              const cbIdx = cbGlobalY * sb.totalCbsWide + cbGlobalX;
              if (cbIdx < 0 || cbIdx >= sb.codeblocks.length) {
                continue;
              }
              const cb = sb.codeblocks[cbIdx];

              // Inclusion (fresh per-packet tree)
              const included = this._readInclusionHT(cbLocalX, cbLocalY, trees);
              if (!included) {
                continue;
              }

              // Zero bitplanes / missing MSBs — read fresh for every packet
              const missingMSBs = this._readMissingMSBsHT(cbLocalX, cbLocalY, trees);

              // Number of passes (encodes placeholder pass groups for HTJ2K).
              // In HTJ2K each packet's codeblock segment is a self-contained
              // HT block: placeholder passes shift the effective MSB count for
              // THIS packet only — they are not accumulated across packets.
              const numPasses = this._readNumPasses();
              const numPhld = Math.floor((numPasses - 1) / 3);
              cb.missingMSBs = missingMSBs + numPhld;
              const actualPasses = numPasses - numPhld * 3;

              // Lblock: starts at 3 for each packet header occurrence
              let lblock = 3;
              while (this._readBit() === 1) {
                lblock++;
              }
              cb.lblock = lblock;

              // Length 1 (cleanup pass segment)
              const numPhldPasses = numPhld * 3;
              const lenBits1 = cb.lblock + Math.floor(Math.log2(Math.max(numPhldPasses + 1, 1)));
              const len1 = this._readBits(lenBits1);

              // Length 2 (SigProp + MagRef segments if > 1 actual pass)
              let len2 = 0;
              if (actualPasses > 1) {
                const lenBits2 = cb.lblock + (actualPasses > 2 ? 1 : 0);
                len2 = this._readBits(lenBits2);
              }

              cbsToRead.push({ cb, len1, len2, actualPasses });
            }
          }
        }
      }
    }

    // Align bit reader to byte boundary, then advance pos.
    // For in-line headers, header advancement contributes to pos. For PPM/PPT
    // headers, only the pph cursor advances; pos remains where it was so the body
    // bytes are read from the main tile-part buffer.
    this._bitsLeft = 0;
    this._skipMsb = false;
    if (this._pphActive) {
      this._pphPos = this._bitPos;
      this._pphBitBuf = 0;
      this._pphBitsLeft = 0;
      this._pphSkipMsb = false;
      // Consume the literal EPH marker bytes (0xff 0x92) stored at the end of
      // every packet's packed header (ITU-T T.800 Figure B.10 with PPM/PPT).
      if (
        useEph &&
        this._pphPos + 1 < this._pphEnd &&
        this._pphBuffer[this._pphPos] === 0xff &&
        this._pphBuffer[this._pphPos + 1] === 0x92
      ) {
        this._pphPos += 2;
      }
    } else {
      pos = this._bitPos;
      // Skip inline EPH (0xFF92, 2 bytes) if present after header bits.
      if (useEph && pos + 1 < dataEnd && buffer[pos] === 0xff && buffer[pos + 1] === 0x92) {
        pos += 2;
      }
    }

    // Read coded codeblock body bytes (raw — not bit-stuffed)
    for (const { cb, len1, len2, actualPasses } of cbsToRead) {
      const totalBytes = len1 + len2;
      if (totalBytes === 0) {
        continue;
      }
      const end = pos + totalBytes;
      if (end > dataEnd) {
        break;
      } // corrupted / truncated

      const chunk = buffer.slice(pos, end);
      pos = end;

      // HTJ2K codeblock segments are self-contained per packet: successive
      // packets (e.g. additional quality layers) REFINISH the codeblock by
      // replacing the stored segment, not by appending to it.
      cb.data = chunk;
      cb.lengths1 = len1;
      cb.lengths2 = len2;
      cb.passes = actualPasses;
    }

    // No-progress guard: if a packet read produced no advance whatsoever
    // (neither in the main tile-part buffer nor in the pph header buffer) we are
    // about to loop forever in the caller. Surface a clear error instead.
    const advancedMain = pos > initialPos;
    const advancedPph = this._pphActive && this._pphPos > initialPphPos;
    if (!advancedMain && !advancedPph) {
      throw new Error(
        `PacketReader made no progress at position ${initialPos} ` +
          `(layer ${layer}, precinct ${precinctIdx})`
      );
    }

    return pos;
  }

  //#region Private Methods
  /**
   * Reads one bit from the packet-header bit stream (HTJ2K bit stuffing).
   * @method
   * @private
   * @returns {number} The bit value (0 or 1).
   */
  _readBit() {
    if (this._bitsLeft === 0) {
      if (this._bitPos >= this._dataEnd) {
        return 0;
      }
      const byte = this._buffer[this._bitPos++];
      if (this._skipMsb) {
        this._bitBuf = byte & 0x7f;
        this._bitsLeft = 7;
        this._skipMsb = false;
      } else {
        this._bitBuf = byte;
        this._bitsLeft = 8;
        this._skipMsb = byte === 0xff;
      }
    }
    return (this._bitBuf >> --this._bitsLeft) & 1;
  }

  /**
   * Reads n bits from the packet-header bit stream.
   * @method
   * @private
   * @param {number} n - Number of bits to read.
   * @returns {number} The value of the n bits.
   */
  _readBits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | this._readBit();
    }
    return v;
  }

  /**
   * HTJ2K inclusion-tree read (fresh per-packet tree). Descends from the root
   * toward the leaf for codeblock (cx, cy): a node value of 1 means its subtree
   * is entirely not-included; the first "0" bit encountered (not yet read for
   * that node) marks the subtree not-included, while a "1" bit continues the
   * descent. Bit stuffing is handled by {@link _readBit}.
   * Mirrors OpenJPH precinct::parse inclusion walk.
   * @method
   * @private
   * @param {number} cx - Codeblock local x index.
   * @param {number} cy - Codeblock local y index.
   * @param {PacketTagTrees} trees - Fresh per-packet tag trees for the precinct.
   * @returns {boolean} True if codeblock is included in this packet.
   */
  _readInclusionHT(cx, cy, trees) {
    for (let cl = trees.numLevels; cl > 0; cl--) {
      const lev = cl - 1;
      const nx = cx >> lev;
      const ny = cy >> lev;
      if (trees.incValue(nx, ny, lev) === 1) {
        return false;
      }
      if (!trees.incFlagged(nx, ny, lev)) {
        const bit = this._readBit();
        trees.setInc(nx, ny, lev, 1 - bit, true);
        if (bit === 0) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * HTJ2K missing-MSBs (zero bitplane) tree read (fresh per-packet tree).
   * At each level the counter is seeded from the parent node's value; if the
   * current node has not been read yet, unary bits ("1" ends the run) extend
   * the counter and the result is stored in the node. Mirrors OpenJPH
   * precinct::parse missing-msbs walk.
   * @method
   * @private
   * @param {number} cx - Codeblock local x index.
   * @param {number} cy - Codeblock local y index.
   * @param {PacketTagTrees} trees - Fresh per-packet tag trees for the precinct.
   * @returns {number} Missing MSBs count.
   */
  _readMissingMSBsHT(cx, cy, trees) {
    let mmsbs = 0;
    for (let levp1 = trees.numLevels; levp1 > 0; levp1--) {
      const lev = levp1 - 1;
      const nx = cx >> lev;
      const ny = cy >> lev;
      // Parent node (level levp1) seeds the count for the current node.
      mmsbs = trees.mmsbValue(cx >> levp1, cy >> levp1, levp1);
      if (!trees.mmsbFlagged(nx, ny, lev)) {
        let bit = 0;
        while (bit === 0) {
          bit = this._readBit();
          mmsbs += 1 - bit;
        }
        trees.setMmsb(nx, ny, lev, mmsbs, true);
      }
    }
    return mmsbs;
  }

  /**
   * Reads the coding-passes count (ISO 15444-1 B.10.6).
   * @method
   * @private
   * @returns {number} Number of coding passes.
   */
  _readNumPasses() {
    if (!this._readBit()) {
      return 1;
    }
    if (!this._readBit()) {
      return 2;
    }
    let val = (this._readBit() << 1) | this._readBit();
    if (val < 3) {
      return val + 3;
    }
    val = this._readBits(5);
    if (val < 31) {
      return val + 6;
    }
    return this._readBits(7) + 37;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = PacketReader;
//#endregion
