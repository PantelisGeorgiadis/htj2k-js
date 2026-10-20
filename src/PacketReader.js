const { TgtTree } = require('./Tree');

//#region PacketReader
/**
 * HTJ2K packet reader implementing the full multi-layer packet semantics of
 * ITU-T T.800 B.10 as realized by OpenJPEG's opj_t2_read_packet_header /
 * opj_t2_read_packet_data (t2.c): persistent inclusion / missing-MSB
 * tag-trees, per-codeblock segment accumulation across quality layers and
 * tile-parts, and chunked codeblock data gathering.
 *
 * All packet state is persistent within a tile; {@link resetState} must be
 * called before decoding a new tile.
 */
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

    // Persistent per-tile packet state, keyed by
    // `${compIdx}-${resoIdx}-${precinctIdx}-${subBandType}`.
    this._state = new Map();
  }

  /**
   * Clears all per-tile persistent state (tag-trees, segments, chunks).
   * Must be called before the packet loops of each new tile.
   * @method
   */
  resetState() {
    this._state.clear();
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
   * Read one HTJ2K packet header + body (OpenJPEG model). Stores per-codeblock
   * segment/chunk state on `cb._pkt` for later assembly.
   * @method
   * @param {Uint8Array} buffer - Full codestream byte array.
   * @param {number} pos - Current byte position in buffer.
   * @param {number} dataEnd - Exclusive end of tile-part data in buffer.
   * @param {number} layer - Quality layer index (0-based).
   * @param {number} compIdx - Component index.
   * @param {number} resoIdx - Resolution index.
   * @param {Object} resolution - Resolution object from tile component.
   * @param {number} precinctIdx - Flat precinct index (py * nPrecinctsWide + px).
   * @param {Array<number>} bandNumbps - Mb (nominal bitplanes) per quantization
   *   band index (LL=0, HL=3(r-1)+1, LH=+2, HH=+3).
   * @param {Object} codInfo - {boolean useSop, boolean useEph, number codeblockStyle}.
   * @returns {number} New byte position after this packet.
   */
  readPacket(
    buffer,
    pos,
    dataEnd,
    layer,
    compIdx,
    resoIdx,
    resolution,
    precinctIdx,
    bandNumbps,
    codInfo
  ) {
    if (pos >= dataEnd) {
      return pos;
    }

    const initialPos = pos;
    const initialPphPos = this._pphActive ? this._pphPos : 0;
    const useSop = codInfo.useSop;
    // Per Rec. ITU-T T.800 Figure B.10 the EPH marker sits at the end of the
    // packet HEADER. When headers are packed via PPM/PPT, the EPH markers are
    // stored as literal 0xff92 bytes inside the packed-header data (this is
    // what Kakadu writes and what OpenJPEG consumes from ppm_data). SOP
    // markers, in contrast, stay inline in the tile-part body.
    const useEph = codInfo.useEph;
    const codeblockStyle = codInfo.codeblockStyle;
    const subBands = resolution.subBands;
    const pp = resolution.getPrecinctParameters();
    const numPrecinctsWide = pp.numPrecinctsWide;

    const pxVal = precinctIdx % numPrecinctsWide;
    const pyVal = Math.floor(precinctIdx / numPrecinctsWide);

    // Bands of this resolution that have codeblocks in this precinct.
    const active = [];
    for (let si = 0; si < subBands.length; si++) {
      const sb = subBands[si];
      if (sb.codeblocks.length === 0) {
        continue;
      }
      const pr = sb.precincts.find((p) => p.px === pxVal && p.py === pyVal);
      if (pr && pr.cbsW > 0 && pr.cbsH > 0) {
        active.push({ si, sb, precinct: pr });
      }
    }

    // Reset tag-trees and codeblock segment state on every layer-0 packet
    // (OpenJPEG t2.c, before the present-bit is read).
    if (layer === 0) {
      for (const { sb, precinct } of active) {
        const bandState = this._getBandState(compIdx, resoIdx, precinctIdx, sb, precinct);
        bandState.inclTree.reset();
        bandState.imsbTree.reset();
        for (const st of bandState.cbs) {
          st.numsegs = 0;
          st.chunks.length = 0;
          st.numchunks = 0;
          st.corrupted = false;
        }
      }
    }

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

    const readBit = () => this._readBit();

    // Header phase --------------------------------------------------------
    const present = this._readBit();
    const stateList = [];

    if (present && active.length > 0) {
      for (const { si, sb, precinct } of active) {
        const bandState = this._getBandState(compIdx, resoIdx, precinctIdx, sb, precinct);
        // Quantization band index: resolution 0 is LL (index 0); for r>0 the
        // subBands order is HL, LH, HH mapping to indices 3(r-1)+1/2/3.
        const bandIdx = resoIdx === 0 ? 0 : 3 * (resoIdx - 1) + 1 + si;
        const bandMb = bandIdx < bandNumbps.length ? bandNumbps[bandIdx] : 0;

        for (let cblkno = 0; cblkno < precinct.cbsW * precinct.cbsH; cblkno++) {
          const localY = Math.floor(cblkno / precinct.cbsW);
          const localX = cblkno % precinct.cbsW;
          const cbIdx = (precinct.cbOffY + localY) * sb.totalCbsWide + precinct.cbOffX + localX;
          if (cbIdx < 0 || cbIdx >= sb.codeblocks.length) {
            continue;
          }
          const cb = sb.codeblocks[cbIdx];
          const st = bandState.cbs[cblkno];
          st.cb = cb;
          cb._pkt = st;
          stateList.push(st);

          // 1. Inclusion: tag-tree on first appearance, single bit afterwards.
          let included;
          if (st.numsegs === 0) {
            included = bandState.inclTree.decode(readBit, cblkno, layer + 1);
          } else {
            included = this._readBit() === 1;
          }
          if (!included) {
            st.numnewpasses = 0;
            continue;
          }

          // 2. Zero bitplanes (missing MSBs) via the imsb tag-tree, first time only.
          if (st.numsegs === 0) {
            let i = 0;
            while (!bandState.imsbTree.decode(readBit, cblkno, i)) {
              ++i;
            }
            st.Mb = bandMb;
            // Mb + 1 - i under unsigned wrap semantics, matching OpenJPEG's
            // behaviour on the malformed i > Mb + 1 path.
            st.numbps = (bandMb + 1 - i) >>> 0;
            st.numlenbits = 3;
          }

          // 3. Number of new coding passes + length-indicator increment.
          st.numnewpasses = this._readNumPasses();
          st.numlenbits += this._readCommaCode();

          // 4. Target segment.
          let segno;
          if (st.numsegs === 0) {
            segno = 0;
            this._initSeg(st, 0, codeblockStyle, true);
          } else {
            segno = st.numsegs - 1;
            if (st.segs[segno].numpasses === st.segs[segno].maxpasses) {
              ++segno;
              this._initSeg(st, segno, codeblockStyle, false);
            }
          }

          // 5. Per-segment new-lengths (HT branch of opj_t2_read_packet_header).
          let n = st.numnewpasses;
          for (;;) {
            const seg = st.segs[segno];
            seg.numnewpasses = segno === 0 ? 1 : n;
            const bits = st.numlenbits + TgtTree._floorLog2(seg.numnewpasses);
            if (bits > 32) {
              throw new Error(
                `Invalid bit number ${bits} in packet header ` +
                  `(layer ${layer}, precinct ${precinctIdx})`
              );
            }
            seg.newlen = this._readBits(bits);
            n -= seg.numnewpasses;
            if (n <= 0) {
              break;
            }
            ++segno;
            this._initSeg(st, segno, codeblockStyle, false);
          }
        }
      }
    }

    // Byte-align the header bit-reader (opj_bio_inalign): if the last byte
    // loaded was 0xff, the following bit-stuffed byte belongs to the header
    // and is consumed as well.
    if (this._skipMsb) {
      ++this._bitPos;
    }
    this._bitsLeft = 0;
    this._skipMsb = false;

    // Advance past the header bytes; consume the (required) EPH marker if in use.
    if (this._pphActive) {
      this._pphPos = this._bitPos;
      this._pphBitBuf = 0;
      this._pphBitsLeft = 0;
      this._pphSkipMsb = false;
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
      if (useEph && pos + 1 < dataEnd && buffer[pos] === 0xff && buffer[pos + 1] === 0x92) {
        pos += 2;
      }
    }

    // Data phase -----------------------------------------------------------
    // Segments and chunks are read in the same (band, codeblock) order used by
    // the header phase; codeblocks with no new passes contribute no bytes.
    let partialBuffer = false;
    for (const st of stateList) {
      if (st.numnewpasses === 0) {
        continue;
      }
      if (partialBuffer || st.corrupted) {
        st.numchunks = 0;
        st.corrupted = true;
        continue;
      }

      // NOTE: segments were already (re)initialized by the header phase for
      // this packet; the data phase must NOT re-init them (it would wipe the
      // newly-parsed numnewpasses/newlen) -- it only advances numsegs.
      let segno;
      if (st.numsegs === 0) {
        segno = 0;
        st.numsegs = 1;
      } else {
        segno = st.numsegs - 1;
        if (st.segs[segno].numpasses === st.segs[segno].maxpasses) {
          ++segno;
          st.numsegs = segno + 1;
        }
      }

      for (;;) {
        const seg = st.segs[segno];
        if (pos + seg.newlen > dataEnd) {
          // Non-strict behavior (OpenJPEG default): mark this codeblock and all
          // later ones in the packet as corrupted, consuming the remainder.
          partialBuffer = true;
          st.corrupted = true;
          st.numchunks = 0;
          break;
        }
        st.chunks.push(pos, seg.newlen);
        st.numchunks += 1;
        pos += seg.newlen;
        seg.len += seg.newlen;
        seg.numpasses += seg.numnewpasses;
        st.numnewpasses -= seg.numnewpasses;
        seg.realNumPasses = seg.numpasses;
        if (st.numnewpasses > 0) {
          ++segno;
          st.numsegs = segno + 1;
        } else {
          break;
        }
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
   * Gets (creating on demand) the persistent band state for one subband of a
   * (component, resolution, precinct) triple: the two tag-trees and one
   * per-codeblock record for each codeblock of the precinct portion.
   * @method
   * @private
   * @param {number} compIdx - Component index.
   * @param {number} resoIdx - Resolution index.
   * @param {number} precinctIdx - Flat precinct index.
   * @param {SubBand} sb - Sub-band owning the codeblocks.
   * @param {Object} precinct - Precinct record {cbsW, cbsH}.
   * @returns {Object} Band state.
   */
  _getBandState(compIdx, resoIdx, precinctIdx, sb, precinct) {
    const key = compIdx + '-' + resoIdx + '-' + precinctIdx + '-' + sb.subBandType;
    let band = this._state.get(key);
    if (!band) {
      const cbs = [];
      for (let i = 0; i < precinct.cbsW * precinct.cbsH; i++) {
        cbs.push({
          cb: null,
          Mb: 0,
          numbps: 0,
          numlenbits: 3,
          numnewpasses: 0,
          numsegs: 0,
          segs: [],
          chunks: [],
          numchunks: 0,
          corrupted: false,
          _pending: true,
        });
      }
      band = {
        inclTree: new TgtTree(precinct.cbsW, precinct.cbsH),
        imsbTree: new TgtTree(precinct.cbsW, precinct.cbsH),
        cbs,
      };
      this._state.set(key, band);
    }
    return band;
  }

  /**
   * Initializes a codeblock segment (opj_t2_init_seg). HT default maxpasses is
   * 109; TERMALL restricts each segment to a single pass; the LAZY-mode bit
   * alternates segment capacities as in OpenJPEG (10 for the first segment,
   * then 2/1 alternating when the previous capacity was 1 or 10).
   * @method
   * @private
   * @param {Object} st - Codeblock packet state.
   * @param {number} segno - Segment index.
   * @param {number} codeblockStyle - COD codeblock style flags.
   * @param {boolean} first - First-segment flag.
   */
  _initSeg(st, segno, codeblockStyle, first) {
    let maxpasses;
    if ((codeblockStyle & 4) !== 0) {
      maxpasses = 1;
    } else if ((codeblockStyle & 8) !== 0) {
      if (first) {
        maxpasses = 10;
      } else {
        const prev = st.segs[segno - 1].maxpasses;
        maxpasses = prev === 1 || prev === 10 ? 2 : 1;
      }
    } else {
      maxpasses = 109;
    }
    st.segs[segno] = {
      len: 0,
      numpasses: 0,
      numnewpasses: 0,
      newlen: 0,
      maxpasses,
      realNumPasses: 0,
    };
  }

  /**
   * Length-indicator increment code (opj_t2_getcommacode): unary code of
   * n one-bits terminated by a zero-bit (unbounded).
   * @method
   * @private
   * @returns {number} The increment.
   */
  _readCommaCode() {
    let n = 0;
    while (this._readBit()) {
      ++n;
    }
    return n;
  }

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
