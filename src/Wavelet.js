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
   * Offset-based CDF 9/7 IDWT — reads/writes at array offsets to avoid subarray.
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
  _iDwt1dRev53Offset(lSrc, lOff, hSrc, hOff, lLen, hLen, out, outOff) {
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

    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? hSrc[hOff + n - 1] : hSrc[hOff];
      const hn = n < hLen ? hSrc[hOff + n] : hSrc[hOff + hLen - 1];
      lw[n] = lSrc[lOff + n] - ((hm + hn + 2) >> 2);
    }
    for (let n = 0; n < lLen; n++) {
      out[outOff + 2 * n] = lw[n];
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      out[outOff + 2 * n + 1] = hSrc[hOff + n] + ((lw[n] + lp) >> 1);
    }
  }

  /**
   * Offset-based CDF 9/7 IDWT — reads/writes at array offsets to avoid subarray.
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

    if (this._scratchLw.length < lLen) {
      this._scratchLw = new Float64Array(lLen);
    }
    if (this._scratchHw.length < hLen) {
      this._scratchHw = new Float64Array(hLen);
    }
    const lw = this._scratchLw;
    const hw = this._scratchHw;
    const K = this.CDF97_K;
    const invK = this.CDF97_INV_K;
    const delta = this.CDF97_DELTA;
    const gamma = this.CDF97_GAMMA;
    const beta = this.CDF97_BETA;
    const alpha = this.CDF97_ALPHA;

    for (let n = 0; n < lLen; n++) {
      lw[n] = lSrc[lOff + n] * K;
    }
    for (let n = 0; n < hLen; n++) {
      hw[n] = hSrc[hOff + n] * invK;
    }

    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? hw[n - 1] : hw[0];
      const hn = n < hLen ? hw[n] : hw[hLen - 1];
      lw[n] -= delta * (hm + hn);
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      hw[n] -= gamma * (lw[n] + lp);
    }
    for (let n = 0; n < lLen; n++) {
      const hm = n > 0 ? hw[n - 1] : hw[0];
      const hn = n < hLen ? hw[n] : hw[hLen - 1];
      lw[n] -= beta * (hm + hn);
    }
    for (let n = 0; n < lLen; n++) {
      out[outOff + 2 * n] = lw[n];
    }
    for (let n = 0; n < hLen; n++) {
      const lp = n + 1 < lLen ? lw[n + 1] : lw[lLen - 1];
      out[outOff + 2 * n + 1] = hw[n] - alpha * (lw[n] + lp);
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

    // Vertical transform — blocked with transposed extraction for cache locality
    const BLOCK = 32;
    const blockLSize = lHgt * BLOCK;
    const blockHSize = hHgt * BLOCK;
    if (this._blockL.length < blockLSize) {
      this._blockL = new Float64Array(blockLSize);
    }
    if (this._blockH.length < blockHSize) {
      this._blockH = new Float64Array(blockHSize);
    }
    if (this._colOut.length < resH) {
      this._colOut = new Float64Array(resH);
    }
    // Transposed block output: row-major [resH][BLOCK] so final writes to `out` are contiguous.
    const blockOutSize = resH * BLOCK;
    if (this._blockOut.length < blockOutSize) {
      this._blockOut = new Float64Array(blockOutSize);
    }
    const blockL = this._blockL;
    const blockH = this._blockH;
    const colOut = this._colOut;
    const blockOut = this._blockOut;

    for (let xStart = 0; xStart < resW; xStart += BLOCK) {
      const bw = Math.min(BLOCK, resW - xStart);

      // Extract columns into transposed layout (each column contiguous)
      for (let y = 0; y < lHgt; y++) {
        const srcBase = y * resW + xStart;
        for (let dx = 0; dx < bw; dx++) {
          blockL[dx * lHgt + y] = vertL[srcBase + dx];
        }
      }
      for (let y = 0; y < hHgt; y++) {
        const srcBase = y * resW + xStart;
        for (let dx = 0; dx < bw; dx++) {
          blockH[dx * hHgt + y] = vertH[srcBase + dx];
        }
      }

      // Process each column from contiguous transposed data; transpose results
      // back into blockOut so the final write to `out` is contiguous (row-major).
      for (let dx = 0; dx < bw; dx++) {
        idwt1dOff(blockL, dx * lHgt, blockH, dx * hHgt, lHgt, hHgt, colOut, 0);
        for (let y = 0; y < resH; y++) {
          blockOut[y * BLOCK + dx] = colOut[y];
        }
      }

      // Contiguous row writes to the destination buffer.
      for (let y = 0; y < resH; y++) {
        const srcBase = y * BLOCK;
        const dstBase = y * resW + xStart;
        for (let dx = 0; dx < bw; dx++) {
          out[dstBase + dx] = blockOut[srcBase + dx];
        }
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
