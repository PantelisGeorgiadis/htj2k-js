const { BoxType, EnumeratedColorSpace } = require('./Constants');
const BinaryReader = require('./BinaryReader');
const log = require('./log');

//#region Box
class Box {
  /**
   * Creates an instance of Box.
   * @constructor
   * @param {BoxType} type - Box type.
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(type, position, buffer) {
    this.type = type;
    this.position = position;
    this.buffer = buffer;
  }

  /**
   * Gets box type.
   * @method
   * @returns {BoxType} Box type.
   */
  getType() {
    return this.type;
  }

  /**
   * Gets box position.
   * @method
   * @returns {number} Box position.
   */
  getPosition() {
    return this.position;
  }

  /**
   * Gets box buffer.
   * @method
   * @returns {ArrayBuffer} Box buffer.
   */
  getBuffer() {
    return this.buffer;
  }

  /**
   * Gets box length.
   * @method
   * @returns {number} Box length.
   */
  getLength() {
    return this.buffer ? this.buffer.byteLength : 0;
  }

  /**
   * Parses the box.
   * @method
   * @throws Error if parse is not implemented.
   */
  parse() {
    throw new Error('parse should be implemented');
  }

  /**
   * Gets the box description.
   * @method
   * @returns {string} Box description.
   */
  toString() {
    return `Box [Type: ${this._typeFromValue(
      this.getType()
    )}, Position: ${this.getPosition()} (0x${this.getPosition().toString(
      16
    )}) Length: ${this.getLength()}]`;
  }

  //#region Private Methods
  /**
   * Gets box type name from value.
   * @method
   * @private
   * @param {number} type - Box type.
   * @returns {string} Box type name.
   */
  _typeFromValue(type) {
    return Object.keys(BoxType).find((m) => BoxType[m] === type) || `0x${type.toString(16)}`;
  }
  //#endregion
}
//#endregion

//#region FileTypeBox
class FileTypeBox extends Box {
  /**
   * Creates an instance of ImageHeaderBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.FileTypeBox, position, buffer);

    this.brand = 0x6a703220;
    this.minorVersion = 0;
    this.compatibilityList = [];
  }

  /**
   * Gets the brand.
   * @method
   * @returns {number} The brand.
   */
  getBrand() {
    return this.brand;
  }

  /**
   * Gets the minor version.
   * @method
   * @returns {number} The minor version.
   */
  getMinorVersion() {
    return this.minorVersion;
  }

  /**
   * Gets the compatibility list.
   * @method
   * @returns {Array<number>} The compatibility list.
   */
  getCompatibilityList() {
    return this.compatibilityList;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);

    this.brand = binaryReader.readUint32();
    this.minorVersion = binaryReader.readUint32();
    const len = (this.getLength() - 8 - binaryReader.position()) / 4;
    if (len > 0) {
      for (let i = 0; i < len; i++) {
        this.compatibilityList.push(binaryReader.readUint32());
      }
    }
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Brand: 0x${this.getBrand().toString(
      '16'
    )}, Minor version: ${this.getMinorVersion()}, Compatibility list: ${this.getCompatibilityList()
      .map((i) => `0x${i.toString('16')}`)
      .join(', ')}]`;
  }
}
//#endregion

//#region Jp2SignatureBox
class Jp2SignatureBox extends Box {
  /**
   * Creates an instance of Jp2SignatureBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.Jp2SignatureBox, position, buffer);

    this.signature = 0;
  }

  /**
   * Gets the signature.
   * @method
   * @returns {number} The signature.
   */
  getSignature() {
    return this.signature;
  }

  /**
   * Gets the brand.
   * @method
   * @returns {boolean} The brand.
   */
  isSignatureValid() {
    return this.signature === 0x0d0a870a;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);
    this.signature = binaryReader.readUint32();
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Signature: 0x${this.getSignature().toString(
      '16'
    )}, Is valid: ${this.isSignatureValid()}]`;
  }
}
//#endregion

//#region ImageHeaderBox
class ImageHeaderBox extends Box {
  /**
   * Creates an instance of ImageHeaderBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.ImageHeaderBox, position, buffer);

    this.width = 0;
    this.height = 0;
    this.components = 0;
    this.precision = 0;
    this.compressionType = 0;
    this.unknownColorspace = 0;
    this.intellectualProperty = 0;
  }

  /**
   * Gets the width.
   * @method
   * @returns {number} The width.
   */
  getWidth() {
    return this.width;
  }

  /**
   * Gets the height.
   * @method
   * @returns {number} The height.
   */
  getHeight() {
    return this.height;
  }

  /**
   * Gets the number of components.
   * @method
   * @returns {number} The number of components.
   */
  getComponents() {
    return this.components;
  }

  /**
   * Gets the bit depth.
   * @method
   * @returns {number} The bit depth.
   */
  getBitDepth() {
    return (this.precision & 0x7f) + 1;
  }

  /**
   * Gets signedness.
   * @method
   * @returns {boolean} The signedness.
   */
  isSigned() {
    return (this.precision & 0x80) !== 0;
  }

  /**
   * Gets the compression type.
   * @method
   * @returns {number} The compression type.
   */
  getCompressionType() {
    return this.compressionType;
  }

  /**
   * Gets a flag indicating whether the colospace is unknown.
   * @method
   * @returns {boolean} Flag indicating whether the colospace is unknown.
   */
  getUnknownColorspace() {
    return this.unknownColorspace === 1;
  }

  /**
   * Gets a flag indicating whether there is intellectual property in the file.
   * @method
   * @returns {boolean} Flag indicating whether there is intellectual property in the file.
   */
  getIntellectualProperty() {
    return this.intellectualProperty === 1;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);

    this.height = binaryReader.readUint32();
    this.width = binaryReader.readUint32();
    this.components = binaryReader.readUint16();
    this.precision = binaryReader.readUint8();
    this.compressionType = binaryReader.readUint8();
    this.unknownColorspace = binaryReader.readUint8();
    this.intellectualProperty = binaryReader.readUint8();
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Width: ${this.getWidth()}, Height: ${this.getHeight()}, Bit depth: ${this.getBitDepth()}, Signed: ${this.isSigned()}, Components: ${this.getComponents()}]`;
  }
}
//#endregion

//#region ColorSpecificationBox
class ColorSpecificationBox extends Box {
  /**
   * Creates an instance of ColorSpecificationBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.ColorSpecBox, position, buffer);

    this.method = 0;
    this.precedence = 0;
    this.approximation = 0;
    this.ecs = 0;
    this.iccProfileData = undefined;
  }

  /**
   * Gets the method to define the color space..
   * @method
   * @returns {number} The method to define the color space.
   */
  getMethod() {
    return this.method;
  }

  /**
   * Gets the precedence.
   * @method
   * @returns {number} The precedence.
   */
  getPrecedence() {
    return this.precedence;
  }

  /**
   * Gets the approximation accuracy.
   * @method
   * @returns {number} The approximation accuracy.
   */
  getApproximationAccuracy() {
    return this.approximation;
  }

  /**
   * Gets the enumerated color space.
   * @method
   * @returns {number} The enumerated color space.
   */
  getEnumeratedColorSpace() {
    return this.ecs;
  }

  /**
   * Gets the raw bytes of the ICC color profile.
   * @method
   * @returns {Uint8Array|undefined} The raw bytes of the ICC color profile or undefined if empty.
   */
  getIccProfileData() {
    return this.iccProfileData;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);

    this.method = binaryReader.readUint8();
    this.precedence = binaryReader.readUint8();
    this.approximation = binaryReader.readUint8();

    if (this.method === 2 || this.method === 3) {
      this.iccProfileData = binaryReader.readUint8Array(
        this.getLength() - 8 - binaryReader.position()
      );
    } else {
      this.ecs = binaryReader.readUint32();
    }
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Method: ${this.getMethod()}, Precedence: ${this.getPrecedence()}, Approximation: ${this.getApproximationAccuracy()}, Enumerated color space: ${
      Object.keys(EnumeratedColorSpace).find(
        (c) => EnumeratedColorSpace[c] === this.getEnumeratedColorSpace()
      ) || this.getEnumeratedColorSpace()
    }]`;
  }
}
//#endregion

//#region XmlBox
class XmlBox extends Box {
  /**
   * Creates an instance of XmlBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.XmlBox, position, buffer);

    this.xml = '';
  }

  /**
   * Gets the XML text.
   * @method
   * @returns {string} The XML text.
   */
  getXml() {
    return this.xml;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);
    this.xml = binaryReader.readString(this.getLength() - 8);
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Xml: ${this.getXml()}]`;
  }
}
//#endregion

//#region UrlBox
class UrlBox extends Box {
  /**
   * Creates an instance of UrlBox.
   * @constructor
   * @param {number} position - Box position in file.
   * @param {ArrayBuffer} buffer - Box buffer.
   */
  constructor(position, buffer) {
    super(BoxType.UrlBox, position, buffer);

    this.version = 0;
    this.flags = 0;
    this.url = '';
  }

  /**
   * Gets the version.
   * @method
   * @returns {number} The version.
   */
  getVersion() {
    return this.version;
  }

  /**
   * Gets the flags.
   * @method
   * @returns {number} The flags.
   */
  getFlags() {
    return this.flags;
  }

  /**
   * Gets the URL.
   * @method
   * @returns {string} The URL.
   */
  getUrl() {
    return this.url;
  }

  /**
   * Parses the box.
   * @method
   */
  parse() {
    const binaryReader = new BinaryReader(this.getBuffer(), false);

    this.version = binaryReader.readUint8();
    this.flags =
      (binaryReader.readUint8() << 16) | (binaryReader.readUint8() << 8) | binaryReader.readUint8();
    this.url = binaryReader.readString(this.getLength() - 8 - binaryReader.position());
  }

  /**
   * Gets the box description.
   * @method
   * @return {string} Box description.
   */
  toString() {
    return `${super.toString()} [Version: ${this.getVersion()}, Flags: ${this.getFlags()}, Url: ${this.getUrl()}]`;
  }
}
//#endregion

//#region BoxReader
class BoxReader {
  /**
   * Creates an instance of BoxReader.
   * @constructor
   * @param {ArrayBuffer} buffer - Boxes buffer.
   * @param {Object} [opts] - Reading options.
   * @param {boolean} [opts.logBoxes] - Flag to indicate whether to log boxes.
   */
  constructor(buffer, opts) {
    opts = opts || {};
    this.logBoxes = opts.logBoxes || false;

    this.binaryReader = new BinaryReader(buffer, false);
    this.boxes = [];
  }

  /**
   * Gets boxes.
   * @method
   * @returns {Array<Box>} Read boxes.
   */
  getBoxes() {
    return this.boxes;
  }

  /**
   * Reads boxes.
   * @method
   */
  readBoxes() {
    this._readBoxesImpl(0);
  }

  //#region Private Methods
  /**
   * Reads boxes implementation.
   * @method
   * @param {number} position - The position to start reading boxes.
   * @throws Error if extended length boxes are found.
   */
  _readBoxesImpl(position) {
    this.binaryReader.seek(position);

    let lastBoxFound = false;
    while (!lastBoxFound) {
      const position = this.binaryReader.position();

      let length = this.binaryReader.readUint32();
      if (position + length === this.binaryReader.length()) {
        lastBoxFound = true;
      }

      const type = this.binaryReader.readUint32();
      if (length === 0) {
        lastBoxFound = true;
        length = this.binaryReader.length() - this.binaryReader.position();
      } else if (length === 1) {
        throw new Error('Extended length boxes are not supported');
      }

      const data = this.binaryReader.readUint8Array(length);
      const dataBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

      // If this is a known box, parse it
      let box = undefined;
      if (type === BoxType.ImageHeaderBox) {
        box = new ImageHeaderBox(position, dataBuffer);
        box.parse();
      } else if (type === BoxType.ColorSpecBox) {
        box = new ColorSpecificationBox(position, dataBuffer);
        box.parse();
      } else if (type === BoxType.FileTypeBox) {
        box = new FileTypeBox(position, dataBuffer);
        box.parse();
      } else if (type === BoxType.Jp2SignatureBox) {
        box = new Jp2SignatureBox(position, dataBuffer);
        box.parse();
      } else if (type === BoxType.XmlBox) {
        box = new XmlBox(position, dataBuffer);
        box.parse();
      } else if (type === BoxType.UrlBox) {
        box = new UrlBox(position, dataBuffer);
        box.parse();
      } else {
        box = new Box(type, position, dataBuffer);
      }

      // Add box to box list
      this._addBox(box);

      // If this is a superbox, read its contents recursively.
      if (this._isSuperBox(box)) {
        this._readBoxesImpl(position + 8);
        return;
      }

      if (!lastBoxFound) {
        this.binaryReader.seek(position + length);
      }
    }
  }

  /**
   * Adds a box.
   * @method
   * @private
   * @param {Box} box - Box.
   */
  _addBox(box) {
    if (this.logBoxes) {
      log.info(box.toString());
    }
    this.boxes.push(box);
  }

  /**
   * Gets whether the provided box is a superbox.
   * @method
   * @private
   * @param {Box} box - Box.
   * @returns {boolean} Flag indicating whether the provided box is a superbox.
   */
  _isSuperBox(box) {
    if (
      box.getType() === BoxType.Jp2HeaderBox ||
      box.getType() === BoxType.ResolutionBox ||
      box.getType() === BoxType.UuidInfoBox
    ) {
      return true;
    }

    return false;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = {
  Box,
  BoxReader,
  ColorSpecificationBox,
  FileTypeBox,
  ImageHeaderBox,
  Jp2SignatureBox,
  UrlBox,
  XmlBox,
};
//#endregion
