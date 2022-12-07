const Codestream = require('./Codestream');
const Decoder = require('./Decoder');
const {
  Segment,
  SizSegment,
  CapSegment,
  CodSegment,
  QcdSegment,
  ComSegment,
  SotSegment,
} = require('./Segment');
const { Box, BoxReader } = require('./Box');
const {
  J2kFormat,
  Marker,
  ProgressionOrder,
  CodingStyle,
  CodeblockStyle,
  WaveletTransform,
  SubBandType,
} = require('./Constants');
const { Tile, TilePart, TileComponent, Resolution, SubBand } = require('./Coding');
const { Point, Size, Rectangle } = require('./Helpers');
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
  Segment,
  SizSegment,
  CapSegment,
  CodSegment,
  QcdSegment,
  ComSegment,
  SotSegment,
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
};
//#endregion

//#region constants
const constants = {
  J2kFormat,
  Marker,
  ProgressionOrder,
  CodingStyle,
  CodeblockStyle,
  WaveletTransform,
  SubBandType,
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
