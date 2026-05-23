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
    // When packet headers are packed into PPM, EPH (if used) lives inside the
    // packed-header bitstream, not inline in the body. We therefore only look
    // for inline EPH when headers are read in-line from the tile-part buffer.
    const useEph = cod.useEphMarker() && !this._pphActive;
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
    } else {
      pos = this._bitPos;
    }

    // Skip EPH (0xFF92, 2 bytes) if present after header bits (inline-headers only).
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
