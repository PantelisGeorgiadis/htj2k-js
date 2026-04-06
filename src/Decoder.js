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
    const pixelCount = width * height;
    const rgba = new Uint8Array(pixelCount * 4);

    // Optimize clamping function based on bit depth
    let clamp;
    if (bitDepth <= 8) {
      clamp = (v) => Math.max(0, Math.min(255, v));
    } else {
      const shift = bitDepth - 8;
      const offset = signed ? 1 << (bitDepth - 1) : 0;
      clamp = (v) => {
        const shifted = (signed ? v + offset : v) >> shift;
        return Math.max(0, Math.min(255, shifted));
      };
    }

    // Cache component arrays to reduce property lookups
    const comp0 = components[0];
    const comp1 = numComponents > 1 ? components[1] : null;
    const comp2 = numComponents > 2 ? components[2] : null;

    if (numComponents === 1) {
      // Grayscale - optimized path
      for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
        const gray = clamp(comp0[i]);
        rgba[j] = gray;
        rgba[j + 1] = gray;
        rgba[j + 2] = gray;
        rgba[j + 3] = 255;
      }
    } else if (numComponents === 3) {
      // RGB without alpha - optimized path
      for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
        rgba[j] = clamp(comp0[i]);
        rgba[j + 1] = clamp(comp1[i]);
        rgba[j + 2] = clamp(comp2[i]);
        rgba[j + 3] = 255;
      }
    } else {
      throw new Error(`Unsupported number of components for RGBA rendering: ${numComponents}`);
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
