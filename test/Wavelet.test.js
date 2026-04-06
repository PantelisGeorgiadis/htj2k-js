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
    const wavelet = new Wavelet();
    const constVal = 50;
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
      expect(approxEqual(result[i], constVal, 1e-6)).to.be.true;
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
});
