const { TagTree } = require('./../src/Tree');

const chai = require('chai');
const expect = chai.expect;

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
