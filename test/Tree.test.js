const { TagTree, InclusionTree } = require('./../src/Tree');

const chai = require('chai');
const expect = chai.expect;

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

describe('TagTree', () => {
  it('should allocate ceil-halved level sizes (2x2 tree has 5 nodes)', () => {
    const tree = new TagTree(2, 2);
    expect(tree.numNodes).to.equal(5);
    expect(tree.dimsW).to.deep.equal([2, 1]);
    expect(tree.dimsH).to.deep.equal([2, 1]);
  });

  it('should allocate a single node for a 1x1 tree', () => {
    const tree = new TagTree(1, 1);
    expect(tree.numNodes).to.equal(1);
  });

  it('should initialize all values to 999 after reset', () => {
    const tree = new TagTree(3, 3);
    tree.value[0] = 5;
    tree.reset();
    expect(tree.value[0]).to.equal(999);
    expect(tree.low[0]).to.equal(0);
  });

  it('should decode 1-bit-included value below threshold', () => {
    const tree = new TagTree(1, 1);
    // Bit 1 at value 0 sets the node to 0 which is below threshold 1.
    expect(tree.decode(() => 1, 0, 1)).to.equal(true);
    // Value is now known: repeated decode consumes no bits.
    let reads = 0;
    expect(
      tree.decode(
        () => {
          reads++;
          return 0;
        },
        0,
        1
      )
    ).to.equal(true);
    expect(reads).to.equal(0);
  });

  it('should decode not-included when the bit is 0', () => {
    const tree = new TagTree(1, 1);
    expect(tree.decode(() => 0, 0, 1)).to.equal(false);
    expect(tree.value[0]).to.equal(999);
    expect(tree.low[0]).to.equal(1);
  });

  it('should link leaf parents to the root on a 2x2 tree', () => {
    const tree = new TagTree(2, 2);
    for (let leaf = 0; leaf < 4; leaf++) {
      expect(tree.parent[leaf]).to.equal(4);
    }
    expect(tree.parent[4]).to.equal(-1);
  });

  it('should compute floor(log2) correctly', () => {
    expect(TagTree._floorLog2(1)).to.equal(0);
    expect(TagTree._floorLog2(2)).to.equal(1);
    expect(TagTree._floorLog2(3)).to.equal(1);
    expect(TagTree._floorLog2(8)).to.equal(3);
    expect(TagTree._floorLog2(255)).to.equal(7);
  });
});
