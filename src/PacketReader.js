//#region PacketReader
class PacketReader {
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

    const useSop = cod.useSopMarker();
    const useEph = cod.useEphMarker();
    const subBands = resolution.subBands;
    const pp = resolution.getPrecinctParameters();
    const numPrecinctsWide = pp.numPrecinctsWide;

    // Skip SOP (0xFF91 + 2-byte length + 2-byte sequence = 6 bytes) if present
    if (useSop && pos + 5 < dataEnd && buffer[pos] === 0xff && buffer[pos + 1] === 0x91) {
      pos += 6;
    }

    // Initialize bit-reader state for packet header parsing
    this._buffer = buffer;
    this._dataEnd = dataEnd;
    this._bitPos = pos;
    this._bitBuf = 0;
    this._bitsLeft = 0;
    this._skipMsb = false;

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

          for (let cbLocalY = 0; cbLocalY < precinct.cbsH; cbLocalY++) {
            for (let cbLocalX = 0; cbLocalX < precinct.cbsW; cbLocalX++) {
              const cbGlobalX = precinct.cbOffX + cbLocalX;
              const cbGlobalY = precinct.cbOffY + cbLocalY;
              const cbIdx = cbGlobalY * sb.totalCbsWide + cbGlobalX;
              if (cbIdx < 0 || cbIdx >= sb.codeblocks.length) {
                continue;
              }
              const cb = sb.codeblocks[cbIdx];

              // Inclusion
              const included = this._readInclusionBit(
                cbLocalX,
                cbLocalY,
                layer,
                precinct.inclusionTree
              );
              if (!included) {
                continue;
              }

              // Zero bitplanes — only on first inclusion
              const cbLocalIdx = cbLocalY * precinct.cbsW + cbLocalX;
              if (!precinct.included[cbLocalIdx]) {
                cb.missingMSBs = this._readZeroBitplanes(cbLocalX, cbLocalY, precinct.zeroBitTree);
                precinct.included[cbLocalIdx] = 1;
              }

              // Number of passes (encodes placeholder pass groups for HTJ2K)
              const numPasses = this._readNumPasses();
              const numPhld = Math.floor((numPasses - 1) / 3);
              cb.missingMSBs = (cb.missingMSBs || 0) + numPhld;
              const actualPasses = numPasses - numPhld * 3;

              // Lblock: starts at 3, cumulative across layers per codeblock
              if (cb.lblock === undefined) {
                cb.lblock = 3;
              }
              while (this._readBit() === 1) {
                cb.lblock++;
              }

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

    // Align bit reader to byte boundary, then advance pos
    this._bitsLeft = 0;
    this._skipMsb = false;
    pos = this._bitPos;

    // Skip EPH (0xFF92, 2 bytes) if present after header bits
    if (useEph && pos + 1 < dataEnd && buffer[pos] === 0xff && buffer[pos + 1] === 0x92) {
      pos += 2;
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

      if (!cb.data) {
        cb.data = chunk;
        cb.lengths1 = len1;
        cb.lengths2 = len2;
        cb.passes = actualPasses;
      } else {
        // Multi-layer: concatenate
        const merged = new Uint8Array(cb.data.length + totalBytes);
        merged.set(cb.data);
        merged.set(chunk, cb.data.length);
        cb.data = merged;
        // Keep the original cleanup-pass length; update refinement length
        cb.lengths2 = len2;
        cb.passes += actualPasses;
      }
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
   * Inclusion-tree read: navigates from ROOT toward LEAF for codeblock (cx, cy).
   * Returns true if codeblock is included in this layer.
   * @method
   * @private
   * @param {number} cx - Codeblock local x index.
   * @param {number} cy - Codeblock local y index.
   * @param {number} layerIdx - Quality layer index.
   * @param {InclusionTree} incTree - Inclusion tag tree.
   * @returns {boolean} True if codeblock is included.
   */
  _readInclusionBit(cx, cy, layerIdx, incTree) {
    incTree.reset(cx, cy, layerIdx);
    for (;;) {
      if (incTree.isAboveThreshold()) {
        return false;
      }
      if (!incTree.isKnown()) {
        if (this._readBit() === 0) {
          incTree.incrementValue();
          return false;
        }
        incTree.setKnown();
      }
      if (incTree.isLeaf()) {
        return true;
      }
      incTree.nextLevel();
    }
  }

  /**
   * Zero-bitplane tag-tree read: returns missing-MSBs count for codeblock (cx, cy).
   * @method
   * @private
   * @param {number} cx - Codeblock local x index.
   * @param {number} cy - Codeblock local y index.
   * @param {TagTree} zeroTree - Zero-bitplane tag tree.
   * @returns {number} Missing MSBs count.
   */
  _readZeroBitplanes(cx, cy, zeroTree) {
    zeroTree.reset(cx, cy);
    while (zeroTree.value === undefined) {
      if (this._readBit() === 0) {
        zeroTree.incrementValue();
      } else {
        zeroTree.nextLevel();
      }
    }
    return zeroTree.value;
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
