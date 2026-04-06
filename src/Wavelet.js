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
    this._bound1dRev53 = this._iDwt1dRev53.bind(this);
    this._bound1dIrv97 = this._iDwt1dIrv97.bind(this);
    // Reusable buffers for 2D transform
    this._rowL = new Float64Array(0);
    this._rowH = new Float64Array(0);
    this._vertL = new Float64Array(0);
    this._vertH = new Float64Array(0);
    this._colInL = new Float64Array(0);
    this._colInH = new Float64Array(0);
    this._colOut = new Float64Array(0);
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

    if (this._scratchLw.length < lLen) this._scratchLw = new Float64Array(lLen);
    if (this._scratchHw.length < hLen) this._scratchHw = new Float64Array(hLen);
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

    if (this._scratchLw.length < lLen) this._scratchLw = new Float64Array(lLen);
    if (this._scratchHw.length < hLen) this._scratchHw = new Float64Array(hLen);
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
    const idwt1d = isReversible ? this._bound1dRev53 : this._bound1dIrv97;
    const out = new Float64Array(resW * resH);

    const lWid = Math.ceil(resW / 2);
    const hWid = Math.floor(resW / 2);
    const lHgt = Math.ceil(resH / 2);
    const hHgt = Math.floor(resH / 2);

    // Reuse buffers to reduce allocations
    if (this._rowL.length < resW) this._rowL = new Float64Array(resW);
    if (this._rowH.length < resW) this._rowH = new Float64Array(resW);
    if (this._vertL.length < lHgt * resW) this._vertL = new Float64Array(lHgt * resW);
    if (this._vertH.length < hHgt * resW) this._vertH = new Float64Array(hHgt * resW);
    const rowL = this._rowL;
    const rowH = this._rowH;
    const vertL = this._vertL;
    const vertH = this._vertH;

    // Horizontal transform - low frequency rows
    const emptyH = new Float64Array(0);
    for (let y = 0; y < lHgt; y++) {
      const yLWid = y * lWid;
      const lRow = llBuf.subarray(yLWid, yLWid + lWid);
      const hRow = hWid > 0 && hlBuf ? hlBuf.subarray(y * hWid, y * hWid + hWid) : emptyH;
      idwt1d(lRow, hRow, lWid, hWid, rowL);
      vertL.set(rowL, y * resW);
    }
    // Horizontal transform - high frequency rows
    for (let y = 0; y < hHgt; y++) {
      const yLWid = y * lWid;
      const lRow = lhBuf ? lhBuf.subarray(yLWid, yLWid + lWid) : emptyH;
      const hRow = hWid > 0 && hhBuf ? hhBuf.subarray(y * hWid, y * hWid + hWid) : emptyH;
      idwt1d(lRow, hRow, lWid, hWid, rowH);
      vertH.set(rowH, y * resW);
    }

    // Vertical transform - process columns
    if (this._colInL.length < lHgt) this._colInL = new Float64Array(lHgt);
    if (this._colInH.length < hHgt) this._colInH = new Float64Array(hHgt);
    if (this._colOut.length < resH) this._colOut = new Float64Array(resH);
    const colInL = this._colInL;
    const colInH = this._colInH;
    const colOut = this._colOut;

    for (let x = 0; x < resW; x++) {
      // Extract column with better cache locality
      for (let y = 0; y < lHgt; y++) {
        colInL[y] = vertL[y * resW + x];
      }
      for (let y = 0; y < hHgt; y++) {
        colInH[y] = vertH[y * resW + x];
      }
      idwt1d(colInL, colInH, lHgt, hHgt, colOut);
      // Write column back
      for (let y = 0; y < resH; y++) {
        out[y * resW + x] = colOut[y];
      }
    }

    return out;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Wavelet;
//#endregion
