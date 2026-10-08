const { vlcTable0, vlcTable1, uVlcTable0, uVlcTable1 } = require('./Tables');

//#region BlockDecoder
class BlockDecoder {
  /**
   * Creates an instance of BlockDecoder.
   * @constructor
   */
  constructor() {
    this.MEL_EXP = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5];
    // Reusable buffers to reduce per-codeblock allocations
    this._scratch = new Uint16Array(0);
    this._decoded = new Int32Array(0);
    this._vNScratch = new Int32Array(516);
    // Reusable state objects (stable hidden class for V8)
    this._melState = {
      data: null,
      pos: 0,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: 0,
      unstuff: false,
      k: 0,
      runsArr: [0, 0, 0, 0, 0, 0, 0, 0],
      runsHead: 0,
      runsTail: 0,
    };
    this._vlcState = {
      data: null,
      pos: 0,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: 0,
      unstuff: false,
    };
    this._frwdState = {
      data: null,
      pos: 0,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: 0,
      unstuff: 0,
      fillByte: 0,
    };
    // Separate forward reader for SPP (so MagSgn state is preserved if needed)
    this._sppState = {
      data: null,
      pos: 0,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: 0,
      unstuff: 0,
      fillByte: 0,
    };
    // Backward reader for MRP segment (separate from VLC reverse reader)
    this._mrpState = {
      data: null,
      pos: 0,
      tmpHi: 0,
      tmpLo: 0,
      bits: 0,
      size: 0,
      unstuff: false,
    };
    // Significance Propagation Pass: previous-row significance buffer.
    // Each entry packs 4 columns of significance in nibbles. Sized for max
    // HTJ2K codeblock width of 1024 (256 entries) plus padding.
    this._prevRowSig = new Uint16Array(264);
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
    const decodedSize = stride * height;
    if (this._decoded.length < decodedSize) {
      this._decoded = new Int32Array(decodedSize);
    }
    // No per-codeblock zeroing: every decoded[dp] used downstream is written
    // unconditionally by the MagSgn stage before any pass reads it.
    const decoded = this._decoded;
    const mmsbp2 = missingMSBs + 2;
    const sstr = (width + 4 + 7) & ~7; // multiple of 8, with >=4 extra entries of padding
    const scratchSize = sstr * 513;
    if (this._scratch.length < scratchSize) {
      this._scratch = new Uint16Array(scratchSize);
    }
    // No per-codeblock zeroing: every scratch position read by a row was
    // written by the current codeblock, provided each quad row zeroes its
    // own trailing padding quad at row end (below) before the next row
    // consumes it as right-side context.
    const scratch = this._scratch;

    // Step 1: decode VLC + MEL
    {
      const mel = this._melInit(codedData, offset, lcup, scup);
      const vlc = this._revInit(codedData, offset, lcup, scup);
      // Hoist reverse-VLC bit-reader state into locals; the rare refills go
      // through _revFetch which operates on the shared state object.
      let rvLo = vlc.tmpLo;
      let rvHi = vlc.tmpHi;
      let rvBits = vlc.bits;
      let rvPos = vlc.pos;
      let rvSize = vlc.size;
      let rvUnst = vlc.unstuff;
      let run = this._melGetRun(mel);
      let vlcVal;
      let cQ = 0;
      let sp = 0; // scratch index

      // Initial quad row (y=0)
      for (let x = 0; x < width; sp += 4) {
        if (rvBits < 32) {
          vlc.tmpLo = rvLo;
          vlc.tmpHi = rvHi;
          vlc.bits = rvBits;
          vlc.pos = rvPos;
          vlc.size = rvSize;
          vlc.unstuff = rvUnst;
          this._revFetch(vlc);
          rvLo = vlc.tmpLo;
          rvHi = vlc.tmpHi;
          rvBits = vlc.bits;
          rvPos = vlc.pos;
          rvSize = vlc.size;
          rvUnst = vlc.unstuff;
        }
        vlcVal = rvLo >>> 0;
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
        {
          const k = t0 & 0x7;
          if (k > 0) {
            rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
            rvHi = rvHi >>> k;
            rvBits -= k;
          }
          vlcVal = rvLo >>> 0;
        }

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
        {
          const k = t1 & 0x7;
          if (k > 0) {
            rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
            rvHi = rvHi >>> k;
            rvBits -= k;
          }
          vlcVal = rvLo >>> 0;
        }

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
        {
          const k = uvlcEntry & 0x7;
          if (k > 0) {
            rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
            rvHi = rvHi >>> k;
            rvBits -= k;
          }
          vlcVal = rvLo >>> 0;
        }
        uvlcEntry >>= 3;
        let len = uvlcEntry & 0xf;
        let tmp = vlcVal & ((1 << len) - 1);
        {
          const k = len;
          if (k > 0) {
            rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
            rvHi = rvHi >>> k;
            rvBits -= k;
          }
          vlcVal = rvLo >>> 0;
        }
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

          if (rvBits < 32) {
            vlc.tmpLo = rvLo;
            vlc.tmpHi = rvHi;
            vlc.bits = rvBits;
            vlc.pos = rvPos;
            vlc.size = rvSize;
            vlc.unstuff = rvUnst;
            this._revFetch(vlc);
            rvLo = vlc.tmpLo;
            rvHi = vlc.tmpHi;
            rvBits = vlc.bits;
            rvPos = vlc.pos;
            rvSize = vlc.size;
            rvUnst = vlc.unstuff;
          }
          vlcVal = rvLo >>> 0;
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
          {
            const k = t0 & 0x7;
            if (k > 0) {
              rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
              rvHi = rvHi >>> k;
              rvBits -= k;
            }
            vlcVal = rvLo >>> 0;
          }

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
          {
            const k = t1 & 0x7;
            if (k > 0) {
              rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
              rvHi = rvHi >>> k;
              rvBits -= k;
            }
            vlcVal = rvLo >>> 0;
          }

          // decode u for the quad pair
          let uvlcMode = ((t0 & 0x8) << 3) | ((t1 & 0x8) << 4);
          let uvlcEntry = uVlcTable1[uvlcMode + (vlcVal & 0x3f)];
          {
            const k = uvlcEntry & 0x7;
            if (k > 0) {
              rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
              rvHi = rvHi >>> k;
              rvBits -= k;
            }
            vlcVal = rvLo >>> 0;
          }
          uvlcEntry >>= 3;
          let len = uvlcEntry & 0xf;
          let tmp = vlcVal & ((1 << len) - 1);
          {
            const k = len;
            if (k > 0) {
              rvLo = ((rvLo >>> k) | (rvHi << (32 - k))) >>> 0;
              rvHi = rvHi >>> k;
              rvBits -= k;
            }
            vlcVal = rvLo >>> 0;
          }
          uvlcEntry >>= 4;
          len = uvlcEntry & 0x7;
          uvlcEntry >>= 3;
          let uQ = ((uvlcEntry & 7) + (tmp & ~(0xff << len))) & 0xffff;
          scratch[sp + 1] = uQ;
          uQ = ((uvlcEntry >> 3) + (tmp >> len)) & 0xffff;
          scratch[sp + 3] = uQ;
        }
        // Zero this row's own padding quad so the next row's right-edge
        // context reads see zeros (row qr+1 consumes row qr's padding quad).
        scratch[sp + 0] = scratch[sp + 1] = 0;
      }
    }

    // Step 2: decode MagSgn
    {
      const magsgn = this._frwdInit(codedData, offset, lcup - scup, 0xff);
      // Hoist forward bit-reader state into locals; rare refills go through
      // _frwdFetch on the shared state object.
      let mLo = magsgn.tmpLo;
      let mHi = magsgn.tmpHi;
      let mBits = magsgn.bits;
      let mPos = magsgn.pos;
      let mSize = magsgn.size;
      let mUnst = magsgn.unstuff;
      const vNScratch = this._vNScratch;
      vNScratch.fill(0, 0, (width >>> 1) + 4);
      let sp = 0;
      let dp = 0;
      let prevVN = 0;

      // Row 0 (initial)
      let vp = 0;
      for (let x = 0; x < width; sp += 2, vp++) {
        const inf = scratch[sp];
        const uQ = scratch[sp + 1];
        if (uQ > mmsbp2) {
          return null;
        }
        let vN;

        // bit 0: top sample of this column
        let val = 0;
        if (inf & 16) {
          if (mBits < 32) {
            magsgn.tmpLo = mLo;
            magsgn.tmpHi = mHi;
            magsgn.bits = mBits;
            magsgn.pos = mPos;
            magsgn.size = mSize;
            magsgn.unstuff = mUnst;
            this._frwdFetch(magsgn);
            mLo = magsgn.tmpLo;
            mHi = magsgn.tmpHi;
            mBits = magsgn.bits;
            mPos = magsgn.pos;
            mSize = magsgn.size;
            mUnst = magsgn.unstuff;
          }
          const msVal = mLo >>> 0;
          const mN = uQ - ((inf >> 12) & 1);
          if (mN > 0) {
            mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
            mHi = mHi >>> mN;
          }
          mBits -= mN;
          val = (msVal << 31) >>> 0;
          vN = msVal & ((1 << mN) - 1);
          vN |= ((inf >> 8) & 1) << mN;
          vN |= 1;
          val = (val | ((vN + 2) << (p - 1))) >>> 0;
        } else {
          vN = 0;
        }
        decoded[dp] = val | 0;

        // bit 1: bottom sample of this column
        let val2 = 0;
        vN = 0;
        if (inf & 32) {
          if (mBits < 32) {
            magsgn.tmpLo = mLo;
            magsgn.tmpHi = mHi;
            magsgn.bits = mBits;
            magsgn.pos = mPos;
            magsgn.size = mSize;
            magsgn.unstuff = mUnst;
            this._frwdFetch(magsgn);
            mLo = magsgn.tmpLo;
            mHi = magsgn.tmpHi;
            mBits = magsgn.bits;
            mPos = magsgn.pos;
            mSize = magsgn.size;
            mUnst = magsgn.unstuff;
          }
          const msVal = mLo >>> 0;
          const mN = uQ - ((inf >> 13) & 1);
          if (mN > 0) {
            mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
            mHi = mHi >>> mN;
          }
          mBits -= mN;
          val2 = (msVal << 31) >>> 0;
          vN = msVal & ((1 << mN) - 1);
          vN |= ((inf >> 9) & 1) << mN;
          vN |= 1;
          val2 = (val2 | ((vN + 2) << (p - 1))) >>> 0;
        }
        decoded[dp + stride] = val2 | 0;
        vNScratch[vp] = prevVN | vN;
        prevVN = 0;
        dp++;
        if (++x >= width) {
          vp++;
          break;
        }

        // bit 2: top sample of next column
        val = 0;
        if (inf & 64) {
          if (mBits < 32) {
            magsgn.tmpLo = mLo;
            magsgn.tmpHi = mHi;
            magsgn.bits = mBits;
            magsgn.pos = mPos;
            magsgn.size = mSize;
            magsgn.unstuff = mUnst;
            this._frwdFetch(magsgn);
            mLo = magsgn.tmpLo;
            mHi = magsgn.tmpHi;
            mBits = magsgn.bits;
            mPos = magsgn.pos;
            mSize = magsgn.size;
            mUnst = magsgn.unstuff;
          }
          const msVal = mLo >>> 0;
          const mN = uQ - ((inf >> 14) & 1);
          if (mN > 0) {
            mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
            mHi = mHi >>> mN;
          }
          mBits -= mN;
          val = (msVal << 31) >>> 0;
          vN = msVal & ((1 << mN) - 1);
          vN |= ((inf >> 10) & 1) << mN;
          vN |= 1;
          val = (val | ((vN + 2) << (p - 1))) >>> 0;
        }
        decoded[dp] = val | 0;

        // bit 3: bottom sample of next column
        val = 0;
        vN = 0;
        if (inf & 128) {
          if (mBits < 32) {
            magsgn.tmpLo = mLo;
            magsgn.tmpHi = mHi;
            magsgn.bits = mBits;
            magsgn.pos = mPos;
            magsgn.size = mSize;
            magsgn.unstuff = mUnst;
            this._frwdFetch(magsgn);
            mLo = magsgn.tmpLo;
            mHi = magsgn.tmpHi;
            mBits = magsgn.bits;
            mPos = magsgn.pos;
            mSize = magsgn.size;
            mUnst = magsgn.unstuff;
          }
          const msVal = mLo >>> 0;
          const mN = uQ - ((inf >> 15) & 1);
          if (mN > 0) {
            mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
            mHi = mHi >>> mN;
          }
          mBits -= mN;
          val = (msVal << 31) >>> 0;
          vN = msVal & ((1 << mN) - 1);
          vN |= ((inf >> 11) & 1) << mN;
          vN |= 1;
          val = (val | ((vN + 2) << (p - 1))) >>> 0;
        }
        decoded[dp + stride] = val | 0;
        prevVN = vN;
        dp++;
        x++;
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
          if (UQ > mmsbp2) {
            return null;
          }

          let vN;
          // bit 0
          let val = 0;
          if (inf & 16) {
            if (mBits < 32) {
              magsgn.tmpLo = mLo;
              magsgn.tmpHi = mHi;
              magsgn.bits = mBits;
              magsgn.pos = mPos;
              magsgn.size = mSize;
              magsgn.unstuff = mUnst;
              this._frwdFetch(magsgn);
              mLo = magsgn.tmpLo;
              mHi = magsgn.tmpHi;
              mBits = magsgn.bits;
              mPos = magsgn.pos;
              mSize = magsgn.size;
              mUnst = magsgn.unstuff;
            }
            const msVal = mLo >>> 0;
            const mN = UQ - ((inf >> 12) & 1);
            if (mN > 0) {
              mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
              mHi = mHi >>> mN;
            }
            mBits -= mN;
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
          if (inf & 32) {
            if (mBits < 32) {
              magsgn.tmpLo = mLo;
              magsgn.tmpHi = mHi;
              magsgn.bits = mBits;
              magsgn.pos = mPos;
              magsgn.size = mSize;
              magsgn.unstuff = mUnst;
              this._frwdFetch(magsgn);
              mLo = magsgn.tmpLo;
              mHi = magsgn.tmpHi;
              mBits = magsgn.bits;
              mPos = magsgn.pos;
              mSize = magsgn.size;
              mUnst = magsgn.unstuff;
            }
            const msVal = mLo >>> 0;
            const mN = UQ - ((inf >> 13) & 1);
            if (mN > 0) {
              mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
              mHi = mHi >>> mN;
            }
            mBits -= mN;
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
          if (inf & 64) {
            if (mBits < 32) {
              magsgn.tmpLo = mLo;
              magsgn.tmpHi = mHi;
              magsgn.bits = mBits;
              magsgn.pos = mPos;
              magsgn.size = mSize;
              magsgn.unstuff = mUnst;
              this._frwdFetch(magsgn);
              mLo = magsgn.tmpLo;
              mHi = magsgn.tmpHi;
              mBits = magsgn.bits;
              mPos = magsgn.pos;
              mSize = magsgn.size;
              mUnst = magsgn.unstuff;
            }
            const msVal = mLo >>> 0;
            const mN = UQ - ((inf >> 14) & 1);
            if (mN > 0) {
              mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
              mHi = mHi >>> mN;
            }
            mBits -= mN;
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
          if (inf & 128) {
            if (mBits < 32) {
              magsgn.tmpLo = mLo;
              magsgn.tmpHi = mHi;
              magsgn.bits = mBits;
              magsgn.pos = mPos;
              magsgn.size = mSize;
              magsgn.unstuff = mUnst;
              this._frwdFetch(magsgn);
              mLo = magsgn.tmpLo;
              mHi = magsgn.tmpHi;
              mBits = magsgn.bits;
              mPos = magsgn.pos;
              mSize = magsgn.size;
              mUnst = magsgn.unstuff;
            }
            const msVal = mLo >>> 0;
            const mN = UQ - ((inf >> 15) & 1);
            if (mN > 0) {
              mLo = ((mLo >>> mN) | (mHi << (32 - mN))) >>> 0;
              mHi = mHi >>> mN;
            }
            mBits -= mN;
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
      // Re-arrange quad significance into column significance.
      // Each ui16 in sigma holds 8 columns x 4 rows of significance bits;
      // each nibble represents one column of 4 rows.
      let mstr = (width + 3) >>> 2; // entries per row in sigma (one per 4 columns)
      mstr = (mstr + 2 + 7) & ~7; // multiples of 8 with padding
      const sigma = scratch; // alias; overwrites VLC step data (no longer needed)
      const sigmaRows = ((height + 3) >>> 2) + 1;
      const sigmaTotal = mstr * sigmaRows;
      if (sigmaTotal > scratch.length) {
        // Should never happen given scratchSize sizing, but guard.
        return null;
      }
      {
        let y;
        for (y = 0; y < height; y += 4) {
          let spIdx = (y >> 1) * sstr;
          let dpIdx = (y >> 2) * mstr;
          const haveBelow = y + 2 < height;
          for (let x = 0; x < width; x += 4, spIdx += 4, dpIdx++) {
            let t0 = 0,
              t1 = 0;
            const s0 = scratch[spIdx];
            const s2 = scratch[spIdx + 2];
            t0 = ((s0 & 0x30) >>> 4) | ((s0 & 0xc0) >>> 2);
            t0 |= ((s2 & 0x30) << 4) | ((s2 & 0xc0) << 6);
            if (haveBelow) {
              const s0b = scratch[spIdx + sstr];
              const s2b = scratch[spIdx + sstr + 2];
              t1 = ((s0b & 0x30) >>> 2) | (s0b & 0xc0);
              t1 |= ((s2b & 0x30) << 6) | ((s2b & 0xc0) << 8);
            }
            sigma[dpIdx] = (t0 | t1) & 0xffff;
          }
          sigma[dpIdx] = 0; // right-padding column
        }
        // Reset one row after the codeblock
        let dpIdx = (y >> 2) * mstr;
        for (let x = 0; x < width; x += 4, dpIdx++) {
          sigma[dpIdx] = 0;
        }
        sigma[dpIdx] = 0;
      }

      // Significance Propagation Pass
      const stripeCausal = false; // TODO: plumb from cod_mode bit (HT block decoder default = false)
      const prevRowSig = this._prevRowSig;
      if (prevRowSig.length < mstr + 2) {
        this._prevRowSig = new Uint16Array(mstr + 8);
      }
      const prs = this._prevRowSig;
      prs.fill(0);
      {
        this._frwdInit2(this._sppState, codedData, offset + lengths1, lengths2, 0);
        for (let y = 0; y < height; y += 4) {
          let pattern = 0xffff;
          if (height - y < 4) {
            pattern = 0x7777;
            if (height - y < 3) {
              pattern = 0x3333;
              if (height - y < 2) {
                pattern = 0x1111;
              }
            }
          }
          let prev = 0;
          let prevSigIdx = 0;
          let curSigIdx = (y >> 2) * mstr;
          let dppIdx = y * stride;
          for (let x = 0; x < width; x += 4, curSigIdx++, prevSigIdx++) {
            let s = x + 4 - width;
            if (s < 0) {
              s = 0;
            }
            pattern = (pattern >>> (s * 4)) >>> 0;

            // Read 32-bit chunks from ui16 buffers (little-endian semantics).
            const ps = (prs[prevSigIdx] | (prs[prevSigIdx + 1] << 16)) >>> 0;
            const nsLo = curSigIdx + mstr < sigmaTotal ? sigma[curSigIdx + mstr] : 0;
            const nsHi = curSigIdx + mstr + 1 < sigmaTotal ? sigma[curSigIdx + mstr + 1] : 0;
            const ns = (nsLo | (nsHi << 16)) >>> 0;

            let u = (ps & 0x88888888) >>> 3; // row on top
            if (!stripeCausal) {
              u = (u | ((ns & 0x11111111) << 3)) >>> 0; // row below
            }

            const cs = (sigma[curSigIdx] | (sigma[curSigIdx + 1] << 16)) >>> 0;

            // Vertical integration
            let mbr = cs;
            mbr = (mbr | ((cs & 0x77777777) << 1)) >>> 0;
            mbr = (mbr | ((cs & 0xeeeeeeee) >>> 1)) >>> 0;
            mbr = (mbr | u) >>> 0;
            // Horizontal integration
            let tH = mbr;
            mbr = (mbr | (tH << 4)) >>> 0;
            mbr = (mbr | (tH >>> 4)) >>> 0;
            mbr = (mbr | (prev >>> 12)) >>> 0;
            // Remove out-of-stripe and already-significant samples
            mbr = (mbr & pattern) >>> 0;
            mbr = (mbr & ~cs) >>> 0;

            let newSig = mbr;
            if (newSig !== 0) {
              let cwd = this._frwdFetch2(this._sppState);
              let cnt = 0;
              let colMask = 0xf;
              const invSig = (~cs & pattern) >>> 0;
              for (let i = 0; i < 16; i += 4, colMask = (colMask << 4) >>> 0) {
                if ((colMask & newSig) === 0) {
                  continue;
                }
                let sampleMask = (0x1111 & colMask) >>> 0;
                if (newSig & sampleMask) {
                  newSig = (newSig & ~sampleMask) >>> 0;
                  if (cwd & 1) {
                    const t = (0x33 << i) >>> 0;
                    newSig = (newSig | (t & invSig)) >>> 0;
                  }
                  cwd >>>= 1;
                  cnt++;
                }
                sampleMask = (sampleMask << 1) >>> 0;
                if (newSig & sampleMask) {
                  newSig = (newSig & ~sampleMask) >>> 0;
                  if (cwd & 1) {
                    const t = (0x76 << i) >>> 0;
                    newSig = (newSig | (t & invSig)) >>> 0;
                  }
                  cwd >>>= 1;
                  cnt++;
                }
                sampleMask = (sampleMask << 1) >>> 0;
                if (newSig & sampleMask) {
                  newSig = (newSig & ~sampleMask) >>> 0;
                  if (cwd & 1) {
                    const t = (0xec << i) >>> 0;
                    newSig = (newSig | (t & invSig)) >>> 0;
                  }
                  cwd >>>= 1;
                  cnt++;
                }
                sampleMask = (sampleMask << 1) >>> 0;
                if (newSig & sampleMask) {
                  newSig = (newSig & ~sampleMask) >>> 0;
                  if (cwd & 1) {
                    const t = (0xc8 << i) >>> 0;
                    newSig = (newSig | (t & invSig)) >>> 0;
                  }
                  cwd >>>= 1;
                  cnt++;
                }
              }
              if (newSig !== 0) {
                // Write signs to decoded[] for newly-significant samples
                const val = (3 << (p - 2)) >>> 0;
                let dp = dppIdx + x;
                let colMask2 = 0xf;
                for (let i = 0; i < 4; i++, dp++, colMask2 = (colMask2 << 4) >>> 0) {
                  if ((colMask2 & newSig) === 0) {
                    continue;
                  }
                  let sampleMask = (0x1111 & colMask2) >>> 0;
                  if (newSig & sampleMask) {
                    decoded[dp] = ((cwd & 1) << 31) | val | 0;
                    cwd >>>= 1;
                    cnt++;
                  }
                  sampleMask = (sampleMask + sampleMask) >>> 0;
                  if (newSig & sampleMask) {
                    decoded[dp + stride] = ((cwd & 1) << 31) | val | 0;
                    cwd >>>= 1;
                    cnt++;
                  }
                  sampleMask = (sampleMask + sampleMask) >>> 0;
                  if (newSig & sampleMask) {
                    decoded[dp + 2 * stride] = ((cwd & 1) << 31) | val | 0;
                    cwd >>>= 1;
                    cnt++;
                  }
                  sampleMask = (sampleMask + sampleMask) >>> 0;
                  if (newSig & sampleMask) {
                    decoded[dp + 3 * stride] = ((cwd & 1) << 31) | val | 0;
                    cwd >>>= 1;
                    cnt++;
                  }
                }
              }
              this._frwdAdvance2(this._sppState, cnt);
            }

            newSig = (newSig | cs) >>> 0;
            // Store low 16 bits and high 16 bits as two ui16 (only low row used by prev_row_sig)
            // The C stores only one ui16 here: *prev_sig = (ui16)(new_sig); meaning prev_row_sig
            // holds the low 16 bits. But the 32-bit read above uses pairs.
            prs[prevSigIdx] = newSig & 0xffff;

            // Vertical integration for new sig
            const tNs = newSig;
            newSig = (newSig | ((tNs & 0x7777) << 1)) >>> 0;
            newSig = (newSig | ((tNs & 0xeeee) >>> 1)) >>> 0;
            prev = (newSig | u) >>> 0;
            prev = (prev & 0xf000) >>> 0;
          }
        }
      }

      // Magnitude Refinement Pass
      if (numPasses > 2) {
        this._mrpInit(codedData, offset, lengths1, lengths2);
        const magref = this._mrpState;
        const half = (1 << (p - 2)) >>> 0;
        for (let y = 0; y < height; y += 4) {
          const sigRowIdx = (y >> 2) * mstr;
          const dppIdx = y * stride;
          for (let i = 0; i < width; i += 8) {
            const sigIdx = sigRowIdx + (i >>> 2);
            const cwdInit = this._mrpFetch(magref);
            let cwd = cwdInit;
            // Read 32 bits from sigma at this position (two ui16)
            const sig = (sigma[sigIdx] | (sigma[sigIdx + 1] << 16)) >>> 0;
            let colMask = 0xf;
            if (sig !== 0) {
              for (let j = 0; j < 8; j++) {
                if (sig & colMask) {
                  const dpBase = dppIdx + i + j;
                  let sampleMask = (0x11111111 & colMask) >>> 0;
                  for (let k = 0; k < 4; k++) {
                    if (sig & sampleMask) {
                      const dpK = dpBase + k * stride;
                      let sym = cwd & 1;
                      sym = ((1 - sym) << (p - 1)) >>> 0;
                      sym = (sym | half) >>> 0;
                      decoded[dpK] = (decoded[dpK] ^ sym) | 0;
                      cwd >>>= 1;
                    }
                    sampleMask = (sampleMask + sampleMask) >>> 0;
                  }
                }
                colMask = (colMask << 4) >>> 0;
              }
            }
            this._mrpAdvance(magref, this._popCount32(sig));
          }
        }
      }
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
    const st = this._melState;
    st.data = data;
    st.pos = offset + lcup - scup;
    st.tmpHi = 0;
    st.tmpLo = 0;
    st.bits = 0;
    st.size = scup - 1;
    st.unstuff = false;
    st.k = 0;
    st.runsHead = 0;
    st.runsTail = 0;
    // prime the buffer: read bytes to align
    const align = 4 - ((offset + lcup - scup) & 3);
    for (let i = 0; i < align; i++) {
      let d;
      if (st.size > 0) {
        d = data[st.pos++];
        st.size--;
        if (st.size === 0) {
          d |= 0x0f; // last byte before VLC: pad LSBs with 0xF
        }
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
    while (st.bits >= 6 && st.runsTail - st.runsHead < 8) {
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
      st.runsArr[st.runsTail & 7] = run;
      st.runsTail++;
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
    if (st.runsTail === st.runsHead) {
      this._melDecode(st);
    }

    return st.runsTail > st.runsHead ? st.runsArr[st.runsHead++ & 7] : 0;
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
    const st = this._vlcState;
    st.data = data;
    st.pos = offset + lcup - 2;
    st.tmpHi = 0;
    st.tmpLo = 0;
    st.bits = 0;
    st.size = scup - 2;
    st.unstuff = false;
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
    // Hoist state fields to locals; inline _appendBottomBits -> _orWordAt.
    let pos = st.pos;
    let size = st.size;
    let unstuff = st.unstuff;
    let tmpLo = st.tmpLo;
    let tmpHi = st.tmpHi;
    let bits = st.bits;
    const data = st.data;

    // Fast path: unstuffed stream with >= 4 real bytes, none > 0x8f (a byte
    // > 0x8f forces bit stuffing on the following byte). All four bytes
    // contribute 8 bits and unstuff stays cleared: merge as one word.
    if (!unstuff && size >= 4) {
      const d0 = data[pos];
      const d1 = data[pos - 1];
      const d2 = data[pos - 2];
      const d3 = data[pos - 3];
      if (d0 <= 0x8f && d1 <= 0x8f && d2 <= 0x8f && d3 <= 0x8f) {
        const w = (d0 | (d1 << 8) | (d2 << 16) | (d3 << 24)) >>> 0;
        pos -= 4;
        size -= 4;
        if (bits >= 32) {
          tmpHi = (tmpHi | ((w << (bits - 32)) >>> 0)) >>> 0;
        } else {
          tmpLo = (tmpLo | (w << bits)) >>> 0;
          if (bits !== 0) {
            tmpHi = (tmpHi | (w >>> (32 - bits))) >>> 0;
          }
        }
        bits += 32;
        st.pos = pos;
        st.size = size;
        st.tmpLo = tmpLo;
        st.tmpHi = tmpHi;
        st.bits = bits;
        return;
      }
    }

    for (let i = 0; i < 4; i++) {
      let d = 0;
      if (size > 0) {
        d = data[pos--];
        size--;
      }

      const dBits = unstuff && (d & 0x7f) === 0x7f ? 7 : 8;
      // Inlined _orWordAt(st, d, bits)
      if (d !== 0) {
        const shift = bits;
        if (shift < 32) {
          tmpLo = (tmpLo | ((d << shift) >>> 0)) >>> 0;
          if (shift !== 0) {
            tmpHi = (tmpHi | (d >>> (32 - shift))) >>> 0;
          }
        } else if (shift === 32) {
          tmpHi = (tmpHi | d) >>> 0;
        } else {
          tmpHi = (tmpHi | ((d << (shift - 32)) >>> 0)) >>> 0;
        }
      }
      bits += dBits;
      unstuff = d > 0x8f;
    }
    st.pos = pos;
    st.size = size;
    st.unstuff = unstuff;
    st.tmpLo = tmpLo;
    st.tmpHi = tmpHi;
    st.bits = bits;
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
   * @param {Object} st - Bit-buffer state.
   * @param {number} numBits - Number of bits to advance.
   * @returns {number} Next 32 bits of VLC data after advancing.
   */
  _revAdvance(st, numBits) {
    // Inlined _shiftStateRight (fast path for typical numBits < 32).
    if (numBits > 0) {
      if (numBits < 32) {
        st.tmpLo = ((st.tmpLo >>> numBits) | ((st.tmpHi << (32 - numBits)) >>> 0)) >>> 0;
        st.tmpHi = st.tmpHi >>> numBits;
      } else if (numBits < 64) {
        st.tmpLo = st.tmpHi >>> (numBits - 32);
        st.tmpHi = 0;
      } else {
        st.tmpHi = 0;
        st.tmpLo = 0;
      }
    }
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
    const st = this._frwdState;
    st.data = data;
    st.pos = offset;
    st.tmpHi = 0;
    st.tmpLo = 0;
    st.bits = 0;
    st.size = size;
    st.unstuff = 0;
    st.fillByte = fillByte;
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
    // Hoist state fields to locals; inline _appendBottomBits -> _orWordAt.
    let pos = st.pos;
    let size = st.size;
    let unstuff = st.unstuff;
    let tmpLo = st.tmpLo;
    let tmpHi = st.tmpHi;
    let bits = st.bits;
    const data = st.data;
    const fillByte = st.fillByte;

    // Fast path: unstuffed stream with >= 4 real bytes, none equal to 0xff.
    // All four bytes contribute 8 bits each and unstuff stays cleared, so the
    // 32-bit little-endian word is merged in a single step.
    if (unstuff === 0 && size >= 4) {
      const d0 = data[pos];
      const d1 = data[pos + 1];
      const d2 = data[pos + 2];
      const d3 = data[pos + 3];
      if (d0 !== 0xff && d1 !== 0xff && d2 !== 0xff && d3 !== 0xff) {
        const w = (d0 | (d1 << 8) | (d2 << 16) | (d3 << 24)) >>> 0;
        pos += 4;
        size -= 4;
        if (bits >= 32) {
          tmpHi = (tmpHi | ((w << (bits - 32)) >>> 0)) >>> 0;
        } else {
          tmpLo = (tmpLo | (w << bits)) >>> 0;
          if (bits !== 0) {
            tmpHi = (tmpHi | (w >>> (32 - bits))) >>> 0;
          }
        }
        bits += 32;
        st.pos = pos;
        st.size = size;
        st.tmpLo = tmpLo;
        st.tmpHi = tmpHi;
        st.bits = bits;
        return;
      }
    }

    for (let i = 0; i < 4; i++) {
      let d = fillByte;
      if (size > 0) {
        d = data[pos++];
        size--;
      }

      const dBits = 8 - unstuff;
      // Inlined _orWordAt(st, d, bits)
      if (d !== 0) {
        const shift = bits;
        if (shift < 32) {
          tmpLo = (tmpLo | ((d << shift) >>> 0)) >>> 0;
          if (shift !== 0) {
            tmpHi = (tmpHi | (d >>> (32 - shift))) >>> 0;
          }
        } else if (shift === 32) {
          tmpHi = (tmpHi | d) >>> 0;
        } else {
          tmpHi = (tmpHi | ((d << (shift - 32)) >>> 0)) >>> 0;
        }
      }
      bits += dBits;
      unstuff = d === 0xff ? 1 : 0;
    }
    st.pos = pos;
    st.size = size;
    st.unstuff = unstuff;
    st.tmpLo = tmpLo;
    st.tmpHi = tmpHi;
    st.bits = bits;
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
    // Inlined _shiftStateRight (fast path for typical numBits < 32).
    if (numBits > 0) {
      if (numBits < 32) {
        st.tmpLo = ((st.tmpLo >>> numBits) | ((st.tmpHi << (32 - numBits)) >>> 0)) >>> 0;
        st.tmpHi = st.tmpHi >>> numBits;
      } else if (numBits < 64) {
        st.tmpLo = st.tmpHi >>> (numBits - 32);
        st.tmpHi = 0;
      } else {
        st.tmpHi = 0;
        st.tmpLo = 0;
      }
    }
    st.bits -= numBits;
  }

  /**
   * Forward reader init that accepts an explicit state (used for SPP).
   * @private
   */
  _frwdInit2(st, data, offset, size, fillByte) {
    st.data = data;
    st.pos = offset;
    st.tmpHi = 0;
    st.tmpLo = 0;
    st.bits = 0;
    st.size = size;
    st.unstuff = 0;
    st.fillByte = fillByte;
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
   * Forward reader fetch with explicit state.
   * @private
   */
  _frwdFetch2(st) {
    if (st.bits < 32) {
      this._frwdRead(st);
      if (st.bits < 32) {
        this._frwdRead(st);
      }
    }

    return st.tmpLo >>> 0;
  }

  /**
   * Forward reader advance with explicit state.
   * @private
   */
  _frwdAdvance2(st, numBits) {
    if (numBits > 0) {
      if (numBits < 32) {
        st.tmpLo = ((st.tmpLo >>> numBits) | ((st.tmpHi << (32 - numBits)) >>> 0)) >>> 0;
        st.tmpHi = st.tmpHi >>> numBits;
      } else if (numBits < 64) {
        st.tmpLo = st.tmpHi >>> (numBits - 32);
        st.tmpHi = 0;
      } else {
        st.tmpHi = 0;
        st.tmpLo = 0;
      }
    }
    st.bits -= numBits;
  }

  /**
   * Initialize the MRP backward reader.
   * @private
   */
  _mrpInit(data, offset, lcup, len2) {
    const st = this._mrpState;
    st.data = data;
    st.pos = offset + lcup + len2 - 1;
    st.size = len2;
    st.unstuff = true;
    st.bits = 0;
    st.tmpHi = 0;
    st.tmpLo = 0;
    for (let i = 0; i < 4; i++) {
      let d = 0;
      if (st.size > 0) {
        d = data[st.pos--];
      }
      st.size--;
      const dBits = st.unstuff && (d & 0x7f) === 0x7f ? 7 : 8;
      this._appendBottomBits(st, d, dBits);
      st.unstuff = d > 0x8f;
    }
    this._mrpRead(st);

    return st;
  }

  /**
   * Read and unstuff up to 4 bytes from the MRP backward stream.
   * Zero-fills when the segment is exhausted.
   * @private
   */
  _mrpRead(st) {
    if (st.bits > 32) {
      return;
    }
    let pos = st.pos;
    let size = st.size;
    let unstuff = st.unstuff;
    let tmpLo = st.tmpLo;
    let tmpHi = st.tmpHi;
    let bits = st.bits;
    const data = st.data;
    for (let i = 0; i < 4; i++) {
      let d = 0;
      if (size > 0) {
        d = data[pos--];
      }
      size--;
      const dBits = unstuff && (d & 0x7f) === 0x7f ? 7 : 8;
      if (d !== 0) {
        const shift = bits;
        if (shift < 32) {
          tmpLo = (tmpLo | ((d << shift) >>> 0)) >>> 0;
          if (shift !== 0) {
            tmpHi = (tmpHi | (d >>> (32 - shift))) >>> 0;
          }
        } else if (shift === 32) {
          tmpHi = (tmpHi | d) >>> 0;
        } else {
          tmpHi = (tmpHi | ((d << (shift - 32)) >>> 0)) >>> 0;
        }
      }
      bits += dBits;
      unstuff = d > 0x8f;
    }
    st.pos = pos;
    st.size = size;
    st.unstuff = unstuff;
    st.tmpLo = tmpLo;
    st.tmpHi = tmpHi;
    st.bits = bits;
  }

  /**
   * Fetch up to 32 bits from the MRP backward reader.
   * @private
   */
  _mrpFetch(st) {
    if (st.bits < 32) {
      this._mrpRead(st);
      if (st.bits < 32) {
        this._mrpRead(st);
      }
    }

    return st.tmpLo >>> 0;
  }

  /**
   * Consume bits from the MRP backward reader.
   * @private
   */
  _mrpAdvance(st, numBits) {
    if (numBits > 0) {
      if (numBits < 32) {
        st.tmpLo = ((st.tmpLo >>> numBits) | ((st.tmpHi << (32 - numBits)) >>> 0)) >>> 0;
        st.tmpHi = st.tmpHi >>> numBits;
      } else if (numBits < 64) {
        st.tmpLo = st.tmpHi >>> (numBits - 32);
        st.tmpHi = 0;
      } else {
        st.tmpHi = 0;
        st.tmpLo = 0;
      }
    }
    st.bits -= numBits;
  }

  /**
   * Population count for a 32-bit value.
   * @private
   */
  _popCount32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);

    return ((((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24) >>> 0;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = BlockDecoder;
//#endregion
