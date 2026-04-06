const { Point, Rectangle, Size } = require('./Helpers');
const { SubBandType } = require('./Constants');
const { TagTree, InclusionTree } = require('./Tree');

//#region Tile
class Tile {
  /**
   * Creates an instance of Tile.
   * @constructor
   * @param {number} tileIndex - Tile index.
   * @param {Rectangle} tileRect - Tile rectangle.
   * @param {SizSegment} siz - SIZ segment.
   * @param {CodSegment} cod - COD segment.
   * @param {QcdSegment} qcd - QCD segment.
   */
  constructor(tileIndex, tileRect, siz, cod, qcd) {
    this.tileIndex = tileIndex;
    this.tileRect = tileRect;
    this.cod = cod;
    this.tileParts = [];
    this.tileComponents = [];

    this._createTileComponents(siz, cod, qcd);
  }

  /**
   * Gets tile index.
   * @method
   * @returns {number} Tile index.
   */
  getTileIndex() {
    return this.tileIndex;
  }

  /**
   * Gets tile rectangle.
   * @method
   * @returns {Rectangle} Tile rectangle.
   */
  getTileRectangle() {
    return this.tileRect;
  }

  /**
   * Gets coding style parameters.
   * @method
   * @returns {CodSegment} Coding style parameters.
   */
  getCodingStyleParameters() {
    return this.cod;
  }

  /**
   * Gets tile width.
   * @method
   * @returns {number} Tile width.
   */
  getWidth() {
    const rect = this.getTileRectangle();
    return rect.getSize().getWidth() - rect.getPoint().getX();
  }

  /**
   * Gets tile height.
   * @method
   * @returns {number} Tile height.
   */
  getHeight() {
    const rect = this.getTileRectangle();
    return rect.getSize().getHeight() - rect.getPoint().getY();
  }

  /**
   * Adds a tile part.
   * @method
   * @param {TilePart} tilePart - Tile part.
   */
  addTilePart(tilePart) {
    this.tileParts.push(tilePart);
  }

  /**
   * Gets the tile description.
   * @method
   * @returns {string} Tile description.
   */
  toString() {
    return `Tile [Index: ${this.getTileIndex()}, Width: ${this.getWidth()}, Height: ${this.getHeight()}]`;
  }

  //#region Private Methods
  /**
   * Create empty tile components.
   * @method
   * @private
   * @param {SizSegment} siz - SIZ segment.
   * @param {CodSegment} cod - COD segment.
   * @param {QcdSegment} qcd - QCD segment.
   */
  _createTileComponents(siz, cod, qcd) {
    const components = siz.getComponents();
    let index = 0;
    for (var i = 0; i < components; i++) {
      const tileComponentRect = new Rectangle(
        new Point(
          Math.ceil(this.getTileRectangle().getPoint().getX() / siz.getSubSamplingX(i)),
          Math.ceil(this.getTileRectangle().getPoint().getY() / siz.getSubSamplingY(i))
        ),
        new Size(
          Math.ceil(this.getTileRectangle().getSize().getWidth() / siz.getSubSamplingX(i)),
          Math.ceil(this.getTileRectangle().getSize().getHeight() / siz.getSubSamplingY(i))
        )
      );

      this.tileComponents.push(new TileComponent(index, tileComponentRect, siz, cod, qcd));
      index++;
    }
  }
  //#endregion
}
//#endregion

//#region TilePart
class TilePart {
  /**
   * Creates an instance of TilePart.
   * @constructor
   * @param {SotSegment} sotSegment - SOT segment.
   * @param {number} sodPosition - SOD marker position.
   */
  constructor(sotSegment, sodPosition) {
    this.sotSegment = sotSegment;
    this.sodPosition = sodPosition;
  }
}
//#endregion

//#region TileComponent
class TileComponent {
  /**
   * Creates an instance of TileComponent.
   * @constructor
   * @param {number} tileComponentIndex - Tile component index.
   * @param {Rectangle} tileComponentRect - Tile component rectangle.
   * @param {SizSegment} siz - SIZ segment.
   * @param {CodSegment} cod - COD segment.
   * @param {QcdSegment} qcd - QCD segment.
   */
  constructor(tileComponentIndex, tileComponentRect, siz, cod, qcd) {
    this.tileComponentIndex = tileComponentIndex;
    this.tileComponentRect = tileComponentRect;
    this.siz = siz;
    this.cod = cod;
    this.qcd = qcd;
    this.resolutions = [];

    this._createResolutions();
  }

  /**
   * Gets tile component index.
   * @method
   * @returns {number} Tile component index.
   */
  getTileComponentIndex() {
    return this.tileComponentIndex;
  }

  /**
   * Gets tile component rectangle.
   * @method
   * @returns {Rectangle} Tile component rectangle.
   */
  getTileComponentRectangle() {
    return this.tileComponentRect;
  }

  /**
   * Gets coding style parameters.
   * @method
   * @returns {CodSegment} Coding style parameters.
   */
  getCodingStyleParameters() {
    return this.cod;
  }

  /**
   * Gets quantization parameters.
   * @method
   * @returns {QcdSegment} Quantization parameters.
   */
  getQuantizationParameters() {
    return this.qcd;
  }

  /**
   * Gets bit depth for tile component.
   * @method
   * @returns {number} The bit depth.
   */
  getBitDepth() {
    return this.siz.getBitDepth(this.getTileComponentIndex());
  }

  /**
   * Gets signedness for tile component.
   * @method
   * @returns {number} The signedness.
   */
  isSigned() {
    return this.siz.isSigned(this.getTileComponentIndex());
  }

  /**
   * Gets sub-sampling X for tile component.
   * @method
   * @returns {number} The sub-sampling X.
   */
  getSubSamplingX() {
    return this.siz.getSubSamplingX(this.getTileComponentIndex());
  }

  /**
   * Gets sub-sampling Y for tile component.
   * @method
   * @returns {number} The sub-sampling Y.
   */
  getSubSamplingY() {
    return this.siz.getSubSamplingY(this.getTileComponentIndex());
  }

  /**
   * Gets tile component width.
   * @method
   * @returns {number} Tile component width.
   */
  getWidth() {
    const rect = this.getTileComponentRectangle();
    return rect.getSize().getWidth() - rect.getPoint().getX();
  }

  /**
   * Gets tile component height.
   * @method
   * @returns {number} Tile component height.
   */
  getHeight() {
    const rect = this.getTileComponentRectangle();
    return rect.getSize().getHeight() - rect.getPoint().getY();
  }

  /**
   * Gets the tile component description.
   * @method
   * @returns {string} Tile component description.
   */
  toString() {
    return `Tile Component [Index: ${this.getTileComponentIndex()}, Width: ${this.getWidth()}, Height: ${this.getHeight()}, Bit depth: ${this.getBitDepth(
      0
    )}, Signed: ${this.isSigned()}]`;
  }

  //#region Private Methods
  /**
   * Create empty resolutions.
   * @method
   * @private
   */
  _createResolutions() {
    const cod = this.getCodingStyleParameters();
    let index = 0;
    for (var i = 0; i <= cod.getDecompositionLevels(); i++) {
      var scale = 1 << (cod.getDecompositionLevels() - i);
      const resolutionRect = new Rectangle(
        new Point(
          Math.ceil(this.getTileComponentRectangle().getPoint().getX() / scale),
          Math.ceil(this.getTileComponentRectangle().getPoint().getY() / scale)
        ),
        new Size(
          Math.ceil(this.getTileComponentRectangle().getSize().getWidth() / scale),
          Math.ceil(this.getTileComponentRectangle().getSize().getHeight() / scale)
        )
      );

      const precinctSize = cod.getPrecinctSize(i);
      const logCodeblockSize = cod.getLogCodeblockSize();
      const codeblockSize = new Size(
        i > 0
          ? Math.min(logCodeblockSize.getWidth(), precinctSize.getWidth() - 1)
          : Math.min(logCodeblockSize.getWidth(), precinctSize.getWidth()),
        i > 0
          ? Math.min(logCodeblockSize.getHeight(), precinctSize.getHeight() - 1)
          : Math.min(logCodeblockSize.getHeight(), precinctSize.getHeight())
      );
      const precinctWidth = 1 << precinctSize.getWidth();
      const precinctHeight = 1 << precinctSize.getHeight();

      const numPrecinctsWide =
        resolutionRect.getSize().getWidth() > resolutionRect.getPoint().getX()
          ? Math.ceil(resolutionRect.getSize().getWidth() / precinctWidth) -
            Math.floor(resolutionRect.getPoint().getX() / precinctWidth)
          : 0;
      const numPrecinctsHigh =
        resolutionRect.getSize().getHeight() > resolutionRect.getPoint().getY()
          ? Math.ceil(resolutionRect.getSize().getHeight() / precinctHeight) -
            Math.floor(resolutionRect.getPoint().getY() / precinctHeight)
          : 0;

      const precinctParams = {
        precinctWidth,
        precinctHeight,
        precinctWidthInSubBand: 1 << (precinctSize.getWidth() + (i === 0 ? 0 : -1)),
        precinctHeightInSubBand: 1 << (precinctSize.getHeight() + (i === 0 ? 0 : -1)),
        numPrecinctsWide,
        numPrecinctsHigh,
        numPrecincts: numPrecinctsWide * numPrecinctsHigh,
      };
      const codeblockParams = {
        codeblockSize,
        scale,
      };

      this.resolutions.push(
        new Resolution(index, resolutionRect, i, precinctParams, codeblockParams)
      );
      index++;
    }
  }
  //#endregion
}
//#endregion

//#region Resolution
class Resolution {
  /**
   * Creates an instance of Resolution.
   * @constructor
   * @param {number} resolutionIndex - Resolution index.
   * @param {Rectangle} resolutionRect - Resolution rectangle.
   * @param {number} decompositionLevel - Decomposition level.
   * @param {Object} precinctParams - Precinct parameters.
   * @param {Object} codeblockParams - Codeblock parameters.
   */
  constructor(
    resolutionIndex,
    resolutionRect,
    decompositionLevel,
    precinctParams,
    codeblockParams
  ) {
    this.resolutionIndex = resolutionIndex;
    this.resolutionRect = resolutionRect;
    this.decompositionLevel = decompositionLevel;
    this.precinctParams = precinctParams;
    this.codeblockParams = codeblockParams;
    this.subBands = [];

    this._createSubBands();
  }

  /**
   * Gets resolution index.
   * @method
   * @returns {number} Resolution index.
   */
  getResolutionIndex() {
    return this.resolutionIndex;
  }

  /**
   * Gets resolution rectangle.
   * @method
   * @returns {Rectangle} Resolution rectangle.
   */
  getResolutionRectangle() {
    return this.resolutionRect;
  }

  /**
   * Gets decomposition level.
   * @method
   * @returns {number} Decomposition level.
   */
  getDecompositionLevel() {
    return this.decompositionLevel;
  }

  /**
   * Gets precinct parameters.
   * @method
   * @returns {Object} Precinct parameters.
   */
  getPrecinctParameters() {
    return this.precinctParams;
  }

  /**
   * Gets codeblock parameters.
   * @method
   * @returns {Object} Codeblock parameters.
   */
  getCodeblockParameters() {
    return this.codeblockParams;
  }

  //#region Private Methods
  /**
   * Create sub-bands for this resolution level.
   * @method
   * @private
   */
  _createSubBands() {
    const curr = this.resolutionRect;
    const cx0 = curr.getPoint().getX();
    const cy0 = curr.getPoint().getY();
    const cx1 = curr.getSize().getWidth();
    const cy1 = curr.getSize().getHeight();

    if (this.decompositionLevel === 0) {
      // Resolution 0: single LL subband, same rect as resolution
      const llRect = new Rectangle(new Point(cx0, cy0), new Size(cx1, cy1));
      this.subBands.push(
        new SubBand(0, SubBandType.Ll, llRect, this.precinctParams, this.codeblockParams)
      );
    } else {
      // Previous (lower) resolution rect – derived via ceil(curr/2)
      const px0 = Math.ceil(cx0 / 2);
      const py0 = Math.ceil(cy0 / 2);
      const px1 = Math.ceil(cx1 / 2);
      const py1 = Math.ceil(cy1 / 2);
      // High-pass coordinate ranges
      const hx0 = Math.floor(cx0 / 2);
      const hy0 = Math.floor(cy0 / 2);
      const hx1 = Math.floor(cx1 / 2);
      const hy1 = Math.floor(cy1 / 2);
      // HL: high-x, low-y
      const hlRect = new Rectangle(new Point(hx0, py0), new Size(hx1, py1));
      // LH: low-x, high-y
      const lhRect = new Rectangle(new Point(px0, hy0), new Size(px1, hy1));
      // HH: high-x, high-y
      const hhRect = new Rectangle(new Point(hx0, hy0), new Size(hx1, hy1));
      this.subBands.push(
        new SubBand(0, SubBandType.Hl, hlRect, this.precinctParams, this.codeblockParams)
      );
      this.subBands.push(
        new SubBand(1, SubBandType.Lh, lhRect, this.precinctParams, this.codeblockParams)
      );
      this.subBands.push(
        new SubBand(2, SubBandType.Hh, hhRect, this.precinctParams, this.codeblockParams)
      );
    }
  }
  //#endregion
}
//#endregion

//#region SubBand
class SubBand {
  /**
   * Creates an instance of SubBand.
   * @constructor
   * @param {number} subBandIndex - Sub-band index.
   * @param {SubBandType} subBandType - Sub-band type.
   * @param {Rectangle} subBandRect - Sub-band rectangle.
   * @param {Object} [precinctParams] - Precinct parameters.
   * @param {Object} [codeblockParams] - Codeblock parameters.
   */
  constructor(subBandIndex, subBandType, subBandRect, precinctParams, codeblockParams) {
    this.subBandIndex = subBandIndex;
    this.subBandType = subBandType;
    this.subBandRect = subBandRect;
    this.codeblocks = [];
    this.precincts = [];
    if (precinctParams && codeblockParams) {
      this._createCodeblocksAndPrecincts(precinctParams, codeblockParams);
    }
  }

  /**
   * Gets sub-band index.
   * @method
   * @returns {number} Sub-band index.
   */
  getSubBandIndex() {
    return this.subBandIndex;
  }

  /**
   * Gets sub-band type.
   * @method
   * @returns {SubBandType} Sub-band type.
   */
  getSubBandType() {
    return this.subBandType;
  }

  /**
   * Gets sub-band rectangle.
   * @method
   * @returns {Rectangle} Sub-band rectangle.
   */
  getSubBandRectangle() {
    return this.subBandRect;
  }

  //#region Private Methods
  /**
   * Create codeblocks and precincts for this sub-band.
   * @method
   * @private
   */
  _createCodeblocksAndPrecincts(precinctParams, codeblockParams) {
    const x0 = this.subBandRect.getPoint().getX();
    const y0 = this.subBandRect.getPoint().getY();
    const x1 = this.subBandRect.getSize().getWidth();
    const y1 = this.subBandRect.getSize().getHeight();
    if (x1 <= x0 || y1 <= y0) return;

    const { precinctWidthInSubBand, precinctHeightInSubBand, numPrecinctsWide, numPrecinctsHigh } =
      precinctParams;
    const cbLogW = codeblockParams.codeblockSize.getWidth();
    const cbLogH = codeblockParams.codeblockSize.getHeight();
    const cbW = 1 << cbLogW;
    const cbH = 1 << cbLogH;

    const cbGridX0 = Math.floor(x0 / cbW);
    const cbGridY0 = Math.floor(y0 / cbH);
    const cbGridX1 = Math.ceil(x1 / cbW);
    const cbGridY1 = Math.ceil(y1 / cbH);
    const totalCbsWide = Math.max(0, cbGridX1 - cbGridX0);
    const totalCbsHigh = Math.max(0, cbGridY1 - cbGridY0);

    this.cbGridX0 = cbGridX0;
    this.cbGridY0 = cbGridY0;
    this.totalCbsWide = totalCbsWide;
    this.totalCbsHigh = totalCbsHigh;

    for (let cby = 0; cby < totalCbsHigh; cby++) {
      for (let cbx = 0; cbx < totalCbsWide; cbx++) {
        const cbx0 = Math.max((cbGridX0 + cbx) * cbW, x0);
        const cby0 = Math.max((cbGridY0 + cby) * cbH, y0);
        const cbx1 = Math.min((cbGridX0 + cbx + 1) * cbW, x1);
        const cby1 = Math.min((cbGridY0 + cby + 1) * cbH, y1);
        this.codeblocks.push({
          cbx0,
          cby0,
          cbx1,
          cby1,
          cbGridX: cbx,
          cbGridY: cby,
          passes: 0,
          lengths1: 0,
          lengths2: 0,
          missingMSBs: 0,
          data: null,
          coeffs: null,
        });
      }
    }

    // Convert precinct size from subband-sample units to codeblock-grid units
    const precCbsW = precinctWidthInSubBand >> cbLogW;
    const precCbsH = precinctHeightInSubBand >> cbLogH;

    for (let py = 0; py < numPrecinctsHigh; py++) {
      for (let px = 0; px < numPrecinctsWide; px++) {
        const cbOffX = px * precCbsW;
        const cbOffY = py * precCbsH;
        const cbsW = Math.min(precCbsW, totalCbsWide - cbOffX);
        const cbsH = Math.min(precCbsH, totalCbsHigh - cbOffY);
        if (cbsW > 0 && cbsH > 0) {
          this.precincts.push({
            px,
            py,
            cbOffX,
            cbOffY,
            cbsW,
            cbsH,
            inclusionTree: new InclusionTree(cbsW, cbsH),
            zeroBitTree: new TagTree(cbsW, cbsH),
            included: new Uint8Array(cbsW * cbsH),
          });
        }
      }
    }
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = { Tile, TilePart, TileComponent, Resolution, SubBand };
//#endregion
