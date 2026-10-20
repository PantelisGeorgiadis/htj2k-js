//#region TagTree
class TagTree {
  /**
   * Creates an instance of TagTree.
   * @constructor
   * @param {number} numleafsh - Number of node columns (tree width).
   * @param {number} numleafsv - Number of node rows (tree height).
   */
  constructor(numleafsh, numleafsv) {
    this.numleafsh = numleafsh;
    this.numleafsv = numleafsv;

    // Per-level dimensions, leaf level first, ceil-halving until 1x1.
    const dimsW = [];
    const dimsH = [];
    let w = numleafsh;
    let h = numleafsv;
    let numNodes = 0;
    for (;;) {
      dimsW.push(w);
      dimsH.push(h);
      numNodes += w * h;
      const done = w === 1 && h === 1;
      w = (w + 1) >> 1;
      h = (h + 1) >> 1;
      if (done) {
        break;
      }
    }
    this.dimsW = dimsW;
    this.dimsH = dimsH;
    this.numNodes = numNodes;
    this.value = new Int32Array(numNodes);
    this.low = new Int32Array(numNodes);

    // Parent index for every node except the root (root parent = -1).
    // The walk mirrors OpenJPEG's opj_tgt_create node linkage exactly:
    // horizontal pairs of children share a parent; on even rows the parent
    // cursor restarts at the row's first parent while the "next row" anchor
    // advances by the row's node count.
    this.parent = new Int32Array(numNodes).fill(-1);
    let node = 0;
    let parentNode = numleafsh * numleafsv;
    let parentNode0 = parentNode;
    const numLevels = dimsW.length;
    for (let i = 0; i < numLevels - 1; ++i) {
      for (let j = 0; j < dimsH[i]; ++j) {
        let k = dimsW[i];
        while (--k >= 0) {
          this.parent[node++] = parentNode;
          if (--k >= 0) {
            this.parent[node++] = parentNode;
          }
          ++parentNode;
        }
        if (j & 1 || j === dimsH[i] - 1) {
          parentNode0 = parentNode;
        } else {
          parentNode = parentNode0;
          parentNode0 += dimsW[i];
        }
      }
    }
    this.reset();
  }

  /**
   * Resets all node values (opj_tgt_reset).
   * @method
   */
  reset() {
    this.value.fill(999);
    this.low.fill(0);
  }

  /**
   * Decodes the value at a leaf (opj_tgt_decode). Bit reads go through the
   * supplied callback.
   * @method
   * @param {Function} readBit - Callback returning one bit (0 or 1) per call.
   * @param {number} leafno - Leaf index (row-major within the precinct grid).
   * @param {number} threshold - Decode threshold.
   * @returns {boolean} True when the leaf value is below the threshold.
   */
  decode(readBit, leafno, threshold) {
    // Collect the path from the leaf up to (but excluding) the root.
    const stk = [];
    let n = leafno;
    while (this.parent[n] !== -1) {
      stk.push(n);
      n = this.parent[n];
    }

    let low = 0;
    for (;;) {
      if (low > this.low[n]) {
        this.low[n] = low;
      } else {
        low = this.low[n];
      }
      while (low < threshold && low < this.value[n]) {
        if (readBit()) {
          this.value[n] = low;
        } else {
          ++low;
        }
      }
      this.low[n] = low;
      if (stk.length === 0) {
        break;
      }
      n = stk.pop();
    }

    return this.value[leafno] < threshold;
  }

  /**
   * Floor of log2 for a positive integer (opj_uint_floorlog2).
   * @param {number} v - Positive integer.
   * @returns {number} floor(log2(v)).
   */
  static _floorLog2(v) {
    let n = 0;
    while (v > 1) {
      v >>>= 1;
      ++n;
    }
    return n;
  }
}
//#endregion


//#region Exports
module.exports = { TagTree };
//#endregion

