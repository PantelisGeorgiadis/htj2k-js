const { MathFunction } = require('./Helpers');

//#region TagTree
class TagTree {
  /**
   * Creates an instance of TagTree.
   * @constructor
   * @param {number} width - Width.
   * @param {number} height - Height.
   */
  constructor(width, height) {
    const levelsLength = MathFunction.log2(Math.max(width, height)) + 1;
    this.levels = [];
    this.currentLevel = 0;
    this.value = 0;

    for (let i = 0; i < levelsLength; i++) {
      const level = {
        width: width,
        height: height,
        items: [],
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
   */
  reset(i, j) {
    let currentLevel = 0;
    let value = 0;
    let level;
    while (currentLevel < this.levels.length) {
      level = this.levels[currentLevel];
      const index = i + j * level.width;
      if (level.items[index] !== undefined) {
        value = level.items[index];
        break;
      }
      level.index = index;
      i >>= 1;
      j >>= 1;
      currentLevel++;
    }
    currentLevel--;
    level = this.levels[currentLevel];
    level.items[level.index] = value;
    this.currentLevel = currentLevel;
    delete this.value;
  }

  /**
   * Increments the current level's item value.
   * @method
   */
  incrementValue() {
    const level = this.levels[this.currentLevel];
    level.items[level.index]++;
  }

  /**
   * Advances the current level.
   * @method
   */
  nextLevel() {
    let currentLevel = this.currentLevel;
    let level = this.levels[currentLevel];
    let value = level.items[level.index];
    currentLevel--;
    if (currentLevel < 0) {
      this.value = value;

      return false;
    }

    this.currentLevel = currentLevel;
    level = this.levels[currentLevel];
    level.items[level.index] = value;

    return true;
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
