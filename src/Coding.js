const { Rectangle, Point, Size } = require('./Helpers');

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
   * @return {string} Tile component description.
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
      /*const codeblockSize = cod.getLogCodeblockSize();
      const blockSize = new Size(
        i > 0
          ? Math.min(codeblockSize.getWidth(), precinctSize.getWidth() - 1)
          : Math.min(codeblockSize.getWidth(), precinctSize.getWidth()),
        i > 0
          ? Math.min(codeblockSize.getHeight(), precinctSize.getHeight() - 1)
          : Math.min(codeblockSize.getHeight(), precinctSize.getHeight())
      );*/
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

      this.resolutions.push(new Resolution(index, resolutionRect, i, precinctParams));
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
   */
  constructor(resolutionIndex, resolutionRect, decompositionLevel, precinctParams) {
    this.resolutionIndex = resolutionIndex;
    this.resolutionRect = resolutionRect;
    this.decompositionLevel = decompositionLevel;
    this.precinctParams = precinctParams;
    this.subBands = [];
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
}
//#endregion

//#region SubBand
class SubBand {
  /**
   * Creates an instance of SubBand.
   * @constructor
   * @param {number} subBandIndex - Sub-band index.
   * @param {number} subBandType - Sub-band type.
   * @param {Rectangle} subBandRect - Sub-band rectangle.
   */
  constructor(subBandIndex, subBandType, subBandRect) {
    this.subBandIndex = subBandIndex;
    this.subBandType = subBandType;
    this.subBandRect = subBandRect;
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
   * @returns {Rectangle} sub-band type.
   */
  getSubBandType() {
    return this.subBandType;
  }

  /**
   * Gets sub-band rectangle.
   * @method
   * @returns {Rectangle} sub-band rectangle.
   */
  getSubBandRectangle() {
    return this.subBandRect;
  }
}
//#endregion

//#region Exports
module.exports = { Tile, TilePart, TileComponent, Resolution, SubBand };
//#endregion
