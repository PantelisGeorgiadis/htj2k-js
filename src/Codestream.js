const {
  Segment,
  SizSegment,
  CapSegment,
  CodSegment,
  QcdSegment,
  ComSegment,
  SotSegment,
} = require('./Segment');
const { Marker, ProgressionOrder } = require('./Constants');
const log = require('./log');

const DataStream = require('datastream.js');

//#region Codestream
class Codestream {
  /**
   * Creates an instance of Codestream.
   * @constructor
   * @param {ArrayBuffer} buffer - Codestream buffer.
   * @param {Object} [opts] - Decoder options.
   * @param {boolean} [opts.logSegmentMarkers] - Flag to indicate whether
   * to log segment markers.
   */
  constructor(buffer, opts) {
    opts = opts || {};
    this.logSegmentMarkers = opts.logSegmentMarkers || false;

    this.dataStream = new DataStream(buffer);
    this.dataStream.endianness = DataStream.BIG_ENDIAN;
    this.segments = [];
  }

  /**
   * Gets segments.
   * @method
   * @returns {Array<Segment>} Parsed segments.
   */
  getSegments() {
    return this.segments;
  }

  /**
   * Reads the codestream header.
   * @method
   * @returns {Object} header Read header result object.
   * @returns {number} header.width width.
   * @returns {number} header.height height.
   * @returns {number} header.bitDepth bitDepth.
   * @returns {boolean} header.signed signed.
   * @returns {number} header.components components.
   * @returns {boolean} header.decompositionLevels decompositionLevels.
   * @returns {string} header.progressionOrder progressionOrder.
   */
  readHeader() {
    this.dataStream.seek(0);
    this.segments.length = 0;
    let tileFound = false;

    for (;;) {
      // Read next segment
      const { position, marker, data } = this._readNextSegment();

      // Stop at the first SOT marker found and rewind stream
      if (marker === Marker.Sot) {
        this.dataStream.seek(position);
        tileFound = true;
        break;
      }

      // If this is a known segment, parse it
      let segment = undefined;
      if (marker === Marker.Siz) {
        segment = new SizSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Cap) {
        segment = new CapSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Cod) {
        segment = new CodSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Qcd) {
        segment = new QcdSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Com) {
        segment = new ComSegment(position, data);
        segment.parse();
      } else {
        segment = new Segment(marker, position, data);
      }

      // Add segment to segment list
      this._addSegment(segment);
    }

    if (!tileFound) {
      throw Error('Codestream ended before finding a tile segment');
    }
    const mandatorySegments = [Marker.Siz, Marker.Cod, Marker.Qcd].every((m) =>
      this.segments.some((s) => s.getMarker() === m)
    );
    if (!mandatorySegments) {
      throw Error('SIZ, COD and QCD segments are required and were not found');
    }

    const siz = this.segments.find((s) => s.getMarker() === Marker.Siz);
    const cod = this.segments.find((s) => s.getMarker() === Marker.Cod);

    return {
      width: siz.getWidth(0),
      height: siz.getHeight(0),
      bitDepth: siz.getBitDepth(0),
      signed: siz.isSigned(0),
      components: siz.getComponents(),
      reversible: cod.isReversible(),
      decompositionLevels: cod.getDecompositionLevels(),
      progressionOrder: Object.keys(ProgressionOrder)[cod.getProgressionOrder()].toUpperCase(),
    };
  }

  /**
   * Decodes the codestream.
   * @method
   * @param {Object} [opts] - Decoding options.
   */
  decode(opts) {
    opts = opts || {};
    this.b = opts.b || false;

    // Decode was called without reading the header segments first.
    if (this.segments.length === 0) {
      this.readHeader();
    }

    const siz = this.segments.find((s) => s.getMarker() === Marker.Siz);
    if (!siz) {
      throw Error('SIZ segment was not found');
    }

    // Header parsing stopped at first tile
    // Continue iterating over tiles
    for (;;) {
      const { position: tilePosition, data: tileData } = this._readNextSegment();
      const sotSegment = new SotSegment(tilePosition, tileData);
      sotSegment.parse();

      //const tileStartPosition = this.dataStream.position;
      const tilePartIndex = sotSegment.getTilePartIndex();

      if (sotSegment.getTileIndex() > siz.getNumberOfTiles().getArea()) {
        throw Error(`Wrong tile index [${tilePartIndex}]`);
      }
      if (tilePartIndex) {
        if (sotSegment.getTilePartCount() && tilePartIndex >= sotSegment.getTilePartCount()) {
          throw Error('Tile part count should be less than total number of tile parts');
        }
      }

      // Read segments inside tiles
      let sodFound = false;
      for (;;) {
        const { position, marker, data } = this._readNextSegment();
        if (marker === Marker.Sod) {
          this.dataStream.seek(position);
          sodFound = true;
          break;
        }

        const segment = new Segment(marker, position, data);
        this._addSegment(segment);
      }

      if (!sodFound) {
        throw Error(
          `Codestream terminated early before start of data is found for tile indexed ${sotSegment.getTileIndex()} and tile part ${tilePartIndex}`
        );
      }

      this._addSegment(sotSegment);
    }
  }

  //#region Private Methods
  /**
   * Add a segment.
   * @method
   * @private
   * @param {Segment} segment - Segment.
   */
  _addSegment(segment) {
    if (this.logSegmentMarkers) {
      log.info(segment.toString());
    }
    this.segments.push(segment);
  }

  /**
   * Reads the next segment in the codestream.
   * @method
   * @private
   * @returns {Object} segment Read next segment result object.
   * @returns {number} segment.position position.
   * @returns {Marker} segment.marker marker.
   * @returns {number} segment.size size.
   * @returns {ArrayBuffer} segment.data data.
   */
  _readNextSegment() {
    // Position
    const position = this.dataStream.position;

    // Marker
    let marker = this.dataStream.readUint16();
    if ((marker & 0xff00) !== 0xff00) {
      throw Error(`Not a marker: ${marker.toString(16)}`);
    }
    marker &= 0xff;

    // Size
    let length =
      marker !== Marker.Soc &&
      marker !== Marker.Sod &&
      marker !== Marker.Eoc &&
      (marker < 0xd0 || marker > 0xd8)
        ? this.dataStream.readUint16() - 2
        : 0;

    // Data
    length =
      length > this.dataStream.byteLength - this.dataStream.position
        ? this.dataStream.byteLength - this.dataStream.position
        : length;
    let data = length > 0 ? this.dataStream.readUint8Array(length).buffer : undefined;

    return { position, marker, length, data };
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Codestream;
//#endregion
