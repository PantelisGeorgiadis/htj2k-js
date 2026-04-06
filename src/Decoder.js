const { BoxType, J2kFormat } = require('./Constants');
const { BoxReader } = require('./Box');
const Codestream = require('./Codestream');

//#region Decoder
class Decoder {
  /**
   * Creates an instance of Decoder.
   * @constructor
   * @param {ArrayBuffer} buffer - Data buffer.
   * @param {Object} [opts] - Decoder options.
   * @param {boolean} [opts.logBoxes] - Flag to indicate whether to log boxes.
   * @param {boolean} [opts.logSegmentMarkers] - Flag to indicate whether to log segment markers.
   */
  constructor(buffer, opts) {
    this.decoderOpts = opts || {};

    this.buffer = buffer;
    this.codestream = undefined;
  }

  /**
   * Reads the header.
   * @method
   * @returns {Object} header Read header result object.
   * @returns {number} header.width width.
   * @returns {number} header.height height.
   * @returns {number} header.bitDepth bitDepth.
   * @returns {boolean} header.signed signed.
   * @returns {number} header.components components.
   * @returns {boolean} header.decompositionLevels decompositionLevels.
   * @returns {string} header.progressionOrder progressionOrder.
   * @throws Error if buffer does not contain an HTJ2K codestream.
   */
  readHeader() {
    const format = this._determineJ2kFormat(this.buffer);
    if (format === J2kFormat.Unknown) {
      throw new Error('Buffer does not contain an HTJ2K codestream (raw or within a box)');
    }

    let codestreamBuffer = this.buffer;
    if (format === J2kFormat.CodestreamInBox) {
      const boxReader = new BoxReader(this.buffer, this.decoderOpts);
      boxReader.readBoxes();
      const boxes = boxReader.getBoxes();
      const firstCodestreamBox = boxes.find((b) => b.getType() === BoxType.CodestreamBox);
      if (!firstCodestreamBox) {
        throw new Error('Buffer does not contain a CodestreamBox');
      }
      codestreamBuffer = firstCodestreamBox.getBuffer();
    }
    this.codestream = new Codestream(codestreamBuffer, this.decoderOpts);

    return this.codestream.readHeader();
  }

  /**
   * Performs decoding and rendering.
   * @method
   * @param {Object} [opts] - Decoding and rendering options.
   * @returns {Object|null} result Decoded and rendered image data and metadata, or null if decoding fails.
   * @returns {Array<Int16Array|Uint16Array|Uint8Array>} result.components rendered components.
   * @returns {number} result.width width.
   * @returns {number} result.height height.
   * @returns {number} result.bitDepth bitDepth.
   * @returns {boolean} result.signed signed.
   */
  decodeAndRender(opts) {
    if (!this.codestream) {
      this.readHeader();
    }

    return this.codestream.decode(opts);
  }

  /**
   * Performs decoding and rendering to RGBA format.
   * @method
   * @param {Object} [opts] - Decoding and rendering options.
   * @returns {Object|null} result Decoded and rendered image data and metadata, or null if decoding fails.
   * @returns {Uint8Array} result.data RGBA image data.
   * @returns {number} result.width width.
   * @returns {number} result.height height.
   * @returns {number} result.bitDepth bitDepth.
   * @returns {boolean} result.signed signed.
   */
  decodeAndRenderToRgba(opts) {
    const { width, height, components, bitDepth, signed } = this.decodeAndRender(opts);
    const numComponents = components.length;
    const clamp = (v) => {
      if (bitDepth <= 8) {
        return Math.max(0, Math.min(255, v));
      }
      const shifted = signed ? v + (1 << (bitDepth - 1)) : v;
      return Math.max(0, Math.min(255, shifted >> (bitDepth - 8)));
    };
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      let r, g, b, a;
      if (numComponents === 1) {
        r = g = b = clamp(components[0][i]);
        a = 255;
      } else {
        r = numComponents > 0 ? clamp(components[0][i]) : 0;
        g = numComponents > 1 ? clamp(components[1][i]) : 0;
        b = numComponents > 2 ? clamp(components[2][i]) : 0;
        a = numComponents > 3 ? clamp(components[3][i]) : 255;
      }
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = a;
    }

    return {
      width,
      height,
      bitDepth,
      signed,
      data: rgba,
    };
  }

  //#region Private Methods
  /**
   * Determines whether the data is a raw codestream or a file (boxed codestream).
   * @method
   * @private
   * @returns {J2kFormat} The determined format type.
   */
  _determineJ2kFormat(buffer) {
    const Jp2Rfc3745Magic = Uint8Array.from([
      0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
    ]);
    const Jp2Magic = Uint8Array.from([0x0d, 0x0a, 0x87, 0x0a]);
    const J2kCodestreamMagic = Uint8Array.from([0xff, 0x4f, 0xff, 0x51]);

    let format = J2kFormat.Unknown;
    const buf12 = new Uint8Array(buffer.slice(0, 12));
    if (
      this._compareUint8ArrayBytes(buf12, Jp2Rfc3745Magic, 12) === true ||
      this._compareUint8ArrayBytes(buf12, Jp2Magic, 4) === true
    ) {
      format = J2kFormat.CodestreamInBox;
    } else if (this._compareUint8ArrayBytes(buf12, J2kCodestreamMagic, 4) === true) {
      format = J2kFormat.RawCodestream;
    }

    return format;
  }

  /**
   * Compares two Uint8Array object for data equality.
   * @method
   * @private
   * @param {Uint8Array} u1 - First array.
   * @param {Uint8Array} u2 - Second array.
   * @param {number} length - Data length to compare.
   * @returns {boolean} Comparison result.
   */
  _compareUint8ArrayBytes(u1, u2, length) {
    for (let i = 0; i < length; i++) {
      if (u1[i] !== u2[i]) {
        return false;
      }
    }

    return true;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Decoder;
//#endregion
