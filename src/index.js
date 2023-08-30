const {
  CapSegment,
  CodSegment,
  ComSegment,
  QcdSegment,
  Segment,
  SizSegment,
  SotSegment,
  TlmSegment,
} = require('./Segment');
const {
  Box,
  BoxReader,
  ColorSpecificationBox,
  FileTypeBox,
  ImageHeaderBox,
  Jp2SignatureBox,
  UrlBox,
  XmlBox,
} = require('./Box');
const {
  BoxType,
  CodeblockStyle,
  CodingStyle,
  EnumeratedColorSpace,
  J2kFormat,
  Marker,
  ProgressionOrder,
  SubBandType,
  WaveletTransform,
} = require('./Constants');
const { Resolution, SubBand, Tile, TileComponent, TilePart } = require('./Coding');
const { Point, Rectangle, Size } = require('./Helpers');
const Codestream = require('./Codestream');
const Decoder = require('./Decoder');
const log = require('./log');
const version = require('./version');

//#region helpers
const helpers = {
  Point,
  Size,
  Rectangle,
};
//#endregion

//#region segments
const segments = {
  CapSegment,
  CodSegment,
  ComSegment,
  QcdSegment,
  Segment,
  SizSegment,
  SotSegment,
  TlmSegment,
};
//#endregion

//#region coding
const coding = {
  Tile,
  TilePart,
  TileComponent,
  Resolution,
  SubBand,
};
//#endregion

//#region boxes
const boxes = {
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

//#region constants
const constants = {
  BoxType,
  CodeblockStyle,
  CodingStyle,
  EnumeratedColorSpace,
  J2kFormat,
  Marker,
  ProgressionOrder,
  SubBandType,
  WaveletTransform,
};
//#endregion

const HtJ2kJs = {
  Decoder,
  Codestream,
  coding,
  boxes,
  segments,
  helpers,
  constants,
  log,
  version,
};

//#region Exports
module.exports = HtJ2kJs;
//#endregion
