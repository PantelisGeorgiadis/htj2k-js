const { MathFunction } = require('./Helpers');

//#region TagTree
/**
 * Tag-tree coder exactly as specified in ITU-T T.800 Annex H and implemented
 * by OpenJPEG (src/lib/openjp2/tgt.c). Nodes are stored leaves-first, level
 * by level, with each level's dimensions ceil-halved from the one below
 * (floor((n + 1) / 2)); the final level holds the single root node.
 *
 * These trees PERSIST across packets of a tile and are only reset when a
 * packet of quality layer 0 is parsed for a given (component, resolution,
 * precinct) position (T.800 B.10.2, OpenJPEG opj_t2_read_packet_header).
 * This is what enables multi-layer decoding: the inclusion tree encodes
 * "included at layer L" and the missing-MSBs tree encodes the zero-bitplane
 * count exactly once per codeblock.
 */
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

//#region InclusionTree
class InclusionTree {
  /**
   * Creates an instance of InclusionTree.
   * @constructor
   * @param {number} width - Width.
   * @param {number} height - Height.
   */
  constructor(width, height) {
    const levelsLength = MathFunction.log2(Math.max(width, height)) + 1;
    this.levels = [];
    this.currentStopValue = 0;
    this.minValue = 0;

    for (let i = 0; i < levelsLength; i++) {
      const items = new Uint8Array(width * height);
      const status = new Uint8Array(width * height);
      for (let j = 0, jj = items.length; j < jj; j++) {
        items[j] = 0;
        status[j] = 0;
      }

      const level = {
        width: width,
        height: height,
        items: items,
        status: status,
      };
      this.levels.push(level);

      width = Math.ceil(width / 2);
      height = Math.ceil(height / 2);
    }
  }

  /**
   * Resets the tree.
   * @method
   * @param {number} i - Index.
   * @param {number} j - Index.
   * @param {number} stopValue - Stop value.
   */
  reset(i, j, stopValue) {
    this.currentStopValue = stopValue;
    let currentLevel = 0;
    while (currentLevel < this.levels.length) {
      let level = this.levels[currentLevel];
      let index = i + j * level.width;
      level.index = index;

      i >>= 1;
      j >>= 1;
      currentLevel++;
    }

    this.currentLevel = this.levels.length - 1;
    this.minValue = this.levels[this.currentLevel].items[0];
    return;
  }

  /**
   * Increments the current level's item value.
   * @method
   */
  incrementValue() {
    const level = this.levels[this.currentLevel];
    level.items[level.index] = level.items[level.index] + 1;
    if (level.items[level.index] > this.minValue) {
      this.minValue = level.items[level.index];
    }
  }

  /**
   * Advances the current level.
   * @method
   */
  nextLevel() {
    let currentLevel = this.currentLevel;
    currentLevel--;
    if (currentLevel < 0) {
      return false;
    } else {
      this.currentLevel = currentLevel;
      let level = this.levels[currentLevel];
      if (level.items[level.index] < this.minValue) {
        level.items[level.index] = this.minValue;
      } else if (level.items[level.index] > this.minValue) {
        this.minValue = level.items[level.index];
      }

      return true;
    }
  }

  /**
   * Checks whether the current level is zero.
   * @method
   * @returns {boolean} Flag to indicate whether the current level is zero.
   */
  isLeaf() {
    return this.currentLevel === 0;
  }

  /**
   * Checks whether the current level's item value is above threshold.
   * @method
   * @returns {boolean} Flag to indicate whether the current level's item value is above threshold.
   */
  isAboveThreshold() {
    const levelIndex = this.currentLevel;
    const level = this.levels[levelIndex];

    return level.items[level.index] > this.currentStopValue;
  }

  /**
   * Checks whether the current level's status is above zero.
   * @method
   * @returns {boolean} Flag to indicate whether the current level's status is above zero.
   */
  isKnown() {
    const levelIndex = this.currentLevel;
    const level = this.levels[levelIndex];

    return level.status[level.index] > 0;
  }

  /**
   * Sets current level's status to one.
   * @method
   */
  setKnown() {
    const levelIndex = this.currentLevel;
    const level = this.levels[levelIndex];
    level.status[level.index] = 1;
  }
}
//#endregion

//#region Exports
module.exports = { InclusionTree, TagTree };
//#endregion
