//#region Wavelet
// Float32 constants from OpenJPEG's dwt.c, matched to the exact values the
// C code uses (opj_K, two_invK, and the four lifting steps as passed to
// opj_v8dwt_decode_step2 with the negated opj_dwt_* constants).
const OPJ97_K = Math.fround(1.230174105);
const OPJ97_TWO_INVK = Math.fround(1.625732422);
const OPJ97_C_DELTA = Math.fround(-0.443506852); // -opj_dwt_delta
const OPJ97_C_GAMMA = Math.fround(-0.882911075); // -opj_dwt_gamma
const OPJ97_C_BETA = Math.fround(0.052980118); // -opj_dwt_beta
const OPJ97_C_ALPHA = Math.fround(1.586134342); // -opj_dwt_alpha

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
    this._bound1dCas1Rev53 = (l, lo, h, ho, ll, hl, out, oo) =>
      this._iDwt1dCas1(l, lo, h, ho, ll, hl, out, oo, true);
    this._bound1dCas1Irv97 = (l, lo, h, ho, ll, hl, out, oo) =>
      this._iDwt1dCas1(l, lo, h, ho, ll, hl, out, oo, false);
    this._bound1dIrv97OpjCas0 = (l, lo, h, ho, sn, dn, out, oo) =>
      this._iDwt1dIrv97Opj(l, lo, h, ho, sn, dn, out, oo, 0);
    this._bound1dIrv97OpjCas1 = (l, lo, h, ho, sn, dn, out, oo) =>
      this._iDwt1dIrv97Opj(l, lo, h, ho, sn, dn, out, oo, 1);
    this._opj97L = new Float64Array(0);
    this._opj97H = new Float64Array(0);
    this._opj97Out = new Float64Array(0);
    this._vColL = new Float64Array(0);
    this._vColH = new Float64Array(0);
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

    // Seed from the coarsest resolution carrying LL samples. When no
    // resolution has a non-empty LL (zero-area coarsest rects or entirely
    // skipped low band), bootstrap at the first non-degenerate resolution
    // with an implicit all-zero low band and run that level too.
    let current = null;
    let start = 0;
    for (let r = 0; r < numLevels; r++) {
      const res = resolutions[r];
      if (res.ll && res.ll.length > 0 && res.width > 0 && res.height > 0) {
        current = res.ll;
        start = r + 1;
        break;
      }
    }
    let seedLevel = -1;
    if (current === null) {
      for (let r = 0; r < numLevels; r++) {
        const res = resolutions[r];
        if (res.width > 0 && res.height > 0) {
          const cx = (res.x0 & 1) === 1 ? 1 : 0;
          const cy = (res.y0 & 1) === 1 ? 1 : 0;
          const lw = cx === 0 ? Math.ceil(res.width / 2) : Math.floor(res.width / 2);
          const lh = cy === 0 ? Math.ceil(res.height / 2) : Math.floor(res.height / 2);
          current = new Float64Array(lw * lh);
          start = r;
          seedLevel = r;
          break;
        }
      }
      if (current === null) {
        return new Float64Array(0);
      }
    }

    for (let r = seedLevel >= 0 ? seedLevel : start; r < numLevels; r++) {
      const res = resolutions[r];
      const resW = res.width;
      const resH = res.height;
      if (resW <= 0 || resH <= 0) {
        continue;
      }
      const casX = (res.x0 & 1) === 1 ? 1 : 0;
      const casY = (res.y0 & 1) === 1 ? 1 : 0;
      const lWid = casX === 0 ? Math.ceil(resW / 2) : Math.floor(resW / 2);
      const hWid = resW - lWid;
      const lHgt = casY === 0 ? Math.ceil(resH / 2) : Math.floor(resH / 2);
      const hHgt = resH - lHgt;
      const hlW = res.hlW !== undefined ? res.hlW : hWid;
      const hlH = res.hlH !== undefined ? res.hlH : lHgt;
      const lhW = res.lhW !== undefined ? res.lhW : lWid;
      const lhH = res.lhH !== undefined ? res.lhH : hHgt;

      current = this._iDwt2dLevel(
        current,
        res.hl || new Float64Array(hlW * hlH),
        res.lh || new Float64Array(lhW * lhH),
        res.hh || new Float64Array(hWid * hHgt),
        resW,
        resH,
        isReversible,
        casX,
        casY,
        hlW,
        hlH,
        lhW,
        lhH
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
      for (let n = 0; n < lLen; n++) {
        out[2 * n] = l[n];
      }
      return;
    }
    if (lLen === 0) {
      out[0] = h[0] / 2;
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
      for (let n = 0; n < lLen; n++) {
        out[2 * n] = l[n];
      }
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
    const st = stride === undefined ? 1 : stride;
    if (hLen === 0) {
      for (let n = 0; n < lLen; n++) {
        out[outOff + st * (2 * n)] = lSrc[lOff + n];
      }
      return;
    }
    if (lLen === 0) {
      // Single high sample (length-1 span): the 5/3 synthesizer halves it.
      out[outOff] = Math.floor(hSrc[hOff] / 2);
      return;
    }

    if (this._scratchLw.length < lLen) {
      this._scratchLw = new Float64Array(lLen);
    }
    const lw = this._scratchLw;

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
      for (let n = 0; n < lLen; n++) {
        out[outOff + 2 * n] = lSrc[lOff + n];
      }
      return;
    }
    if (lLen === 0) {
      // Single high sample: OpenJPEG's 9/7 decode is gated off for this
      // degenerate case, so the sample passes through unmodified.
      out[outOff] = hSrc[hOff];
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
   * Odd-origin (code-alternating-synthesis == 1) 1-D inverse transform with
   * per-sample arithmetic matching OpenJPEG's cas=1 paths: highs at even
   * positions (2j), lows at odd positions (2j+1). Low lifting taps the highs
   * at the same and next index; high lifting taps the lows at the same and
   * previous index, with clamp-repeat edge extension.
   * @method
   * @private
   * @param {Float64Array} lSrc - Low-band samples source array.
   * @param {number} lOff - Offset of low-band samples in source array.
   * @param {Float64Array} hSrc - High-band samples source array.
   * @param {number} hOff - Offset of high-band samples in source array.
   * @param {number} lLen - Number of low-band samples.
   * @param {number} hLen - Number of high-band samples.
   * @param {Float64Array} out - Output array receiving lLen + hLen interleaved
   * samples starting at outOff.
   * @param {number} outOff - Offset for output samples in output array.
   * @param {boolean} isReversible - true for 5/3, false for 9/7.
   */
  _iDwt1dCas1(lSrc, lOff, hSrc, hOff, lLen, hLen, out, outOff, isReversible) {
    if (lLen + hLen === 0) {
      return;
    }
    if (lLen === 0) {
      // OpenJPEG cas=1: 5/3 with a single high divides it by two; the 9/7
      // decode is gated off and leaves the sample unmodified. Truncated
      // multi-high rows get the plain deinterleave.
      if (!isReversible && hLen === 1) {
        out[outOff] = hSrc[hOff];
        return;
      }
      for (let n = 0; n < hLen; n++) {
        const v = hLen === 1 ? Math.floor(hSrc[hOff + n] / 2) : hSrc[hOff + n];
        out[outOff + 2 * n] = v;
      }
      return;
    }
    if (hLen === 0) {
      for (let n = 0; n < lLen; n++) {
        out[outOff + 2 * n + 1] = lSrc[lOff + n];
      }
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
    // Clamp-repeat taps into the opposite band ([0, hLen-1] for low updates,
    // [0, lLen-1] for high updates).
    const cH = (i) => (i < 0 ? 0 : i >= hLen ? hLen - 1 : i);
    const cL = (i) => (i < 0 ? 0 : i >= lLen ? lLen - 1 : i);

    if (isReversible) {
      const lBase = lOff,
        hBase = hOff;
      for (let j = 0; j < lLen; j++) {
        lw[j] = lSrc[lBase + j] - ((hSrc[hBase + cH(j)] + hSrc[hBase + cH(j + 1)] + 2) >> 2);
      }
      for (let j = 0; j < hLen; j++) {
        out[outOff + 2 * j] = hSrc[hBase + j] + ((lw[cL(j)] + lw[cL(j - 1)]) >> 1);
      }
      for (let j = 0; j < lLen; j++) {
        out[outOff + 2 * j + 1] = lw[j];
      }
      return;
    }

    const K = this.CDF97_K;
    const invK = this.CDF97_INV_K;
    const delta = this.CDF97_DELTA;
    const gamma = this.CDF97_GAMMA;
    const beta = this.CDF97_BETA;
    const alpha = this.CDF97_ALPHA;

    for (let j = 0; j < lLen; j++) {
      lw[j] = lSrc[lOff + j] * K;
    }
    for (let j = 0; j < hLen; j++) {
      hw[j] = hSrc[hOff + j] * invK;
    }
    // Delta on lows (taps: hw[j], hw[j+1], clamped)
    for (let j = 0; j < lLen; j++) {
      lw[j] -= delta * (hw[cH(j)] + hw[cH(j + 1)]);
    }
    // Gamma on highs (taps: lw[j-1], lw[j], clamped)
    for (let j = 0; j < hLen; j++) {
      hw[j] -= gamma * (lw[cL(j - 1)] + lw[cL(j)]);
    }
    // Beta on lows (taps as delta, on updated highs)
    for (let j = 0; j < lLen; j++) {
      lw[j] -= beta * (hw[cH(j)] + hw[cH(j + 1)]);
    }
    // Alpha on highs (taps as gamma, on updated lows)
    for (let j = 0; j < hLen; j++) {
      hw[j] -= alpha * (lw[cL(j - 1)] + lw[cL(j)]);
    }
    for (let j = 0; j < hLen; j++) {
      out[outOff + 2 * j] = hw[j];
    }
    for (let j = 0; j < lLen; j++) {
      out[outOff + 2 * j + 1] = lw[j];
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
   * @param {number} [casX] - Horizontal parity of the source resolution (0|1).
   * @param {number} [casY] - Vertical parity of the source resolution (0|1).
   * @param {number} [hlW] - Actual HL band width (defaults to low width).
   * @param {number} [hlH] - Actual HL band height (defaults to low height).
   * @param {number} [lhW] - Actual LH band width (defaults to high width).
   * @param {number} [lhH] - Actual LH band height (defaults to high height).
   * @returns {Float64Array} Reconstructed resolution-level samples (out buffer).
   */
  _iDwt2dLevel(
    llBuf,
    hlBuf,
    lhBuf,
    hhBuf,
    resW,
    resH,
    isReversible,
    casX = 0,
    casY = 0,
    hlW = 0,
    hlH = 0,
    lhW = 0,
    lhH = 0
  ) {
    // Band sizes follow from the resolution parity (Paraschiva §3.4): odd
    // origins swap the ceil/floor split so that HL/LH keep the even (low)
    // row/column origin. Actual band dimensions from the code-stream
    // rectangles are used when provided (truncated bands).
    const lWid = casX === 0 ? Math.ceil(resW / 2) : Math.floor(resW / 2);
    const lHgt = casY === 0 ? Math.ceil(resH / 2) : Math.floor(resH / 2);
    const hWid = resW - lWid;
    const hHgt = resH - lHgt;
    // HL is high-in-x / low-in-y; LH is low-in-x / high-in-y.
    const hlBW = hlW || hWid;
    const hlBH = hlH || lHgt;
    const lhBW = lhW || lWid;
    const lhBH = lhH || hHgt;

    const idwt1d =
      casX === 0
        ? isReversible
          ? this._bound1dRev53Offset
          : this._bound1dIrv97OpjCas0
        : isReversible
          ? this._bound1dCas1Rev53
          : this._bound1dIrv97OpjCas1;

    const out = new Float64Array(resW * resH);

    // Reuse vertical intermediate buffers (zero-filled: truncated rows may
    // leave trailing samples unwritten by the horizontal pass).
    if (this._vertL.length < lHgt * resW) {
      this._vertL = new Float64Array(lHgt * resW);
    }
    if (this._vertH.length < hHgt * resW) {
      this._vertH = new Float64Array(hHgt * resW);
    }
    const vertL = this._vertL;
    const vertH = this._vertH;
    vertL.fill(0, 0, lHgt * resW);
    vertH.fill(0, 0, hHgt * resW);

    // Horizontal transform — row y of vertL interleaves row y of LL (lows)
    // with row y of HL (highs); row y of vertH interleaves LH and HH.
    for (let y = 0; y < lHgt; y++) {
      const hLen = y < hlBH ? hlBW : 0;
      idwt1d(llBuf, y * lWid, hlBuf, y * hlBW, lWid, hLen, vertL, y * resW);
    }
    for (let y = 0; y < hHgt; y++) {
      const lLen = y < lhBH ? lhBW : 0;
      idwt1d(lhBuf, y * lhBW, hhBuf, y * hWid, lLen, hWid, vertH, y * resW);
    }

    // Vertical transform — streamed row by row. Columns are independent, so
    // lifting can operate on whole rows directly with a small rolling window,
    // reading vertL/vertH rows sequentially and writing contiguous output
    // rows. This avoids the transposed-block staging entirely.
    if (isReversible) {
      if (casY === 0) {
        this._iDwtVerticalRev53(vertL, vertH, lHgt, hHgt, resW, out);
      } else {
        this._iDwtVerticalCas1(vertL, vertH, lHgt, hHgt, resW, out, true);
      }
    } else {
      this._opj97VerticalCols(vertL, vertH, lHgt, hHgt, resW, out, casY);
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

  /**
   * One lifting stage of the OpenJPEG scalar synthesis, a literal port of the
   * opj_v8dwt_decode_step2() scalar-emulation path (the code a stock MSVC
   * build compiles to when __SSE__ is not defined). Updates tgt[0..tgtLen) in
   * place from the partner band part[partOff..partOff+partLen).
   *
   * fam === 0 reproduces the stage whose window starts AT the band base
   * (v == w, cas == 0 low pass and cas == 1 high pass): lane 0 of every
   * 8-sample vector clamps its left tap to index 0, so element 0 uses
   * part[0] twice, and out-of-range partner reads (i >= partLen) yield 0.
   * fam === 1 reproduces the stage whose window starts one element into the
   * partner band (cas == 1 low, cas == 0 high): every element uses
   * (part[i] + part[i + 1]).
   *
   * The C loop bound is (uint32) min(size_t, OPJ_UINT32): a negative
   * "remaining" (the dn - a / sn - b differences of the degenerate b11
   * resolutions) wraps to a huge value, which lets the loop walk the entire
   * target band while the partner reads stray past the band into the
   * neighboring code-block buffer. Passing oob === null models those reads as
   * 0; passing a buffer models the real (neighbour garbage) reads.
   *
   * @method
   * @private
   * @param {number} c - Float32 additive coefficient (already negated).
   * @param {number} fam - Stage family: 0 = base-window (doubling at index 0), 1 = shifted.
   * @param {number} tgtLen - Target band length.
   * @param {number} partLen - Partner band length.
   * @param {Float64Array} tgt - Target band (updated in place).
   * @param {Float64Array} part - Partner band.
   * @param {number} partOff - Start offset of the partner window in part.
   * @param {number} m - C 32-bit size parameter (may be negative).
   */
  _opj97Stage(c, fam, tgtLen, partLen, tgt, part, partOff, m) {
    const pr = (k) => (k >= 0 && k < partLen ? part[partOff + k] : 0);
    // (uint32) m: negative values wrap past the band end.
    const um = m < 0 ? m + 4294967296 : m;
    const end = um < tgtLen ? um : tgtLen;
    if (fam === 0) {
      for (let i = 0; i < end; i++) {
        tgt[i] += (pr(i > 0 ? i - 1 : 0) + pr(i)) * c;
      }
      if (m >= 0 && m < tgtLen) {
        tgt[m] += 2 * pr(m > 0 ? m - 1 : 0) * c;
      }
    } else {
      for (let i = 0; i < end; i++) {
        tgt[i] += (pr(i) + pr(i + 1)) * c;
      }
      if (m >= 0 && m < tgtLen) {
        tgt[m] += 2 * pr(m) * c;
      }
    }
  }

  /**
   * Run the OpenJPEG opj_v8dwt_decode() synthesis for one 1-D window pair on
   * the scratch bands L[0..sn) and H[0..dn) (values updated in place).
   * Returns false when the level is gated off, in which case the bands must
   * be deinterleaved without any scaling (opj_dwt_interleave_* semantics).
   * @method
   * @private
   * @param {number} sn - Low band length.
   * @param {number} dn - High band length.
   * @param {number} cas - Code-alternating-synthesis flag.
   * @param {Float64Array} L - Low band scratch.
   * @param {Float64Array} H - High band scratch.
   * @returns {boolean} true if the lifting cascade ran.
   */
  _opj97DecodeCore(sn, dn, cas, L, H) {
    // opj_v8dwt_decode gate: cas == 0 skips unless (dn > 0 || sn > 1);
    // cas == 1 skips unless (sn > 0 || dn > 1). When skipped, the level is a
    // plain deinterleave without any scaling.
    if (cas === 0 ? !(dn > 0 || sn > 1) : !(sn > 0 || dn > 1)) {
      return false;
    }
    // opj_v8dwt_decode_step1 on both windows: K on the low band, two_invK on
    // the high band.
    for (let i = 0; i < sn; i++) {
      L[i] = L[i] * OPJ97_K;
    }
    for (let i = 0; i < dn; i++) {
      H[i] = H[i] * OPJ97_TWO_INVK;
    }
    // The four opj_v8dwt_decode_step2 calls of opj_v8dwt_decode, in source
    // order: (low, -delta), (high, -gamma), (low, -beta), (high, -alpha).
    // With a == cas and b === 1 - cas, the size arguments clamp to
    //     low  stages:  min(sn, dn - cas)
    //     high stages:  min(dn, sn - b)
    // The low stages use the base-window family when cas == 0 and the shifted
    // family when cas == 1 (the a == 1 offset starts the window one sample
    // into the partner band); the high stages are the mirror image.
    const lowFam = cas;
    const highFam = 1 - (cas & 1);
    const lowM = sn < dn - cas ? sn : dn - cas;
    const highM = dn < sn - (1 - cas) ? dn : sn - (1 - cas);
    this._opj97Stage(OPJ97_C_DELTA, lowFam, sn, dn, L, H, 0, lowM);
    this._opj97Stage(OPJ97_C_GAMMA, highFam, dn, sn, H, L, 0, highM);
    this._opj97Stage(OPJ97_C_BETA, lowFam, sn, dn, L, H, 0, lowM);
    this._opj97Stage(OPJ97_C_ALPHA, highFam, dn, sn, H, L, 0, highM);
    return true;
  }

  /**
   * Scratch accessor for the two 1-D band buffers used by the OpenJPEG-style
   * 9/7 synthesis.
   * @method
   * @private
   * @param {number} sn - Low band length.
   * @param {number} dn - High band length.
   * @returns {Array<Float64Array>} [low, high] scratch buffers.
   */
  _opj97Bands(sn, dn) {
    const n = Math.max(1, sn, dn);
    if (this._opj97L.length < n) {
      const buf = new Float64Array(n);
      this._opj97L = buf;
      this._opj97H = new Float64Array(n);
    }
    const L = this._opj97L;
    const H = this._opj97H;
    for (let i = sn; i < n; i++) {
      L[i] = 0;
    }
    for (let i = dn; i < n; i++) {
      H[i] = 0;
    }
    return [L, H];
  }

  /**
   * 1-D inverse 9/7 synthesis with OpenJPEG's exact numerics: the
   * opj_v8dwt_decode gate, the K / two_invK gain-compensated step1 scaling,
   * and the four boundary-clamped lifting stages.
   * @method
   * @private
   * @param {Float64Array} lSrc - Low band source.
   * @param {number} lOff - Low band start.
   * @param {Float64Array} hSrc - High band source.
   * @param {number} hOff - High band start.
   * @param {number} sn - Low band length.
   * @param {number} dn - High band length.
   * @param {Float64Array} out - Destination buffer.
   * @param {number} outOff - Destination start.
   * @param {number} cas - Code-alternating-synthesis flag.
   */
  _iDwt1dIrv97Opj(lSrc, lOff, hSrc, hOff, sn, dn, out, outOff, cas) {
    const [L, H] = this._opj97Bands(sn, dn);
    for (let i = 0; i < sn; i++) {
      L[i] = lSrc[lOff + i];
    }
    for (let i = 0; i < dn; i++) {
      H[i] = hSrc[hOff + i];
    }
    if (!this._opj97DecodeCore(sn, dn, cas, L, H)) {
      // gate path (opj_dwt_interleave_v only): no synthesis, no scaling
      if (cas === 0) {
        for (let n = 0; n < sn; n++) {
          out[outOff + 2 * n] = L[n];
        }
        for (let k = 0; k < dn; k++) {
          out[outOff + 2 * k + 1] = H[k];
        }
      } else {
        for (let j = 0; j < dn; j++) {
          out[outOff + 2 * j] = H[j];
        }
        for (let j = 0; j < sn; j++) {
          out[outOff + 2 * j + 1] = L[j];
        }
      }
      return;
    }
    if (cas === 0) {
      for (let n = 0; n < sn; n++) {
        out[outOff + 2 * n] = L[n];
      }
      for (let k = 0; k < dn; k++) {
        out[outOff + 2 * k + 1] = H[k];
      }
    } else {
      for (let j = 0; j < dn; j++) {
        out[outOff + 2 * j] = H[j];
      }
      for (let j = 0; j < sn; j++) {
        out[outOff + 2 * j + 1] = L[j];
      }
    }
  }

  /**
   * Vertical 9/7 synthesis column-at-a-time with OpenJPEG's exact numerics.
   * @method
   * @private
   * @param {Float64Array} vertL - Low vertical band, lHgt rows of resW.
   * @param {Float64Array} vertH - High vertical band, hHgt rows of resW.
   * @param {number} lHgt - Number of low rows.
   * @param {number} hHgt - Number of high rows.
   * @param {number} resW - Row width.
   * @param {Float64Array} out - Output rows buffer (resH x resW).
   * @param {number} cas - Code-alternating-synthesis flag.
   */
  _opj97VerticalCols(vertL, vertH, lHgt, hHgt, resW, out, cas) {
    const [L, H] = this._opj97Bands(lHgt, hHgt);
    for (let x = 0; x < resW; x++) {
      for (let j = 0; j < lHgt; j++) {
        L[j] = vertL[j * resW + x];
      }
      for (let j = 0; j < hHgt; j++) {
        H[j] = vertH[j * resW + x];
      }
      this._opj97DecodeCore(lHgt, hHgt, cas, L, H);
      if (cas === 0) {
        for (let n = 0; n < lHgt; n++) {
          out[2 * n * resW + x] = L[n];
        }
        for (let k = 0; k < hHgt; k++) {
          out[(2 * k + 1) * resW + x] = H[k];
        }
      } else {
        for (let j = 0; j < hHgt; j++) {
          out[2 * j * resW + x] = H[j];
        }
        for (let j = 0; j < lHgt; j++) {
          out[(2 * j + 1) * resW + x] = L[j];
        }
      }
      // When gated (runs === false) the column keeps the un-scaled
      // deinterleave above, matching opj_dwt_interleave_v / _h with no
      // following synthesis.
    }
  }

  /**
   * Odd-origin (cas == 1) vertical inverse transform, column-at-a-time with
   * the same lifting equations as _iDwt1dCas1: high row j emitted at output
   * row 2j and low row j at 2j+1. Correctness-first multi-pass version.
   * @method
   * @private
   * @param {Float64Array} vertL - Low vertical band, lHgt rows of resW.
   * @param {Float64Array} vertH - High vertical band, hHgt rows of resW.
   * @param {number} lHgt - Number of low rows.
   * @param {number} hHgt - Number of high rows.
   * @param {number} resW - Row width.
   * @param {Float64Array} out - Output rows buffer (resH × resW).
   * @param {boolean} isReversible - true for 5/3, false for 9/7.
   */
  _iDwtVerticalCas1(vertL, vertH, lHgt, hHgt, resW, out, isReversible) {
    if (hHgt === 0) {
      return;
    }
    if (lHgt === 0) {
      // Single high row (resH === 1): 5/3 halves the samples, 9/7 decode is
      // gated off and leaves them unmodified (matches _iDwt1dCas1).
      if (isReversible && hHgt === 1) {
        for (let x = 0; x < resW; x++) {
          out[x] = Math.floor(vertH[x] / 2);
        }
      } else {
        out.set(vertH.subarray(0, hHgt * resW), 0);
      }
      return;
    }

    const K = this.CDF97_K;
    const invK = this.CDF97_INV_K;
    const delta = this.CDF97_DELTA;
    const gamma = this.CDF97_GAMMA;
    const beta = this.CDF97_BETA;
    const alpha = this.CDF97_ALPHA;

    if (this._vColL.length < lHgt) {
      this._vColL = new Float64Array(lHgt);
    }
    if (this._vColH.length < hHgt) {
      this._vColH = new Float64Array(hHgt);
    }
    const lw = this._vColL;
    const hw = this._vColH;

    for (let x = 0; x < resW; x++) {
      for (let j = 0; j < lHgt; j++) {
        lw[j] = vertL[j * resW + x];
      }
      for (let j = 0; j < hHgt; j++) {
        hw[j] = vertH[j * resW + x];
      }
      const cH = (i) => (i < 0 ? 0 : i >= hHgt ? hHgt - 1 : i);
      const cL = (i) => (i < 0 ? 0 : i >= lHgt ? lHgt - 1 : i);

      if (isReversible) {
        for (let j = 0; j < lHgt; j++) {
          lw[j] -= (hw[cH(j)] + hw[cH(j + 1)] + 2) >> 2;
        }
        for (let j = 0; j < hHgt; j++) {
          out[2 * j * resW + x] = hw[j] + ((lw[cL(j)] + lw[cL(j - 1)]) >> 1);
        }
        for (let j = 0; j < lHgt; j++) {
          out[(2 * j + 1) * resW + x] = lw[j];
        }
      } else {
        for (let j = 0; j < lHgt; j++) {
          lw[j] *= K;
        }
        for (let j = 0; j < hHgt; j++) {
          hw[j] *= invK;
        }
        for (let j = 0; j < lHgt; j++) {
          lw[j] -= delta * (hw[cH(j)] + hw[cH(j + 1)]);
        }
        for (let j = 0; j < hHgt; j++) {
          hw[j] -= gamma * (lw[cL(j - 1)] + lw[cL(j)]);
        }
        for (let j = 0; j < lHgt; j++) {
          lw[j] -= beta * (hw[cH(j)] + hw[cH(j + 1)]);
        }
        for (let j = 0; j < hHgt; j++) {
          hw[j] -= alpha * (lw[cL(j - 1)] + lw[cL(j)]);
        }
        for (let j = 0; j < hHgt; j++) {
          out[2 * j * resW + x] = hw[j];
        }
        for (let j = 0; j < lHgt; j++) {
          out[(2 * j + 1) * resW + x] = lw[j];
        }
      }
    }
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Wavelet;
//#endregion
