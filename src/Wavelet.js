//#region Wavelet
class Wavelet {
  /**
   * Creates an instance of Wavelet.
   * @constructor
   */
  constructor() {
    this.CDF97_ALPHA = -1.586134342059924;
    this.CDF97_BETA = -0.052980118572961;
    this.CDF97_GAMMA = 0.882911075530934;
    this.CDF97_DELTA = 0.443506852043971;
    this.CDF97_K = 1.230174104914001;
    this._scratchLw = new Float64Array(0);
    this._scratchHw = new Float64Array(0);
    this.CDF97_INV_K = 1.0 / this.CDF97_K;
    this._bound1dRev53 = this._iDwt1dRev53.bind(this);
    this._bound1dIrv97 = this._iDwt1dIrv97.bind(this);
    this._bound1dRev53Offset = this._iDwt1dRev53Offset.bind(this);
    this._bound1dIrv97Offset = this._iDwt1dIrv97Offset.bind(this);
    // Reusable buffers for 2D transform
    this._rowL = new Float64Array(0);
    this._rowH = new Float64Array(0);
    this._vertL = new Float64Array(0);
    this._vertH = new Float64Array(0);
    this._colInL = new Float64Array(0);
    this._colInH = new Float64Array(0);
    this._colOut = new Float64Array(0);
    this._blockL = new Float64Array(0);
    this._blockH = new Float64Array(0);
    this._blockOut = new Float64Array(0);
  }

  /**
   * Perform a full multi-resolution IDWT for one tile-component.
   * @method
   * @param {Array} resolutions - Array of resolution level descriptors, from coarsest to finest.
   * @param {number} resolutions[].width - Width of this resolution level.
   * @param {number} resolutions[].height - Height of this resolution level.
   * @param {Float64Array} [resolutions[].ll] - LL sub-band coefficients (coarsest level only).
   * @param {Float64Array} [resolutions[].hl] - HL sub-band coefficients.
   * @param {Float64Array} [resolutions[].lh] - LH sub-band coefficients.
   * @param {Float64Array} [resolutions[].hh] - HH sub-band coefficients.
   * @param {boolean} isReversible - true for 5/3 Le Gall, false for 9/7 CDF.
   * @returns {Float64Array} Reconstructed samples of size (full width × full height).
   */
  iDwt2d(resolutions, isReversible) {
    const numLevels = resolutions.length;
    if (numLevels === 0) {
      return new Float64Array(0);
    }

    let current = resolutions[0].ll;

    for (let r = 1; r < numLevels; r++) {
      const res = resolutions[r];
      const resW = res.width;
      const resH = res.height;
      const lWid = Math.ceil(resW / 2);
      const lHgt = Math.ceil(resH / 2);
      const hWid = Math.floor(resW / 2);
      const hHgt = Math.floor(resH / 2);

      current = this._iDwt2dLevel(
        current,
        res.hl || new Float64Array(hWid * lHgt),
        res.lh || new Float64Array(lWid * hHgt),
        res.hh || new Float64Array(hWid * hHgt),
        resW,
        resH,
        isReversible
      );
    }

    return current;
  }

  //#region Private Methods
  /**
   * Apply Le Gall 5/3 IDWT (reversible) to an interleaved output array.
   * @method
   * @private
   * @param {Float64Array} l - Low-band samples.
   * @param {Float64Array} h - High-band samples.
   * @param {number} lLen - Number of low-band samples.
   * @param {number} hLen - Number of high-band samples.
   * @param {Float64Array} out - Output array of length lLen + hLen.
   */
  _iDwt1dRev53(l, h, lLen, hLen, out) {
    if (lLen + hLen === 0) {
      return;
    }
    if (hLen === 0) {
      out[0] = l[0];
      return;
    }

    if (this._scratchLw.length < lLen) {
      this._scratchLw = new Float64Array(lLen);
    }
    if (this._scratchHw.length < hLen) {
      this._scratchHw = new Float64Array(hLen);
    }
    const lw = this._scratchLw;
    const hw = this._scratchHw;
    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? h[n - 1] : h[0];
      const hn = n < hLen ? h[n] : h[hLen - 1];
      lw[n] = l[n] - ((hm + hn + 2) >> 2);
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      hw[n] = h[n] + ((lw[n] + lp) >> 1);
    }
    for (let n = 0; n < lLen; n++) {
      out[2 * n] = lw[n];
    }
    for (let n = 0; n < hLen; n++) {
      out[2 * n + 1] = hw[n];
    }
  }

  /**
   * Apply CDF 9/7 IDWT (irreversible) to an interleaved output array.
   * @method
   * @private
   * @param {Float64Array} l - Low-band samples.
   * @param {Float64Array} h - High-band samples.
   * @param {number} lLen - Number of low-band samples.
   * @param {number} hLen - Number of high-band samples.
   * @param {Float64Array} out - Output array of length lLen + hLen.
   */
  _iDwt1dIrv97(l, h, lLen, hLen, out) {
    if (lLen + hLen === 0) {
      return;
    }
    if (hLen === 0) {
      out[0] = l[0];
      return;
    }

    if (this._scratchLw.length < lLen) {
      this._scratchLw = new Float64Array(lLen);
    }
    if (this._scratchHw.length < hLen) {
      this._scratchHw = new Float64Array(hLen);
    }
    const lw = this._scratchLw;
    const hw = this._scratchHw;
    for (let n = 0; n < lLen; n++) {
      lw[n] = l[n] * this.CDF97_K;
    }
    for (let n = 0; n < hLen; n++) {
      hw[n] = h[n] / this.CDF97_K;
    }

    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? hw[n - 1] : hw[0];
      const hn = n < hLen ? hw[n] : hw[hLen - 1];
      lw[n] -= this.CDF97_DELTA * (hm + hn);
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      hw[n] -= this.CDF97_GAMMA * (lw[n] + lp);
    }
    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? hw[n - 1] : hw[0];
      const hn = n < hLen ? hw[n] : hw[hLen - 1];
      lw[n] -= this.CDF97_BETA * (hm + hn);
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      hw[n] -= this.CDF97_ALPHA * (lw[n] + lp);
    }
    for (let n = 0; n < lLen; n++) {
      out[2 * n] = lw[n];
    }
    for (let n = 0; n < hLen; n++) {
      out[2 * n + 1] = hw[n];
    }
  }

  /**
   * Offset-based Le Gall 5/3 IDWT — reads/writes at array offsets to avoid subarray.
   * Boundary cases are peeled so inner loops are branch-free. Arithmetic per
   * sample is unchanged (bit-exact vs. the naive formulation).
   * @method
   * @private
   * @param {Float64Array} lSrc - Low-band samples source array.
   * @param {number} lOff - Offset of low-band samples in source array.
   * @param {Float64Array} hSrc - High-band samples source array.
   * @param {number} hOff - Offset of high-band samples in source array.
   * @param {number} lLen - Number of low-band samples.
   * @param {number} hLen - Number of high-band samples.
   * @param {Float64Array} out - Output array of length lLen + hLen.
   * @param {number} outOff - Offset for output samples in output array.
   * @param {number} [stride] - Stride between consecutive output samples (default 1).
   */
  _iDwt1dRev53Offset(lSrc, lOff, hSrc, hOff, lLen, hLen, out, outOff, stride) {
    if (lLen + hLen === 0) {
      return;
    }
    if (hLen === 0) {
      out[outOff] = lSrc[lOff];
      return;
    }

    if (this._scratchLw.length < lLen) {
      this._scratchLw = new Float64Array(lLen);
    }
    const lw = this._scratchLw;
    const st = stride === undefined ? 1 : stride;

    // lLen >= 1 and hLen >= 1 here; hLen is lLen or lLen - 1.
    // Update low band: lw[n] = l[n] - ((h[n-1] + h[n] + 2) >> 2) with
    // edge extension h[-1] -> h[0], h[hLen] -> h[hLen-1].
    let v = lSrc[lOff] - ((hSrc[hOff] + hSrc[hOff] + 2) >> 2);
    lw[0] = v;
    out[outOff] = v;
    const nMid = lLen < hLen ? lLen : hLen;
    for (let n = 1; n < nMid; n++) {
      v = lSrc[lOff + n] - ((hSrc[hOff + n - 1] + hSrc[hOff + n] + 2) >> 2);
      lw[n] = v;
      out[outOff + st * (2 * n)] = v;
    }
    if (lLen > hLen) {
      const n = lLen - 1;
      v = lSrc[lOff + n] - ((hSrc[hOff + n - 1] + hSrc[hOff + n - 1] + 2) >> 2);
      lw[n] = v;
      out[outOff + st * (2 * n)] = v;
    }
    // Update high band: h[n] + ((lw[n] + lw[n+1]) >> 1) with lw[lLen] -> lw[lLen-1].
    for (let n = 0; n < hLen - 1; n++) {
      out[outOff + st * (2 * n + 1)] = hSrc[hOff + n] + ((lw[n] + lw[n + 1]) >> 1);
    }
    const nLast = hLen - 1;
    const lp = nLast + 1 < lLen ? lw[nLast + 1] : lw[lLen - 1];
    out[outOff + st * (2 * nLast + 1)] = hSrc[hOff + nLast] + ((lw[nLast] + lp) >> 1);
  }

  /**
   * Offset-based CDF 9/7 IDWT — reads/writes at array offsets to avoid subarray.
   * Implemented as a single left-to-right lifting pass with all rolling
   * lifting state in registers (L1 lags 1, H2/L2 emit with a bounded lag),
   * with edge cases peeled. Arithmetic per sample is unchanged (bit-exact
   * vs. the naive multi-pass formulation).
   * @method
   * @private
   * @param {Float64Array} lSrc - Low-band samples source array.
   * @param {number} lOff - Offset of low-band samples in source array.
   * @param {Float64Array} hSrc - High-band samples source array.
   * @param {number} hOff - Offset of high-band samples in source array.
   * @param {number} lLen - Number of low-band samples.
   * @param {number} hLen - Number of high-band samples.
   * @param {Float64Array} out - Output array of length lLen + hLen.
   * @param {number} outOff - Offset for output samples in output array.
   */
  _iDwt1dIrv97Offset(lSrc, lOff, hSrc, hOff, lLen, hLen, out, outOff) {
    if (lLen + hLen === 0) {
      return;
    }
    if (hLen === 0) {
      out[outOff] = lSrc[lOff];
      return;
    }

    const K = this.CDF97_K;
    const invK = this.CDF97_INV_K;
    const delta = this.CDF97_DELTA;
    const gamma = this.CDF97_GAMMA;
    const beta = this.CDF97_BETA;
    const alpha = this.CDF97_ALPHA;

    // lLen >= 1 and hLen >= 1 here; hLen is lLen or lLen - 1.
    let hwSprev = 0; // hSrc[n-1] * invK
    let lw1prev = 0; // L1[n-1]
    let hw1prev = 0; // H2[n-2]
    let lw2prev = 0; // L2[n-2]
    let hwSlast = 0; // hSrc[n] * invK of the final loop iteration

    for (let n = 0; n < lLen; n++) {
      const hwScur = n < hLen ? hSrc[hOff + n] * invK : hwSprev;
      const hm = n > 0 ? hwSprev : hwScur;
      const lw1 = lSrc[lOff + n] * K - delta * (hm + hwScur);

      if (n >= 1) {
        const m = n - 1;
        // H2[m] = hwS[m] - gamma*(L1[m] + L1[m+1]). For in-loop m <= lLen-2
        // the lp tap is always L1[m+1] (m+1 < lLen).
        const hw1 = hwSprev - gamma * (lw1prev + lw1);
        // L2[m] = L1[m] - beta*(hm + hn); hm clamps to H2[0] at m=0 (which is
        // hn itself), hn = H2[m].
        const lw2 = lw1prev - beta * (m > 0 ? hw1prev + hw1 : hw1 + hw1);
        out[outOff + 2 * m] = lw2;
        if (m >= 1) {
          // Alpha-emit pending H2[m-1] with taps L2[m-1], L2[m].
          out[outOff + 2 * (m - 1) + 1] = hw1prev - alpha * (lw2prev + lw2);
        }
        hw1prev = hw1;
        lw2prev = lw2;
      }

      lw1prev = lw1;
      hwSprev = hwScur;
      hwSlast = hwScur;
    }

    if (hLen === lLen) {
      // Even length: final H2 at m = lLen-1 (gamma lp clamps to L1[m]), final
      // L2, and the two final alpha emits.
      const m = lLen - 1;
      if (m === 0) {
        const hw1 = hwSlast - gamma * (lw1prev + lw1prev);
        const lw2 = lw1prev - beta * (hw1 + hw1);
        out[outOff] = lw2;
        out[outOff + 1] = hw1 - alpha * (lw2 + lw2);
      } else {
        const hw1 = hwSlast - gamma * (lw1prev + lw1prev);
        const lw2 = lw1prev - beta * (hw1prev + hw1);
        out[outOff + 2 * m] = lw2;
        out[outOff + 2 * (m - 1) + 1] = hw1prev - alpha * (lw2prev + lw2);
        out[outOff + 2 * m + 1] = hw1 - alpha * (lw2 + lw2);
      }
    } else {
      // Odd length (hLen = lLen - 1): final L2 row clamps both beta taps to
      // H2[lLen-2]; alpha-emit that pending H2 with lp = L2[lLen-1].
      const m = lLen - 1;
      const lw2 = lw1prev - beta * (hw1prev + hw1prev);
      out[outOff + 2 * m] = lw2;
      out[outOff + 2 * (m - 1) + 1] = hw1prev - alpha * (lw2prev + lw2);
    }
  }

  /**
   * Apply 2D inverse DWT for one resolution level.
   * @method
   * @private
   * @param {Float64Array} llBuf - LL sub-band coefficients.
   * @param {Float64Array} hlBuf - HL sub-band coefficients.
   * @param {Float64Array} lhBuf - LH sub-band coefficients.
   * @param {Float64Array} hhBuf - HH sub-band coefficients.
   * @param {number} resW - Target resolution width.
   * @param {number} resH - Target resolution height.
   * @param {boolean} isReversible - true for 5/3, false for 9/7.
   * @returns {Float64Array}
   */
  _iDwt2dLevel(llBuf, hlBuf, lhBuf, hhBuf, resW, resH, isReversible) {
    const idwt1dOff = isReversible ? this._bound1dRev53Offset : this._bound1dIrv97Offset;
    const out = new Float64Array(resW * resH);

    const lWid = Math.ceil(resW / 2);
    const hWid = Math.floor(resW / 2);
    const lHgt = Math.ceil(resH / 2);
    const hHgt = Math.floor(resH / 2);

    // Reuse vertical intermediate buffers
    if (this._vertL.length < lHgt * resW) {
      this._vertL = new Float64Array(lHgt * resW);
    }
    if (this._vertH.length < hHgt * resW) {
      this._vertH = new Float64Array(hHgt * resW);
    }
    const vertL = this._vertL;
    const vertH = this._vertH;

    // Horizontal transform — write directly to vertL/vertH (no intermediate copies)
    for (let y = 0; y < lHgt; y++) {
      idwt1dOff(llBuf, y * lWid, hlBuf, y * hWid, lWid, hWid, vertL, y * resW);
    }
    for (let y = 0; y < hHgt; y++) {
      idwt1dOff(lhBuf, y * lWid, hhBuf, y * hWid, lWid, hWid, vertH, y * resW);
    }

    // Vertical transform — streamed row by row. Columns are independent, so
    // lifting can operate on whole rows directly with a small rolling window,
    // reading vertL/vertH rows sequentially and writing contiguous output
    // rows. This avoids the transposed-block staging entirely.
    if (isReversible) {
      this._iDwtVerticalRev53(vertL, vertH, lHgt, hHgt, resW, out);
    } else {
      this._iDwtVerticalIrv97(vertL, vertH, lHgt, hHgt, resW, out);
    }

    return out;
  }

  /**
   * Ensure streaming vertical scratch rows exist for the given width.
   * @method
   * @private
   * @param {number} resW - Row width.
   * @param {number} count - Number of scratch rows needed.
   * @returns {Array<Float64Array>} Scratch row buffers.
   */
  _verticalRows(resW, count) {
    if (!this._vRows || this._vRows.length < count || this._vRowW < resW) {
      const n = Math.max(count, this._vRows ? this._vRows.length : 0);
      this._vRows = [];
      for (let i = 0; i < n; i++) {
        this._vRows.push(new Float64Array(resW));
      }
      this._vRowW = resW;
    }
    return this._vRows;
  }

  /**
   * Streamed row-based Le Gall 5/3 vertical IDWT.
   * Per-sample arithmetic matches _iDwt1dRev53Offset exactly.
   * @method
   * @private
   * @param {Float64Array} vertL - Low vertical band, lHgt rows of resW.
   * @param {Float64Array} vertH - High vertical band, hHgt rows of resW.
   * @param {number} lHgt - Number of low rows.
   * @param {number} hHgt - Number of high rows.
   * @param {number} resW - Row width.
   * @param {Float64Array} out - Output rows buffer (resH × resW).
   */
  _iDwtVerticalRev53(vertL, vertH, lHgt, hHgt, resW, out) {
    if (hHgt === 0) {
      for (let x = 0; x < resW; x++) {
        out[x] = vertL[x];
      }
      return;
    }
    const rows = this._verticalRows(resW, 2);
    let lwPrev = rows[0]; // lw[j-1]
    let lwCur = rows[1]; // lw[j]

    for (let j = 0; j < lHgt; j++) {
      const vL = j * resW;
      // hm row: j > 0 ? j-1 : 0 ; hn row: j < hHgt ? j : hHgt-1
      const hmBase = (j > 0 ? j - 1 : 0) * resW;
      const hnBase = (j < hHgt ? j : hHgt - 1) * resW;
      for (let x = 0; x < resW; x++) {
        lwCur[x] = vertL[vL + x] - ((vertH[hmBase + x] + vertH[hnBase + x] + 2) >> 2);
      }
      // Emit previous high row (h[j-1]) now that lw[j] is known.
      if (j > 0) {
        const hBase = (j - 1) * resW;
        const outOdd = (2 * (j - 1) + 1) * resW;
        for (let x = 0; x < resW; x++) {
          out[outOdd + x] = vertH[hBase + x] + ((lwPrev[x] + lwCur[x]) >> 1);
        }
      }
      // Emit low row j.
      const outEven = 2 * j * resW;
      for (let x = 0; x < resW; x++) {
        out[outEven + x] = lwCur[x];
      }
      const t = lwPrev;
      lwPrev = lwCur;
      lwCur = t;
    }
    // Even output height: the last high row (h[hHgt-1], hHgt === lHgt) uses
    // lp = lw[lHgt-1] (clamped), and lwPrev holds lw[lHgt-1] after the swap.
    if (hHgt === lHgt) {
      const j = hHgt - 1;
      const hBase = j * resW;
      const outOdd = (2 * j + 1) * resW;
      for (let x = 0; x < resW; x++) {
        out[outOdd + x] = vertH[hBase + x] + ((lwPrev[x] + lwPrev[x]) >> 1);
      }
    }
  }

  /**
   * Streamed row-based CDF 9/7 vertical IDWT.
   * Lifting stages are pipelined with a one-row lag: H2[m] is produced in
   * iteration m+1 once L1[m+1] exists; L2[m] is produced in the same
   * iteration; the alpha update for H2[m] is emitted in iteration m+2.
   * Per-sample arithmetic matches _iDwt1dIrv97Offset exactly.
   * @method
   * @private
   * @param {Float64Array} vertL - Low vertical band, lHgt rows of resW.
   * @param {Float64Array} vertH - High vertical band, hHgt rows of resW.
   * @param {number} lHgt - Number of low rows.
   * @param {number} hHgt - Number of high rows.
   * @param {number} resW - Row width.
   * @param {Float64Array} out - Output rows buffer (resH × resW).
   */
  _iDwtVerticalIrv97(vertL, vertH, lHgt, hHgt, resW, out) {
    if (hHgt === 0) {
      for (let x = 0; x < resW; x++) {
        out[x] = vertL[x];
      }
      return;
    }
    const K = this.CDF97_K;
    const invK = this.CDF97_INV_K;
    const delta = this.CDF97_DELTA;
    const gamma = this.CDF97_GAMMA;
    const beta = this.CDF97_BETA;
    const alpha = this.CDF97_ALPHA;

    const rows = this._verticalRows(resW, 6);
    let l1p = rows[0]; // L1[j-1]
    let l1c = rows[1]; // L1[j]
    const hA = rows[2]; // H2[m], m odd
    const hB = rows[3]; // H2[m], m even
    const l2A = rows[4]; // L2[m], m odd
    const l2B = rows[5]; // L2[m], m even

    for (let j = 0; j < lHgt; j++) {
      // L1[j] = vertL[j]*K - delta*(hwS[j-1] + hwS[j]) with edge clamps.
      const vL = j * resW;
      const hmBase = (j > 0 ? j - 1 : 0) * resW;
      const hnBase = (j < hHgt ? j : hHgt - 1) * resW;
      for (let x = 0; x < resW; x++) {
        const hm = vertH[hmBase + x] * invK;
        const hn = vertH[hnBase + x] * invK;
        l1c[x] = vertL[vL + x] * K - delta * (hm + hn);
      }

      if (j >= 1) {
        const m = j - 1;
        const hCur = m & 1 ? hA : hB;
        const hPrv = m & 1 ? hB : hA;
        const l2Cur = m & 1 ? l2A : l2B;
        const l2Prv = m & 1 ? l2B : l2A;
        const hBase = m * resW;
        const emitLow = 2 * m * resW;
        // m <= lHgt-2 <= hHgt-1, so H2[m] always exists here and the beta
        // hn tap is H2[m] itself.
        if (j >= 2) {
          const hPend = (m - 1) & 1 ? hA : hB;
          const emitHigh = (2 * m - 1) * resW;
          for (let x = 0; x < resW; x++) {
            const h2 = vertH[hBase + x] * invK - gamma * (l1p[x] + l1c[x]);
            hCur[x] = h2;
            const l2 = l1p[x] - beta * (hPrv[x] + h2);
            l2Cur[x] = l2;
            out[emitLow + x] = l2;
            out[emitHigh + x] = hPend[x] - alpha * (l2Prv[x] + l2);
          }
        } else {
          // m === 0: beta hm clamps to H2[0] itself; no pending alpha yet.
          for (let x = 0; x < resW; x++) {
            const h2 = vertH[hBase + x] * invK - gamma * (l1p[x] + l1c[x]);
            hCur[x] = h2;
            const l2 = l1p[x] - beta * (h2 + h2);
            l2Cur[x] = l2;
            out[emitLow + x] = l2;
          }
        }
      }

      const t = l1p;
      l1p = l1c;
      l1c = t;
    }

    // Tail (even resH, lHgt === hHgt): final H2/L2 pair.
    if (hHgt === lHgt) {
      const m = lHgt - 1;
      const hPrv = m & 1 ? hB : hA;
      const l2Prv = m & 1 ? l2B : l2A;
      const hBase = m * resW;
      const emitLow = 2 * m * resW;
      const emitHigh = (2 * m + 1) * resW;
      if (m === 0) {
        // lHgt === hHgt === 1: gamma lp and beta hm clamp to the only taps.
        for (let x = 0; x < resW; x++) {
          const h2 = vertH[hBase + x] * invK - gamma * (l1p[x] + l1p[x]);
          const l2 = l1p[x] - beta * (h2 + h2);
          out[emitLow + x] = l2;
          out[emitHigh + x] = h2 - alpha * (l2 + l2);
        }
      } else {
        // H2[m]: gamma lp clamps to L1[lHgt-1] = l1p.
        // L2[m]: beta hm = H2[m-1], hn = H2[m].
        // Alpha for H2[m]: lp2 clamps to L2[m]; pending H2[m-1] uses L2[m-1], L2[m].
        const hPend = (m - 1) & 1 ? hA : hB;
        for (let x = 0; x < resW; x++) {
          const h2 = vertH[hBase + x] * invK - gamma * (l1p[x] + l1p[x]);
          const l2 = l1p[x] - beta * (hPrv[x] + h2);
          out[emitLow + x] = l2;
          out[emitHigh + x] = h2 - alpha * (l2 + l2);
          out[(2 * m - 1) * resW + x] = hPend[x] - alpha * (l2Prv[x] + l2);
        }
      }
    } else {
      // Odd resH (hHgt = lHgt - 1): final L2 row (both beta taps clamp to
      // H2[hHgt-1] = H2[lHgt-2] = hPend), then the pending alpha emit for
      // that same H2 row using L2[lHgt-2] and the freshly computed L2[lHgt-1].
      const m = lHgt - 1;
      const hPend = (m - 1) & 1 ? hA : hB;
      const l2Prv = (m - 1) & 1 ? l2A : l2B;
      const emitLow = 2 * m * resW;
      const emitHigh = (2 * m - 1) * resW;
      for (let x = 0; x < resW; x++) {
        const l2 = l1p[x] - beta * (hPend[x] + hPend[x]);
        out[emitLow + x] = l2;
        out[emitHigh + x] = hPend[x] - alpha * (l2Prv[x] + l2);
      }
    }
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Wavelet;
//#endregion
