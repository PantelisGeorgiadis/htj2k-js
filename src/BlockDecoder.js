const { vlcTable0, vlcTable1, uVlcTable0, uVlcTable1 } = require('./Tables');

//#region BlockDecoder
class BlockDecoder {
  /**
   * Creates an instance of BlockDecoder.
   * @constructor
   */
  constructor() {
    this.MEL_EXP = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5];
  }

  /**
   * Decodes one HTJ2K cleanup-pass codeblock.
   * @method
   * @param {Uint8Array} codedData - Encoded codeblock bytes.
   * @param {number} offset - Offset into codedData.
   * @param {number} missingMSBs - Number of missing MSBs.
   * @param {number} numPasses - Number of coding passes (1=CUP, 2=CUP+SPP, 3=CUP+SPP+MRP).
   * @param {number} lengths1 - Length of cleanup pass.
   * @param {number} lengths2 - Length of refinement passes (SPP+MRP).
   * @param {number} width - Codeblock width.
   * @param {number} height - Codeblock height.
   * @returns {Int32Array|null} Decoded coefficients (height×width), or null on failure.
   */
  decodeCodeblock(codedData, offset, missingMSBs, numPasses, lengths1, lengths2, width, height) {
    if (lengths1 < 2) {
      return null;
    }
    if (missingMSBs > 30) {
      return null;
    }
    if (missingMSBs === 30) {
      return null;
    } // not enough precision

    if (numPasses > 1 && lengths2 === 0) {
      numPasses = 1;
    }
    if (numPasses > 3) {
      numPasses = 3;
    }
    if (missingMSBs === 29 && numPasses > 1) {
      numPasses = 1;
    }

    const p = 30 - missingMSBs;
    const scup = (codedData[offset + lengths1 - 1] << 4) | (codedData[offset + lengths1 - 2] & 0xf);
    if (scup < 2 || scup > lengths1 || scup > 4079) {
      return null;
    }

    const lcup = lengths1;
    const stride = width;
    const decoded = new Int32Array(stride * height);
    const mmsbp2 = missingMSBs + 2;
    const sstr = (width + 4 + 7) & ~7; // multiple of 8, with >=4 extra entries of padding
    const scratch = new Uint16Array(sstr * 513);

    // Step 1: decode VLC + MEL
    {
      const mel = this._melInit(codedData, offset, lcup, scup);
      const vlc = this._revInit(codedData, offset, lcup, scup);
      let run = this._melGetRun(mel);
      let vlcVal;
      let cQ = 0;
      let sp = 0; // scratch index

      // Initial quad row (y=0)
      for (let x = 0; x < width; sp += 4) {
        vlcVal = this._revFetch(vlc);
        let t0 = vlcTable0[cQ + (vlcVal & 0x7f)];
        if (cQ === 0) {
          run -= 2;
          t0 = run === -1 ? t0 : 0;
          if (run < 0) {
            run = this._melGetRun(mel);
          }
        }
        scratch[sp] = t0;
        x += 2;
        cQ = ((t0 & 0x10) << 3) | ((t0 & 0xe0) << 2);
        vlcVal = this._revAdvance(vlc, t0 & 0x7);

        let t1 = 0;
        t1 = vlcTable0[cQ + (vlcVal & 0x7f)];
        if (cQ === 0 && x < width) {
          run -= 2;
          t1 = run === -1 ? t1 : 0;
          if (run < 0) {
            run = this._melGetRun(mel);
          }
        }
        t1 = x < width ? t1 : 0;
        scratch[sp + 2] = t1;
        x += 2;
        cQ = ((t1 & 0x10) << 3) | ((t1 & 0xe0) << 2);
        vlcVal = this._revAdvance(vlc, t1 & 0x7);

        // decode u for the quad pair
        let uvlcMode = ((t0 & 0x8) << 3) | ((t1 & 0x8) << 4);
        if (uvlcMode === 0xc0) {
          run -= 2;
          uvlcMode += run === -1 ? 0x40 : 0;
          if (run < 0) {
            run = this._melGetRun(mel);
          }
        }
        let uvlcEntry = uVlcTable0[uvlcMode + (vlcVal & 0x3f)];
        vlcVal = this._revAdvance(vlc, uvlcEntry & 0x7);
        uvlcEntry >>= 3;
        let len = uvlcEntry & 0xf;
        let tmp = vlcVal & ((1 << len) - 1);
        vlcVal = this._revAdvance(vlc, len);
        uvlcEntry >>= 4;
        len = uvlcEntry & 0x7;
        uvlcEntry >>= 3;
        let uQ = (1 + (uvlcEntry & 7) + (tmp & ~(0xff << len))) & 0xffff;
        scratch[sp + 1] = uQ;
        uQ = (1 + (uvlcEntry >> 3) + (tmp >> len)) & 0xffff;
        scratch[sp + 3] = uQ;
      }
      scratch[sp] = scratch[sp + 1] = 0;

      // Non-initial quad rows
      for (let y = 2; y < height; y += 2) {
        cQ = 0;
        sp = (y >> 1) * sstr;
        for (let x = 0; x < width; sp += 4) {
          // Context from previous row
          const psp = sp - sstr;
          cQ |= (scratch[psp] & 0xa0) << 2;
          cQ |= (scratch[psp + 2] & 0x20) << 4;

          vlcVal = this._revFetch(vlc);
          let t0 = vlcTable1[cQ + (vlcVal & 0x7f)];
          if (cQ === 0) {
            run -= 2;
            t0 = run === -1 ? t0 : 0;
            if (run < 0) {
              run = this._melGetRun(mel);
            }
          }
          scratch[sp] = t0;
          x += 2;
          cQ = ((t0 & 0x40) << 2) | ((t0 & 0x80) << 1);
          cQ |= scratch[psp] & 0x80;
          cQ |= (scratch[psp + 2] & 0xa0) << 2;
          const nsp2 = psp + 4;
          cQ |= (nsp2 < sstr * (height / 2 + 1) ? scratch[nsp2] & 0x20 : 0) << 4;
          vlcVal = this._revAdvance(vlc, t0 & 0x7);

          let t1 = 0;
          t1 = vlcTable1[cQ + (vlcVal & 0x7f)];
          if (cQ === 0 && x < width) {
            run -= 2;
            t1 = run === -1 ? t1 : 0;
            if (run < 0) {
              run = this._melGetRun(mel);
            }
          }
          t1 = x < width ? t1 : 0;
          scratch[sp + 2] = t1;
          x += 2;
          cQ = ((t1 & 0x40) << 2) | ((t1 & 0x80) << 1);
          cQ |= scratch[psp + 2] & 0x80;
          vlcVal = this._revAdvance(vlc, t1 & 0x7);

          // decode u for the quad pair
          let uvlcMode = ((t0 & 0x8) << 3) | ((t1 & 0x8) << 4);
          let uvlcEntry = uVlcTable1[uvlcMode + (vlcVal & 0x3f)];
          vlcVal = this._revAdvance(vlc, uvlcEntry & 0x7);
          uvlcEntry >>= 3;
          let len = uvlcEntry & 0xf;
          let tmp = vlcVal & ((1 << len) - 1);
          vlcVal = this._revAdvance(vlc, len);
          uvlcEntry >>= 4;
          len = uvlcEntry & 0x7;
          uvlcEntry >>= 3;
          let uQ = ((uvlcEntry & 7) + (tmp & ~(0xff << len))) & 0xffff;
          scratch[sp + 1] = uQ;
          uQ = ((uvlcEntry >> 3) + (tmp >> len)) & 0xffff;
          scratch[sp + 3] = uQ;
        }
        scratch[sp - sstr + 0] = scratch[sp - sstr + 1] = 0;
      }
    }

    // Step 2: decode MagSgn
    {
      const magsgn = this._frwdInit(codedData, offset, lcup - scup, 0xff);
      const vNScratch = new Int32Array(512 + 4);
      let sp = 0;
      let dp = 0;
      let prevVN = 0;

      // Row 0 (initial)
      let vp = 0;
      for (let x = 0; x < width; sp += 2, vp++) {
        const inf = scratch[sp];
        const uQ = scratch[sp + 1];
        if (uQ > mmsbp2) return null;
        let vN;

        for (let bit = 0; bit < 4; bit += 2) {
          let val = 0;
          if (inf & (1 << (4 + bit))) {
            const msVal = this._frwdFetch(magsgn);
            const mN = uQ - ((inf >> (12 + bit)) & 1);
            this._frwdAdvance(magsgn, mN);
            val = (msVal << 31) >>> 0;
            vN = msVal & ((1 << mN) - 1);
            vN |= ((inf >> (8 + bit)) & 1) << mN;
            vN |= 1;
            val = (val | ((vN + 2) << (p - 1))) >>> 0;
          } else {
            vN = 0;
          }
          if (bit === 0) {
            decoded[dp] = val | 0;
          } else {
            decoded[dp] = val | 0;
          }
          if (bit === 0) {
            // second sample in pair (bottom of column)
            let val2 = 0;
            if (inf & (1 << (4 + 1))) {
              const msVal = this._frwdFetch(magsgn);
              const mN = uQ - ((inf >> (12 + 1)) & 1);
              this._frwdAdvance(magsgn, mN);
              val2 = (msVal << 31) >>> 0;
              vN = msVal & ((1 << mN) - 1);
              vN |= ((inf >> (8 + 1)) & 1) << mN;
              vN |= 1;
              val2 = (val2 | ((vN + 2) << (p - 1))) >>> 0;
            } else {
              vN = 0;
            }
            decoded[dp + stride] = val2 | 0;
            vNScratch[vp] = prevVN | vN;
            prevVN = 0;
            dp++;
            if (++x >= width) {
              vp++;
              break;
            }
            // next column (bits 2&3)
            val = 0;
            if (inf & (1 << (4 + 2))) {
              const msVal = this._frwdFetch(magsgn);
              const mN = uQ - ((inf >> (12 + 2)) & 1);
              this._frwdAdvance(magsgn, mN);
              val = (msVal << 31) >>> 0;
              let vN2 = msVal & ((1 << mN) - 1);
              vN2 |= ((inf >> (8 + 2)) & 1) << mN;
              vN2 |= 1;
              val = (val | ((vN2 + 2) << (p - 1))) >>> 0;
            }
            decoded[dp] = val | 0;
            val = 0;
            vN = 0;
            if (inf & (1 << (4 + 3))) {
              const msVal = this._frwdFetch(magsgn);
              const mN = uQ - ((inf >> (12 + 3)) & 1);
              this._frwdAdvance(magsgn, mN);
              val = (msVal << 31) >>> 0;
              vN = msVal & ((1 << mN) - 1);
              vN |= ((inf >> (8 + 3)) & 1) << mN;
              vN |= 1;
              val = (val | ((vN + 2) << (p - 1))) >>> 0;
            }
            decoded[dp + stride] = val | 0;
            prevVN = vN;
            dp++;
            x++;
            break;
          }
        }
      }
      vNScratch[vp] = prevVN;

      // Rows 2+ (non-initial)
      for (let y = 2; y < height; y += 2) {
        sp = (y >> 1) * sstr;
        vp = 0;
        dp = y * stride;
        prevVN = 0;
        for (let x = 0; x < width; sp += 2, vp++) {
          const inf = scratch[sp];
          const uQ = scratch[sp + 1];
          const gamma = inf & 0xf0 & ((inf & 0xf0) - 0x10);
          const emaxVal = vNScratch[vp] | vNScratch[vp + 1];
          const emax = 31 - Math.clz32(emaxVal | 2);
          const kappa = gamma ? emax : 1;
          const UQ = uQ + kappa;
          if (UQ > mmsbp2) return null;

          let vN;
          // bit 0
          let val = 0;
          if (inf & (1 << 4)) {
            const msVal = this._frwdFetch(magsgn);
            const mN = UQ - ((inf >> 12) & 1);
            this._frwdAdvance(magsgn, mN);
            val = (msVal << 31) >>> 0;
            vN = (msVal & ((1 << mN) - 1)) | (((inf >> 8) & 1) << mN) | 1;
            val = (val | ((vN + 2) << (p - 1))) >>> 0;
          } else {
            vN = 0;
          }
          decoded[dp] = val | 0;

          // bit 1
          val = 0;
          let vN1 = 0;
          if (inf & (1 << 5)) {
            const msVal = this._frwdFetch(magsgn);
            const mN = UQ - ((inf >> 13) & 1);
            this._frwdAdvance(magsgn, mN);
            val = (msVal << 31) >>> 0;
            vN1 = (msVal & ((1 << mN) - 1)) | (((inf >> 9) & 1) << mN) | 1;
            val = (val | ((vN1 + 2) << (p - 1))) >>> 0;
          }
          decoded[dp + stride] = val | 0;
          vNScratch[vp] = prevVN | vN1;
          prevVN = 0;
          dp++;
          if (++x >= width) {
            vp++;
            break;
          }

          // bit 2
          val = 0;
          if (inf & (1 << 6)) {
            const msVal = this._frwdFetch(magsgn);
            const mN = UQ - ((inf >> 14) & 1);
            this._frwdAdvance(magsgn, mN);
            val = (msVal << 31) >>> 0;
            vN = (msVal & ((1 << mN) - 1)) | (((inf >> 10) & 1) << mN) | 1;
            val = (val | ((vN + 2) << (p - 1))) >>> 0;
          } else {
            vN = 0;
          }
          decoded[dp] = val | 0;

          // bit 3
          val = 0;
          vN1 = 0;
          if (inf & (1 << 7)) {
            const msVal = this._frwdFetch(magsgn);
            const mN = UQ - ((inf >> 15) & 1);
            this._frwdAdvance(magsgn, mN);
            val = (msVal << 31) >>> 0;
            vN1 = (msVal & ((1 << mN) - 1)) | (((inf >> 11) & 1) << mN) | 1;
            val = (val | ((vN1 + 2) << (p - 1))) >>> 0;
          }
          decoded[dp + stride] = val | 0;
          prevVN = vN1;
          dp++;
          x++;
        }
        vNScratch[vp] = prevVN;
      }
    }

    // Steps 3+: SPP and MRP passes (skipped if numPasses === 1)
    if (numPasses > 1) {
      // Significance Propagation Pass (SPP) and Magnitude Refinement Pass (MRP)
      // are handled by re-using scratch as sigma array; full implementation omitted
      // for initial single-pass CUP coverage.
      // TODO: implement SPP and MRP
    }

    return decoded;
  }

  //#region Private Methods
  /**
   * Create a low-bit mask with the requested width.
   * @method
   * @private
   * @param {number} bits - Number of low bits to keep.
   * @returns {number} Unsigned 32-bit mask.
   */
  _maskBits(bits) {
    if (bits <= 0) {
      return 0;
    }
    if (bits >= 32) {
      return 0xffffffff;
    }

    return ((1 << bits) - 1) >>> 0;
  }

  /**
   * Shift an in-place decoder state buffer left.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} bits - Number of bits to shift.
   */
  _shiftStateLeft(st, bits) {
    if (bits <= 0) {
      return;
    }
    if (bits >= 64) {
      st.tmpHi = 0;
      st.tmpLo = 0;
      return;
    }
    if (bits >= 32) {
      st.tmpHi = (st.tmpLo << (bits - 32)) >>> 0;
      st.tmpLo = 0;
      return;
    }
    st.tmpHi = (((st.tmpHi << bits) >>> 0) | (st.tmpLo >>> (32 - bits))) >>> 0;
    st.tmpLo = (st.tmpLo << bits) >>> 0;
  }

  /**
   * Shift an in-place decoder state buffer right.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} bits - Number of bits to shift.
   */
  _shiftStateRight(st, bits) {
    if (bits <= 0) {
      return;
    }
    if (bits >= 64) {
      st.tmpHi = 0;
      st.tmpLo = 0;
      return;
    }
    if (bits >= 32) {
      st.tmpLo = st.tmpHi >>> (bits - 32);
      st.tmpHi = 0;
      return;
    }
    st.tmpLo = ((st.tmpLo >>> bits) | ((st.tmpHi << (32 - bits)) >>> 0)) >>> 0;
    st.tmpHi = st.tmpHi >>> bits;
  }

  /**
   * OR a 32-bit word into a logical 64-bit buffer at a given bit offset.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} value - Unsigned 32-bit word to merge.
   * @param {number} shift - Bit offset from the low end of the 64-bit buffer.
   */
  _orWordAt(st, value, shift) {
    value >>>= 0;
    if (value === 0) {
      return;
    }
    if (shift < 32) {
      st.tmpLo = (st.tmpLo | ((value << shift) >>> 0)) >>> 0;
      if (shift !== 0) {
        st.tmpHi = (st.tmpHi | (value >>> (32 - shift))) >>> 0;
      }
      return;
    }
    if (shift === 32) {
      st.tmpHi = (st.tmpHi | value) >>> 0;
      return;
    }
    st.tmpHi = (st.tmpHi | ((value << (shift - 32)) >>> 0)) >>> 0;
  }

  /**
   * Append bits at the high end of the active buffer window.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} value - Bits to append.
   * @param {number} width - Number of valid bits in value.
   */
  _appendTopBits(st, value, width) {
    this._orWordAt(st, value, 64 - st.bits - width);
    st.bits += width;
  }

  /**
   * Append bits at the low end of the active buffer window.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} value - Bits to append.
   * @param {number} width - Number of valid bits in value.
   */
  _appendBottomBits(st, value, width) {
    this._orWordAt(st, value, st.bits);
    st.bits += width;
  }

  /**
   * Read a bit field from the high end of the 64-bit buffer without mutating it.
   * @method
   * @private
   * @param {Object} st - Bit-buffer state.
   * @param {number} skip - Number of leading bits to skip.
   * @param {number} width - Number of bits to read.
   * @returns {number} Extracted bit field.
   */
  _peekTopBits(st, skip, width) {
    if (width <= 0) {
      return 0;
    }

    const shift = 64 - skip - width;
    let lo;
    if (shift >= 64) {
      return 0;
    } else if (shift >= 32) {
      lo = st.tmpHi >>> (shift - 32);
    } else if (shift > 0) {
      lo = ((st.tmpLo >>> shift) | ((st.tmpHi << (32 - shift)) >>> 0)) >>> 0;
    } else {
      lo = st.tmpLo;
    }

    return lo & this._maskBits(width);
  }

  /**
   * Initialize MEL decoder state.
   * @method
   * @private
   * @param {Uint8Array} data - Encoded codeblock bytes.
   * @param {number} offset - Offset into data.
   * @param {number} lcup - Length of cleanup pass.
   * @param {number} scup - Length of final part of cleanup pass used for MEL (2-4079).
   * @returns {Object} MEL decoder state.
   */
  _melInit(data, offset, lcup, scup) {
    const st = {
      data,
      pos: offset + lcup - scup,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: scup - 1,
      unstuff: false,
      k: 0,
      runs: [],
    };
    // prime the buffer: read bytes to align
    const align = 4 - ((offset + lcup - scup) & 3);
    for (let i = 0; i < align; i++) {
      let d;
      if (st.size > 0) {
        d = data[st.pos++];
        st.size--;
        if (st.size === 0) d |= 0x0f; // last byte before VLC: pad LSBs with 0xF
      } else {
        d = 0xff;
      }
      const dBits = st.unstuff ? 7 : 8;
      this._appendTopBits(st, d, dBits);
      st.unstuff = (d & 0xff) === 0xff;
    }

    return st;
  }

  /**
   * Read and unstuff MEL bits into the buffer until at least 6 bits are available.
   * @method
   * @private
   * @param {Object} st - MEL decoder state.
   */
  _melRead(st) {
    if (st.bits > 32) {
      return;
    }
    for (let i = 0; i < 4; i++) {
      let d;
      if (st.size > 0) {
        d = st.data[st.pos++];
        st.size--;
        if (st.size === 0) {
          d |= 0x0f;
        }
      } else {
        d = 0xff;
      }

      const dBits = st.unstuff ? 7 : 8;
      this._appendTopBits(st, d, dBits);
      st.unstuff = d === 0xff;
    }
  }

  /**
   * Decode MEL runs until at least one run is available or end of MEL data is reached.
   * @method
   * @private
   * @param {Object} st - MEL decoder state.
   */
  _melDecode(st) {
    if (st.bits < 6) {
      this._melRead(st);
    }
    while (st.bits >= 6 && st.runs.length < 8) {
      const evl = this.MEL_EXP[st.k];
      let run = 0;
      if ((st.tmpHi & 0x80000000) !== 0) {
        run = (1 << evl) - 1;
        st.k = st.k + 1 < 12 ? st.k + 1 : 12;
        this._shiftStateLeft(st, 1);
        st.bits -= 1;
        run <<= 1; // not terminated in 1
      } else {
        run = this._peekTopBits(st, 1, evl);
        st.k = st.k - 1 > 0 ? st.k - 1 : 0;
        this._shiftStateLeft(st, evl + 1);
        st.bits -= evl + 1;
        run = (run << 1) + 1; // terminated in 1
      }
      st.runs.push(run);
    }
  }

  /**
   * Get the next MEL run, decoding more runs if necessary.
   * @method
   * @private
   * @param {Object} st - MEL decoder state.
   * @returns {number} Next run value, or 0 if no more runs are available.
   */
  _melGetRun(st) {
    if (st.runs.length === 0) {
      this._melDecode(st);
    }

    return st.runs.length > 0 ? st.runs.shift() : 0;
  }

  /**
   * Initialize reverse VLC decoder state.
   * @method
   * @private
   * @param {Uint8Array} data - Encoded codeblock bytes.
   * @param {number} offset - Offset into data.
   * @param {number} lcup - Length of cleanup pass.
   * @param {number} scup - Length of final part of cleanup pass used for VLC (2-4079).
   * @returns {Object} Reverse VLC decoder state.
   */
  _revInit(data, offset, lcup, scup) {
    const st = {
      data,
      pos: offset + lcup - 2,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: scup - 2,
      unstuff: false,
    };
    let d = data[st.pos--];
    st.tmpLo = d >>> 4;
    st.bits = 4 - ((st.tmpLo & 0x7) === 0x7 ? 1 : 0);
    st.unstuff = (d | 0x0f) > 0x8f;
    const num = 1 + ((offset + lcup - 2) & 3);
    const tnum = Math.min(num, st.size);
    for (let i = 0; i < tnum; i++) {
      d = data[st.pos--];
      st.size--;
      const dBits = st.unstuff && (d & 0x7f) === 0x7f ? 7 : 8;
      this._appendBottomBits(st, d, dBits);
      st.unstuff = d > 0x8f;
    }
    this._revRead(st);

    return st;
  }

  /**
   * Read and unstuff VLC bits into the buffer until at least 32 bits are available.
   * @method
   * @private
   * @param {Object} st - Reverse VLC decoder state.
   */
  _revRead(st) {
    if (st.bits > 32) {
      return;
    }
    for (let i = 0; i < 4; i++) {
      let d = 0;
      if (st.size > 0) {
        d = st.data[st.pos--];
        st.size--;
      }

      const dBits = st.unstuff && (d & 0x7f) === 0x7f ? 7 : 8;
      this._appendBottomBits(st, d, dBits);
      st.unstuff = d > 0x8f;
    }
  }

  /**
   * Fetch the next 32 bits from the VLC buffer, reading more bits if necessary.
   * @method
   * @private
   * @param {Object} st - Reverse VLC decoder state.
   * @returns {number} Next 32 bits of VLC data.
   */
  _revFetch(st) {
    if (st.bits < 32) {
      this._revRead(st);
      if (st.bits < 32) {
        this._revRead(st);
      }
    }

    return st.tmpLo >>> 0;
  }

  /**
   * Advance the VLC buffer by a specified number of bits, discarding them.
   * @method
   * @private
   * @param {Object} st - Reverse VLC decoder state.
   * @param {number} numBits - Number of bits to advance.
   * @returns {number} Next 32 bits of VLC data after advancing.
   */
  _revAdvance(st, numBits) {
    this._shiftStateRight(st, numBits);
    st.bits -= numBits;

    return st.tmpLo >>> 0;
  }

  /**
   * Initialize forward VLC decoder state.
   * @method
   * @private
   * @param {Uint8Array} data - Encoded codeblock bytes.
   * @param {number} offset - Offset into data.
   * @param {number} size - Length of VLC data.
   * @param {number} fillByte - Byte value to use when VLC data is exhausted (0 or 0xFF).
   * @returns {Object} Forward VLC decoder state.
   */
  _frwdInit(data, offset, size, fillByte) {
    const st = { data, pos: offset, tmpHi: 0, tmpLo: 0, bits: 0, size, unstuff: 0, fillByte };
    const num = 4 - (offset & 3);
    for (let i = 0; i < num; i++) {
      let d = fillByte;
      if (st.size > 0) {
        d = st.data[st.pos++];
        st.size--;
      }
      this._appendBottomBits(st, d, 8 - st.unstuff);
      st.unstuff = d === 0xff ? 1 : 0;
    }
    this._frwdRead(st);

    return st;
  }

  /**
   * Read and unstuff VLC bits into the buffer until at least 32 bits are available.
   * @method
   * @private
   * @param {Object} st - Forward VLC decoder state.
   */
  _frwdRead(st) {
    if (st.bits > 32) {
      return;
    } // enough bits
    for (let i = 0; i < 4; i++) {
      let d = st.fillByte;
      if (st.size > 0) {
        d = st.data[st.pos++];
        st.size--;
      }

      this._appendBottomBits(st, d, 8 - st.unstuff);
      st.unstuff = d === 0xff ? 1 : 0;
    }
  }

  /**
   * Fetch the next 32 bits from the forward VLC buffer, reading more bits if necessary.
   * @method
   * @private
   * @param {Object} st - Forward VLC decoder state.
   * @returns {number} Next 32 bits of VLC data.
   */
  _frwdFetch(st) {
    if (st.bits < 32) {
      this._frwdRead(st);
      if (st.bits < 32) {
        this._frwdRead(st);
      }
    }

    return st.tmpLo >>> 0;
  }

  /**
   * Advance the forward VLC buffer by a specified number of bits.
   * @method
   * @private
   * @param {Object} st - Forward VLC decoder state.
   * @param {number} numBits - Number of bits to advance.
   */
  _frwdAdvance(st, numBits) {
    this._shiftStateRight(st, numBits);
    st.bits -= numBits;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = BlockDecoder;
//#endregion
