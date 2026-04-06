const { TagTree, InclusionTree } = require('./../src/Tree');

const chai = require('chai');
const expect = chai.expect;

describe('TagTree', () => {
  it('should create the correct number of levels for a 1×1 tree', () => {
    const tree = new TagTree(1, 1);
    // log2(max(1,1)) = 0, so levelsLength = 1
    expect(tree.levels.length).to.equal(1);
  });

  it('should create the correct number of levels for a 4×4 tree', () => {
    const tree = new TagTree(4, 4);
    // log2(4) = 2, so levelsLength = 3
    expect(tree.levels.length).to.equal(3);
  });

  it('should halve dimensions at each level', () => {
    const tree = new TagTree(4, 4);
    expect(tree.levels[0].width).to.equal(4);
    expect(tree.levels[1].width).to.equal(2);
    expect(tree.levels[2].width).to.equal(1);
  });

  it('should have initial value of 0', () => {
    const tree = new TagTree(2, 2);
    expect(tree.value).to.equal(0);
  });

  it('should position currentLevel at the top after reset on a fresh tree', () => {
    const tree = new TagTree(2, 2);
    tree.reset(0, 0);
    // Fresh tree has no defined items; reset walks all levels, ends at top (levelsLength-1 = 1)
    expect(tree.currentLevel).to.equal(tree.levels.length - 1);
  });

  it('should delete this.value after reset', () => {
    const tree = new TagTree(2, 2);
    tree.reset(0, 0);
    expect(tree.value).to.equal(undefined);
  });

  it('should incrementValue at the current level', () => {
    const tree = new TagTree(2, 2);
    tree.reset(0, 0);
    const topLevel = tree.levels[tree.currentLevel];
    const idx = topLevel.index;
    expect(topLevel.items[idx]).to.equal(0);
    tree.incrementValue();
    expect(topLevel.items[idx]).to.equal(1);
  });

  it('should return true from nextLevel when deeper levels remain', () => {
    const tree = new TagTree(2, 2);
    tree.reset(0, 0);
    // currentLevel is 1 (top of 2-level tree); moving down to 0 should return true
    expect(tree.nextLevel()).to.equal(true);
    expect(tree.currentLevel).to.equal(0);
  });

  it('should return false from nextLevel when at the leaf and set this.value', () => {
    const tree = new TagTree(1, 1);
    tree.reset(0, 0);
    // 1-level tree: currentLevel is 0 (already at leaf after reset)
    const result = tree.nextLevel();
    expect(result).to.equal(false);
    expect(tree.value).to.not.equal(undefined);
  });

  it('should propagate incremented value down through nextLevel', () => {
    const tree = new TagTree(2, 2);
    tree.reset(0, 0);
    tree.incrementValue(); // top-level item becomes 1
    tree.nextLevel(); // descend to level 0, propagating value
    tree.nextLevel(); // descend past leaf, sets this.value
    expect(tree.value).to.equal(1);
  });

  it('should support non-square dimensions', () => {
    const tree = new TagTree(4, 2);
    // log2(max(4,2)) = log2(4) = 2, levelsLength = 3
    expect(tree.levels.length).to.equal(3);
    expect(tree.levels[0].width).to.equal(4);
    expect(tree.levels[0].height).to.equal(2);
  });
});

describe('InclusionTree', () => {
  it('should create the correct number of levels for a 1×1 tree', () => {
    const tree = new InclusionTree(1, 1);
    expect(tree.levels.length).to.equal(1);
  });

  it('should create the correct number of levels for a 4×4 tree', () => {
    const tree = new InclusionTree(4, 4);
    // log2(4) = 2, levelsLength = 3
    expect(tree.levels.length).to.equal(3);
  });

  it('should initialize all items and status to zero', () => {
    const tree = new InclusionTree(2, 2);
    for (const level of tree.levels) {
      for (let i = 0; i < level.items.length; i++) {
        expect(level.items[i]).to.equal(0);
        expect(level.status[i]).to.equal(0);
      }
    }
  });

  it('should position currentLevel at the top after reset', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    expect(tree.currentLevel).to.equal(tree.levels.length - 1);
  });

  it('should store the stopValue after reset', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 5);
    expect(tree.currentStopValue).to.equal(5);
  });

  it('should return false from isAboveThreshold when items are zero and stopValue is 0', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    expect(tree.isAboveThreshold()).to.equal(false);
  });

  it('should return true from isAboveThreshold after incrementValue with stopValue 0', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    tree.incrementValue();
    expect(tree.isAboveThreshold()).to.equal(true);
  });

  it('should return false from isKnown before setKnown', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    tree.nextLevel(); // move to leaf level
    expect(tree.isKnown()).to.equal(false);
  });

  it('should return true from isKnown after setKnown', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    tree.nextLevel(); // move to leaf level
    tree.setKnown();
    expect(tree.isKnown()).to.equal(true);
  });

  it('should return false from isLeaf when at top level of a 2×2 tree', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    expect(tree.isLeaf()).to.equal(false);
  });

  it('should return true from isLeaf when at level 0', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    tree.nextLevel(); // descend to level 0
    expect(tree.isLeaf()).to.equal(true);
  });

  it('should return true from nextLevel when deeper levels remain', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    expect(tree.nextLevel()).to.equal(true);
  });

  it('should return false from nextLevel when already at leaf', () => {
    const tree = new InclusionTree(1, 1);
    tree.reset(0, 0, 0);
    // 1-level tree: already at leaf after reset
    expect(tree.nextLevel()).to.equal(false);
  });

  it('should propagate minValue down through nextLevel', () => {
    const tree = new InclusionTree(2, 2);
    tree.reset(0, 0, 0);
    tree.incrementValue(); // top item becomes 1, minValue becomes 1
    tree.nextLevel(); // descend: level[0].items[index] < minValue, so set to 1
    const level = tree.levels[tree.currentLevel];
    expect(level.items[level.index]).to.equal(1);
  });
});
