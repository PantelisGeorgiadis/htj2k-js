const Wavelet = require('./../src/Wavelet');

const chai = require('chai');
const expect = chai.expect;

function approxEqual(a, b, tol) {
  return Math.abs(a - b) <= (tol !== undefined ? tol : 1e-9);
}

function arrApproxEqual(a, b, tol) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!approxEqual(a[i], b[i], tol)) return false;
  }
  return true;
}

describe('Wavelet', () => {
  it('should return an empty array when given no resolutions', () => {
    const wavelet = new Wavelet();
    const result = wavelet.iDwt2d([], true);
    expect(result).to.be.instanceOf(Float64Array);
    expect(result.length).to.equal(0);
  });

  it('should return the LL band unchanged for a single resolution level', () => {
    const wavelet = new Wavelet();
    const ll = new Float64Array([10, 20, 30, 40]);
    const result = wavelet.iDwt2d([{ width: 2, height: 2, ll }], true);
    expect(result).to.be.instanceOf(Float64Array);
    expect(result.length).to.equal(4);
    expect(Array.from(result)).to.deep.equal([10, 20, 30, 40]);
  });

  it('should reconstruct a 1×1 image from a single DC coefficient (reversible)', () => {
    const wavelet = new Wavelet();
    const ll = new Float64Array([42]);
    const result = wavelet.iDwt2d([{ width: 1, height: 1, ll }], true);
    expect(result.length).to.equal(1);
    expect(result[0]).to.equal(42);
  });

  it('should reconstruct a 1×1 image from a single DC coefficient (irreversible)', () => {
    const wavelet = new Wavelet();
    const ll = new Float64Array([42]);
    const result = wavelet.iDwt2d([{ width: 1, height: 1, ll }], false);
    expect(result.length).to.equal(1);
    expect(approxEqual(result[0], 42, 1e-6)).to.be.true;
  });

  it('should reconstruct a flat image exactly with reversible 5/3 IDWT', () => {
    // A constant signal has zero high-band coefficients.
    // After IDWT the output should equal the constant everywhere.
    const wavelet = new Wavelet();
    const constVal = 100;
    // 4×4 image: LL = 2×2, HL = 2×2, LH = 2×2, HH = 2×2 (all high-bands zero)
    const ll = new Float64Array([constVal, constVal, constVal, constVal]);
    const hl = new Float64Array(4); // zeros
    const lh = new Float64Array(4); // zeros
    const hh = new Float64Array(4); // zeros
    const result = wavelet.iDwt2d(
      [
        { width: 2, height: 2, ll },
        { width: 4, height: 4, hl, lh, hh },
      ],
      true
    );
    expect(result.length).to.equal(16);
    for (let i = 0; i < 16; i++) {
      expect(result[i]).to.equal(constVal);
    }
  });

  it('should reconstruct a flat image to within tolerance with irreversible 9/7 IDWT', () => {
    // The OpenJPEG 9/7 synthesis K gains are folded into the dequantization
    // path, so the DWT itself reconstructs a flat LL (zero high bands) back
    // to the original constant.
    const wavelet = new Wavelet();
    const constVal = 50;
    const expected = constVal;
    const ll = new Float64Array([constVal, constVal, constVal, constVal]);
    const hl = new Float64Array(4);
    const lh = new Float64Array(4);
    const hh = new Float64Array(4);
    const result = wavelet.iDwt2d(
      [
        { width: 2, height: 2, ll },
        { width: 4, height: 4, hl, lh, hh },
      ],
      false
    );
    expect(result.length).to.equal(16);
    for (let i = 0; i < 16; i++) {
      expect(approxEqual(result[i], expected, 1e-3)).to.be.true;
    }
  });

  it('should produce a larger output than the input LL band after one IDWT level', () => {
    const wavelet = new Wavelet();
    const ll = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const hl = new Float64Array(6); // 3 cols × 3 rows for 6×6 target
    const lh = new Float64Array(6);
    const hh = new Float64Array(4);
    // 3×3 LL → 6×6 output
    const result = wavelet.iDwt2d(
      [
        { width: 3, height: 3, ll },
        { width: 6, height: 6, hl, lh, hh },
      ],
      true
    );
    expect(result.length).to.equal(36);
  });

  it('should support two IDWT levels (reversible)', () => {
    const wavelet = new Wavelet();
    // 1×1 LL → 2×2 → 4×4
    const ll = new Float64Array([8]);
    const hl1 = new Float64Array(1); // 1 col × 1 row
    const lh1 = new Float64Array(1);
    const hh1 = new Float64Array(1);
    const hl2 = new Float64Array(4); // 2 cols × 2 rows
    const lh2 = new Float64Array(4);
    const hh2 = new Float64Array(4);
    const result = wavelet.iDwt2d(
      [
        { width: 1, height: 1, ll },
        { width: 2, height: 2, hl: hl1, lh: lh1, hh: hh1 },
        { width: 4, height: 4, hl: hl2, lh: lh2, hh: hh2 },
      ],
      true
    );
    expect(result.length).to.equal(16);
    for (let i = 0; i < 16; i++) {
      expect(result[i]).to.equal(8);
    }
  });

  it('should apply reversible 1D IDWT correctly on a known sequence', () => {
    // Forward 5/3 DWT of [2, 4]: predict H = x[1]-x[0] = 2, update L = x[0]+floor(H/2) = 3.
    // The inverse should recover [2, 4].
    const wavelet = new Wavelet();
    const l = new Float64Array([3]);
    const h = new Float64Array([2]);
    const out = new Float64Array(2);
    wavelet._iDwt1dRev53(l, h, 1, 1, out);
    expect(out[0]).to.equal(2);
    expect(out[1]).to.equal(4);
  });

  it('should apply irreversible 1D IDWT and return correct output size', () => {
    // Verify that 9/7 IDWT produces a Float64Array of the correct output size
    // with all finite values when given valid LL and zero-valued high bands.
    const wavelet = new Wavelet();
    const ll = new Float64Array([7, 7]);
    const hl = new Float64Array([0, 0]);
    const result = wavelet.iDwt2d(
      [
        { width: 2, height: 1, ll },
        { width: 4, height: 1, hl, lh: new Float64Array(0), hh: new Float64Array(0) },
      ],
      false
    );
    expect(result).to.be.instanceOf(Float64Array);
    expect(result.length).to.equal(4);
    for (let i = 0; i < result.length; i++) {
      expect(isFinite(result[i])).to.be.true;
    }
  });

  it('should return a Float64Array from idwt2d', () => {
    const wavelet = new Wavelet();
    const ll = new Float64Array([1, 2, 3, 4]);
    const result = wavelet.iDwt2d([{ width: 2, height: 2, ll }], true);
    expect(result).to.be.instanceOf(Float64Array);
  });

  describe('iDwt2d edge cases', () => {
    it('bootstrap reconstructs zeros when the LL band is empty', () => {
      const wavelet = new Wavelet();
      const result = wavelet.iDwt2d(
        [
          { width: 2, height: 2, ll: new Float64Array(0) },
          {
            width: 4,
            height: 4,
            x0: 0,
            y0: 0,
            hl: new Float64Array(4),
            lh: new Float64Array(4),
            hh: new Float64Array(4),
          },
        ],
        true
      );
      expect(result.length).to.equal(16);
      expect(Array.from(result)).to.deep.equal(new Array(16).fill(0));
    });

    it('skips resolutions with zero size', () => {
      const wavelet = new Wavelet();
      const result = wavelet.iDwt2d(
        [
          { width: 2, height: 2, ll: new Float64Array(4).fill(9) },
          {
            width: 0,
            height: 0,
            hl: new Float64Array(0),
            lh: new Float64Array(0),
            hh: new Float64Array(0),
          },
          {
            width: 4,
            height: 4,
            x0: 0,
            y0: 0,
            hl: new Float64Array(4),
            lh: new Float64Array(4),
            hh: new Float64Array(4),
          },
        ],
        true
      );
      expect(result.length).to.equal(16);
      expect(Array.from(result)).to.deep.equal(new Array(16).fill(9));
    });

    it('honours explicit truncated HL dimensions', () => {
      const wavelet = new Wavelet();
      const result = wavelet.iDwt2d(
        [
          { width: 2, height: 2, ll: new Float64Array(4).fill(10) },
          {
            width: 4,
            height: 4,
            x0: 0,
            y0: 0,
            hl: new Float64Array(2),
            lh: new Float64Array(4),
            hh: new Float64Array(4),
            hlW: 1,
            hlH: 2,
          },
        ],
        true
      );
      expect(Array.from(result)).to.deep.equal([
        10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0,
      ]);
    });

    it('returns empty output for a fully degenerate resolution', () => {
      const wavelet = new Wavelet();
      const result = wavelet.iDwt2d([{ width: 0, height: 0, ll: new Float64Array(0) }], true);
      expect(result.length).to.equal(0);
    });

    it('reconstructs a flat 3×3 level at an odd origin (irreversible, causal)', () => {
      const wavelet = new Wavelet();
      // 3×3 at x0=1,y0=1: lWid=1,hWid=2,lHgt=1,hHgt=2 -> hl=2, lh=2, hh=4.
      const result = wavelet.iDwt2d(
        [
          { width: 1, height: 1, ll: new Float64Array([42]) },
          {
            width: 3,
            height: 3,
            x0: 1,
            y0: 1,
            hl: new Float64Array(2),
            lh: new Float64Array(2),
            hh: new Float64Array(4),
          },
        ],
        false
      );
      expect(result.length).to.equal(9);
      for (let i = 0; i < result.length; i++) {
        expect(approxEqual(result[i], 42, 1e-4)).to.be.true;
      }
    });
  });

  describe('_iDwt1dRev53', () => {
    const w = new Wavelet();

    it('de-interleaves when there are no high-band samples', () => {
      const out = new Float64Array(3);
      w._iDwt1dRev53(new Float64Array([1, 2, 3]), new Float64Array(0), 3, 0, out);
      expect(Array.from(out)).to.deep.equal([1, 0, 2]);
    });

    it('halves high samples at the even tail (positive)', () => {
      const out = new Float64Array(1);
      w._iDwt1dRev53(new Float64Array(0), new Float64Array([5]), 0, 1, out);
      expect(out[0]).to.equal(2.5);
    });

    it('halves high samples at the even tail (negative, true division)', () => {
      const out = new Float64Array(1);
      w._iDwt1dRev53(new Float64Array(0), new Float64Array([-3]), 0, 1, out);
      expect(out[0]).to.equal(-1.5);
    });
  });

  describe('_iDwt1dIrv97', () => {
    const w = new Wavelet();

    it('copies low samples when there are none in the high band', () => {
      const out = new Float64Array(2);
      w._iDwt1dIrv97(new Float64Array([7, 0]), new Float64Array(0), 2, 0, out);
      expect(Array.from(out)).to.deep.equal([7, 0]);
    });

    it('reconstructs a flat signal from zero high samples', () => {
      const out = new Float64Array(4);
      w._iDwt1dIrv97(new Float64Array([4, 4]), new Float64Array([0, 0]), 2, 2, out);
      expect(arrApproxEqual(out, [4, 4, 4, 4], 1e-6)).to.be.true;
    });
  });

  describe('_iDwt1dRev53Offset', () => {
    const w = new Wavelet();

    it('writes low-then-high with stride 1', () => {
      const out = new Float64Array(6);
      w._iDwt1dRev53Offset(new Float64Array([9, 5]), 0, new Float64Array([2]), 0, 2, 1, out, 0, 1);
      expect(Array.from(out)).to.deep.equal([8, 8, 4, 0, 0, 0]);
    });

    it('applies the output stride', () => {
      const out = new Float64Array(6);
      w._iDwt1dRev53Offset(
        new Float64Array([3, 4, 0]),
        0,
        new Float64Array([2, 4, 0]),
        0,
        2,
        2,
        out,
        0,
        2
      );
      expect(Array.from(out)).to.deep.equal([2, 0, 4, 0, 2, 0]);
    });

    it('floors the lone high sample for an empty low band', () => {
      const out = new Float64Array(4);
      w._iDwt1dRev53Offset(new Float64Array(0), 0, new Float64Array([7]), 0, 0, 1, out, 0, 1);
      expect(out[0]).to.equal(Math.floor(7 / 2));
    });

    it('handles a single low and single high sample', () => {
      const out = new Float64Array(6);
      w._iDwt1dRev53Offset(new Float64Array([3]), 0, new Float64Array([2]), 0, 1, 1, out, 0, 1);
      expect(Array.from(out)).to.deep.equal([2, 4, 0, 0, 0, 0]);
    });
  });

  describe('_iDwt1dIrv97Offset', () => {
    const w = new Wavelet();

    it('reconstructs a flat signal from zero high samples', () => {
      const out = new Float64Array(4);
      w._iDwt1dIrv97Offset(new Float64Array([4, 4]), 0, new Float64Array([0, 0]), 0, 2, 2, out, 0);
      expect(arrApproxEqual(out, [4, 4, 4, 4], 1e-6)).to.be.true;
    });
  });

  describe('_iDwt1dCas1', () => {
    const w = new Wavelet();

    it('reversible: single high sample scaled into the even slot', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array(0), 0, new Float64Array([6]), 0, 0, 1, out, 0, true);
      expect(Array.from(out)).to.deep.equal([3, 0, 0, 0]);
    });

    it('reversible: multiple high samples de-interleaved without scaling', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array(0), 0, new Float64Array([6, 8]), 0, 0, 2, out, 0, true);
      expect(Array.from(out)).to.deep.equal([6, 0, 8, 0]);
    });

    it('irreversible: single high sample gated into the even slot unscaled', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array(0), 0, new Float64Array([6]), 0, 0, 1, out, 0, false);
      expect(Array.from(out)).to.deep.equal([6, 0, 0, 0]);
    });

    it('reversible: single low sample placed in the odd slot', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array([3]), 0, new Float64Array(0), 0, 1, 0, out, 0, true);
      expect(Array.from(out)).to.deep.equal([0, 3, 0, 0]);
    });

    it('reversible: single low and high sample', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array([3]), 0, new Float64Array([2]), 0, 1, 1, out, 0, true);
      expect(Array.from(out)).to.deep.equal([4, 2, 0, 0]);
    });

    it('irreversible: flat reconstruction', () => {
      const out = new Float64Array(4);
      w._iDwt1dCas1(new Float64Array([4, 4]), 0, new Float64Array([0, 0]), 0, 2, 2, out, 0, false);
      expect(arrApproxEqual(out, [4, 4, 4, 4], 1e-4)).to.be.true;
    });
  });

  describe('_iDwtVerticalCas1', () => {
    const w = new Wavelet();

    it('reversible: flat reconstruction across one low and one high row', () => {
      const out = new Float64Array(4);
      w._iDwtVerticalCas1(new Float64Array([10, 10]), new Float64Array([0, 0]), 1, 1, 2, out, true);
      expect(Array.from(out)).to.deep.equal([10, 10, 10, 10]);
    });

    it('irreversible: flat reconstruction across one low and one high row', () => {
      const out = new Float64Array(4);
      w._iDwtVerticalCas1(
        new Float64Array([10, 10]),
        new Float64Array([0, 0]),
        1,
        1,
        2,
        out,
        false
      );
      expect(arrApproxEqual(out, [10, 10, 10, 10], 1e-6)).to.be.true;
    });

    it('reversible: high-only rows fill the top', () => {
      const out = new Float64Array(4);
      w._iDwtVerticalCas1(new Float64Array(0), new Float64Array([10, 10]), 0, 2, 2, out, true);
      expect(Array.from(out)).to.deep.equal([10, 10, 0, 0]);
    });

    it('irreversible: high-only rows fill the top', () => {
      const out = new Float64Array(4);
      w._iDwtVerticalCas1(new Float64Array(0), new Float64Array([10, 10]), 0, 2, 2, out, false);
      expect(Array.from(out)).to.deep.equal([10, 10, 0, 0]);
    });
  });

  describe('_opj97DecodeCore', () => {
    const w = new Wavelet();

    it('skips the update when the gate is not met and leaves L untouched', () => {
      const L = new Float64Array([3]);
      const ok = w._opj97DecodeCore(1, 0, 0, L, new Float64Array(0));
      expect(ok).to.be.false;
      expect(Array.from(L)).to.deep.equal([3]);
    });

    it('runs the full 9/7 ladder when the gate is satisfied', () => {
      const H = new Float64Array([3, 5]);
      const ok = w._opj97DecodeCore(0, 2, 1, new Float64Array(0), H);
      expect(ok).to.be.true;
      expect(approxEqual(H[0], 4.877197, 1e-5)).to.be.true;
      expect(approxEqual(H[1], 8.128662, 1e-5)).to.be.true;
    });
  });

  describe('_opj97Bands', () => {
    const w = new Wavelet();

    it('returns work buffers with the tail slots zero-filled', () => {
      const [L, H] = w._opj97Bands(2, 3);
      expect(L.length).to.be.at.least(3);
      expect(H.length).to.be.at.least(3);
      expect(L[2]).to.equal(0);
      expect(H[2]).to.equal(0);
    });
  });

  describe('_opj97Stage', () => {
    const w = new Wavelet();

    it('applies the family-0 doubling at m=0', () => {
      const tgt = new Float64Array(2);
      w._opj97Stage(1.0, 0, 2, 2, tgt, new Float64Array([1, 1]), 0, 0);
      expect(Array.from(tgt)).to.deep.equal([2, 0]);
    });

    it('runs the family-1 lifting at m=1', () => {
      const tgt = new Float64Array(2);
      w._opj97Stage(1.0, 1, 2, 2, tgt, new Float64Array([1, 1]), 0, 1);
      expect(Array.from(tgt)).to.deep.equal([2, 2]);
    });

    it('wraps a negative m into the buffer length', () => {
      const tgt = new Float64Array(2);
      w._opj97Stage(1.0, 0, 2, 2, tgt, new Float64Array([1, 1]), 0, -3);
      expect(Array.from(tgt)).to.deep.equal([2, 2]);
    });
  });

  describe('_iDwt1dIrv97Opj', () => {
    const w = new Wavelet();

    it('gated single high sample lands unscaled in the even slot', () => {
      const out = new Float64Array(4);
      w._iDwt1dIrv97Opj(new Float64Array(0), 0, new Float64Array([7]), 0, 0, 1, out, 0, 1);
      expect(Array.from(out)).to.deep.equal([7, 0, 0, 0]);
    });

    it('flat reconstruction at causal origin 0', () => {
      const out = new Float64Array(4);
      w._iDwt1dIrv97Opj(new Float64Array([4, 4]), 0, new Float64Array([0, 0]), 0, 2, 2, out, 0, 0);
      expect(arrApproxEqual(out, [4, 4, 4, 4], 1e-4)).to.be.true;
    });

    it('flat reconstruction at causal origin 1', () => {
      const out = new Float64Array(4);
      w._iDwt1dIrv97Opj(new Float64Array([4, 4]), 0, new Float64Array([0, 0]), 0, 2, 2, out, 0, 1);
      expect(arrApproxEqual(out, [4, 4, 4, 4], 1e-4)).to.be.true;
    });
  });

  describe('_opj97VerticalCols', () => {
    const w = new Wavelet();

    it('flat reconstruction at causal origin 0', () => {
      const out = new Float64Array(4);
      w._opj97VerticalCols(new Float64Array([5, 5]), new Float64Array([0, 0]), 1, 1, 2, out, 0);
      expect(arrApproxEqual(out, [5, 5, 5, 5], 1e-4)).to.be.true;
    });

    it('flat reconstruction at causal origin 1', () => {
      const out = new Float64Array(4);
      w._opj97VerticalCols(new Float64Array([5, 5]), new Float64Array([0, 0]), 1, 1, 2, out, 1);
      expect(arrApproxEqual(out, [5, 5, 5, 5], 1e-4)).to.be.true;
    });
  });

  describe('_verticalRows', () => {
    const w = new Wavelet();

    it('reuses a sufficiently large scratch buffer', () => {
      const rows = w._verticalRows(4, 3);
      const rows2 = w._verticalRows(4, 2);
      expect(rows).to.equal(rows2);
      expect(rows.length).to.be.at.least(3);
    });
  });

  describe('_iDwtVerticalIrv97', () => {
    const w = new Wavelet();

    it('reconstructs a flat signal from one low and one high row', () => {
      const out = new Float64Array(4);
      w._iDwtVerticalIrv97(new Float64Array([10, 10]), new Float64Array([0, 0]), 1, 1, 2, out);
      expect(arrApproxEqual(out, [10, 10, 10, 10], 1e-6)).to.be.true;
    });

    it('runs the lifting ladder on a 2×2 band', () => {
      const out = new Float64Array(6);
      w._iDwtVerticalIrv97(
        new Float64Array([1, 2, 3, 4]),
        new Float64Array([0, 0, 0, 0]),
        2,
        2,
        2,
        out
      );
      expect(
        arrApproxEqual(
          out.subarray(0, 6),
          [0.769826, 1.769826, 1.817456, 2.817456, 3.115087, 4.115087],
          1e-5
        )
      ).to.be.true;
    });
  });

  describe('_bound1dCas1 wrappers', () => {
    const w = new Wavelet();

    it('_bound1dCas1Rev53 delegates to the reversible causal kernel', () => {
      const out = new Float64Array(4);
      w._bound1dCas1Rev53(new Float64Array(0), 0, new Float64Array([6]), 0, 0, 1, out, 0);
      expect(Array.from(out)).to.deep.equal([3, 0, 0, 0]);
    });

    it('_bound1dCas1Irv97 delegates to the irreversible causal kernel', () => {
      const out = new Float64Array(4);
      w._bound1dCas1Irv97(new Float64Array(0), 0, new Float64Array([6]), 0, 0, 1, out, 0);
      expect(Array.from(out)).to.deep.equal([6, 0, 0, 0]);
    });
  });
});
