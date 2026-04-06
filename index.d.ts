import log from 'loglevel';

declare namespace BoxType {
  const Undefined: number;
  const Jp2SignatureBox: number;
  const FileTypeBox: number;
  const Jp2HeaderBox: number;
  const ImageHeaderBox: number;
  const BitsPerCompBox: number;
  const ColorSpecBox: number;
  const PaletteBox: number;
  const CompMapBox: number;
  const ChannelDefBox: number;
  const ResolutionBox: number;
  const CaptureResBox: number;
  const DisplayResBox: number;
  const CodestreamBox: number;
  const IntellectPropRightsBox: number;
  const XmlBox: number;
  const UuidBox: number;
  const UuidInfoBox: number;
  const UuidListBox: number;
  const UrlBox: number;
}

declare namespace CodeblockStyle {
  const None: number;
  const SelectiveArithmeticCodingBypass: number;
  const ResetContextProbabilitiesOnCodingPassBoundaries: number;
  const TerminateOnEachCodingPass: number;
  const VerticalCausalContext: number;
  const PredictableTermination: number;
  const SegmentationSymbols: number;
}

declare namespace CodingStyle {
  const None: number;
  const UsePrecincts: number;
  const UseSopMarker: number;
  const UseEphMarker: number;
}

declare namespace EnumeratedColorSpace {
  const sRgb: number;
  const Gray: number;
  const Ycc: number;
}

declare namespace J2kFormat {
  const Unknown: number;
  const RawCodestream: number;
  const CodestreamInBox: number;
}

declare namespace Marker {
  const Soc: number;
  const Cap: number;
  const Siz: number;
  const Cod: number;
  const Tlm: number;
  const Prf: number;
  const Plm: number;
  const Plt: number;
  const Cpf: number;
  const Qcd: number;
  const Qcc: number;
  const Com: number;
  const Sot: number;
  const Sop: number;
  const Eph: number;
  const Sod: number;
  const Eoc: number;
  const Coc: number;
  const Rgn: number;
  const Poc: number;
  const Ppm: number;
  const Ppt: number;
  const Crg: number;
}

declare namespace ProgressionOrder {
  const Lrcp: number;
  const Rlcp: number;
  const Rpcl: number;
  const Pcrl: number;
  const Cprl: number;
}

declare namespace SubBandType {
  const Ll: string;
  const Hl: string;
  const Lh: string;
  const Hh: string;
}

declare namespace WaveletTransform {
  const Irreversible_9_7: number;
  const Reversible_5_3: number;
}

declare class Point {
  /**
   * Creates an instance of Point.
   */
  constructor(x?: number, y?: number);

  /**
   * Gets X value.
   */
  getX(): number;

  /**
   * Sets X value.
   */
  setX(x: number): void;

  /**
   * Gets Y value.
   */
  getY(): number;

  /**
   * Sets Y value.
   */
  setY(y: number): void;

  /**
   * Gets the point description.
   */
  toString(): string;
}

declare class Size {
  /**
   * Creates an instance of Size.
   */
  constructor(width?: number, height?: number);

  /**
   * Gets width value.
   */
  getWidth(): number;

  /**
   * Sets width value.
   */
  setWidth(width: number): void;

  /**
   * Gets height value.
   */
  getHeight(): number;

  /**
   * Sets height value.
   */
  setHeight(height: number): void;

  /**
   * Gets area.
   */
  getArea(): number;

  /**
   * Gets the size description.
   */
  toString(): string;
}

declare class Rectangle {
  /**
   * Creates an instance of Rectangle.
   */
  constructor(point?: Point, size?: Size);

  /**
   * Gets point.
   */
  getPoint(): Point;

  /**
   * Sets point.
   */
  setPoint(point: Point): void;

  /**
   * Gets size.
   */
  getSize(): Size;

  /**
   * Sets size.
   */
  setSize(size: Size): void;

  /**
   * Gets the rectangle description.
   */
  toString(): string;
}

declare class TagTree {
  /**
   * Creates an instance of TagTree.
   */
  constructor(width: number, height: number);

  /**
   * Resets the tree.
   */
  reset(i: number, j: number): void;

  /**
   * Increments the current level's item value.
   */
  incrementValue(): void;

  /**
   * Advances the current level.
   */
  nextLevel(): boolean;
}

declare class InclusionTree {
  /**
   * Creates an instance of InclusionTree.
   */
  constructor(width: number, height: number);

  /**
   * Resets the tree.
   */
  reset(i: number, j: number, stopValue: number): void;

  /**
   * Increments the current level's item value.
   */
  incrementValue(): void;

  /**
   * Advances the current level.
   */
  nextLevel(): boolean;

  /**
   * Checks whether the current level is zero.
   */
  isLeaf(): boolean;

  /**
   * Checks whether the current level's item value is above threshold.
   */
  isAboveThreshold(): boolean;

  /**
   * Checks whether the current level's status is above zero.
   */
  isKnown(): boolean;

  /**
   * Sets current level's status to one.
   */
  setKnown(): void;
}

declare class Box {
  /**
   * Creates an instance of Box.
   */
  constructor(type: number, position: number, buffer: ArrayBuffer);

  /**
   * Gets box type.
   */
  getType(): number;

  /**
   * Gets box position.
   */
  getPosition(): number;

  /**
   * Gets box buffer.
   */
  getBuffer(): ArrayBuffer;

  /**
   * Gets box length.
   */
  getLength(): number;

  /**
   * Parses the box.
   */
  parse(): void;

  /**
   * Gets the box description.
   */
  toString(): string;
}

declare class BoxReader {
  /**
   * Creates an instance of BoxReader.
   */
  constructor(buffer: ArrayBuffer, opts?: { logBoxes?: boolean });

  /**
   * Gets boxes.
   */
  getBoxes(): Array<Box>;

  /**
   * Reads boxes.
   */
  readBoxes(): void;
}

declare class FileTypeBox extends Box {
  /**
   * Creates an instance of FileTypeBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the brand.
   */
  getBrand(): number;

  /**
   * Gets the minor version.
   */
  getMinorVersion(): number;

  /**
   * Gets the compatibility list.
   */
  getCompatibilityList(): Array<number>;
}

declare class Jp2SignatureBox extends Box {
  /**
   * Creates an instance of Jp2SignatureBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the signature.
   */
  getSignature(): number;

  /**
   * Checks if the signature is valid.
   */
  isSignatureValid(): boolean;
}

declare class ImageHeaderBox extends Box {
  /**
   * Creates an instance of ImageHeaderBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the width.
   */
  getWidth(): number;

  /**
   * Gets the height.
   */
  getHeight(): number;

  /**
   * Gets the number of components.
   */
  getComponents(): number;

  /**
   * Gets the bit depth.
   */
  getBitDepth(): number;

  /**
   * Gets signedness.
   */
  isSigned(): boolean;

  /**
   * Gets the compression type.
   */
  getCompressionType(): number;

  /**
   * Gets a flag indicating whether the colorspace is unknown.
   */
  getUnknownColorspace(): boolean;

  /**
   * Gets a flag indicating whether there is intellectual property in the file.
   */
  getIntellectualProperty(): boolean;
}

declare class ColorSpecificationBox extends Box {
  /**
   * Creates an instance of ColorSpecificationBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the method to define the color space.
   */
  getMethod(): number;

  /**
   * Gets the precedence.
   */
  getPrecedence(): number;

  /**
   * Gets the approximation accuracy.
   */
  getApproximationAccuracy(): number;

  /**
   * Gets the enumerated color space.
   */
  getEnumeratedColorSpace(): number;

  /**
   * Gets the raw bytes of the ICC color profile.
   */
  getIccProfileData(): Uint8Array | undefined;
}

declare class XmlBox extends Box {
  /**
   * Creates an instance of XmlBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the XML text.
   */
  getXml(): string;
}

declare class UrlBox extends Box {
  /**
   * Creates an instance of UrlBox.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the version.
   */
  getVersion(): number;

  /**
   * Gets the flags.
   */
  getFlags(): number;

  /**
   * Gets the URL.
   */
  getUrl(): string;
}

declare class Segment {
  /**
   * Creates an instance of Segment.
   */
  constructor(marker: number, position: number, buffer: ArrayBuffer);

  /**
   * Gets segment marker.
   */
  getMarker(): number;

  /**
   * Gets segment position in codestream.
   */
  getPosition(): number;

  /**
   * Gets segment buffer.
   */
  getBuffer(): ArrayBuffer;

  /**
   * Gets segment length (including marker).
   */
  getLength(): number;

  /**
   * Parses the segment.
   */
  parse(): void;

  /**
   * Gets the segment description.
   */
  toString(): string;
}

declare class SizSegment extends Segment {
  /**
   * Creates an instance of SizSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets the profile.
   */
  getProfile(): number;

  /**
   * Gets the reference grid size.
   */
  getRefGridSize(): Size;

  /**
   * Gets the image offset.
   */
  getImageOffset(): Point;

  /**
   * Gets the reference tile size.
   */
  getTileSize(): Size;

  /**
   * Gets the tile offset.
   */
  getTileOffset(): Point;

  /**
   * Gets number of components.
   */
  getComponents(): number;

  /**
   * Gets bit depth for a component.
   */
  getBitDepth(component: number): number;

  /**
   * Gets signedness for a component.
   */
  isSigned(component: number): boolean;

  /**
   * Gets sub-sampling X for a component.
   */
  getSubSamplingX(component: number): number;

  /**
   * Gets sub-sampling Y for a component.
   */
  getSubSamplingY(component: number): number;

  /**
   * Gets width for a component.
   */
  getWidth(component: number): number;

  /**
   * Gets height for a component.
   */
  getHeight(component: number): number;

  /**
   * Gets number of tiles.
   */
  getNumberOfTiles(): Size;
}

declare class CapSegment extends Segment {
  /**
   * Creates an instance of CapSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets capabilities.
   */
  getCapabilities(): number;
}

declare class CodSegment extends Segment {
  /**
   * Creates an instance of CodSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets coding style.
   */
  getCodingStyle(): number;

  /**
   * Gets whether precincts are used.
   */
  usePrecincts(): boolean;

  /**
   * Gets whether SOP marker is used.
   */
  useSopMarker(): boolean;

  /**
   * Gets whether EPH marker is used.
   */
  useEphMarker(): boolean;

  /**
   * Gets progression order.
   */
  getProgressionOrder(): number;

  /**
   * Gets the number of quality layers.
   */
  getQualityLayers(): number;

  /**
   * Gets whether color transform is employed.
   */
  isEmployingColorTransform(): boolean;

  /**
   * Gets decomposition levels.
   */
  getDecompositionLevels(): number;

  /**
   * Gets codeblock size.
   */
  getCodeblockSize(): Size;

  /**
   * Gets log codeblock size.
   */
  getLogCodeblockSize(): Size;

  /**
   * Gets codeblock style.
   */
  getCodeblockStyle(): number;

  /**
   * Gets wavelet filter.
   */
  getWaveletFilter(): number;

  /**
   * Gets whether the wavelet transform is reversible.
   */
  isReversible(): boolean;

  /**
   * Gets precinct size for a decomposition level.
   */
  getPrecinctSize(level: number): Size;
}

declare class QcdSegment extends Segment {
  /**
   * Creates an instance of QcdSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets decomposition levels.
   */
  getDecompositionLevels(): number;

  /**
   * Gets quantization style.
   */
  getQuantizationStyle(): number;

  /**
   * Gets quantization step size.
   */
  getQuantizationStepSize(): number;
}

declare class SotSegment extends Segment {
  /**
   * Creates an instance of SotSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets tile index.
   */
  getTileIndex(): number;

  /**
   * Gets tile part length.
   */
  getTilePartLength(): number;

  /**
   * Gets tile part index.
   */
  getTilePartIndex(): number;

  /**
   * Gets tile part count.
   */
  getTilePartCount(): number;

  /**
   * Gets the payload length.
   */
  getPayloadLength(): number;
}

declare class TlmSegment extends Segment {
  /**
   * Creates an instance of TlmSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets length of marker segment in bytes.
   */
  getLtlm(): number | undefined;

  /**
   * Gets TLM marker segment index relative to any others in the header.
   */
  getZtlm(): number | undefined;

  /**
   * Gets TLM marker size of Ttlm and Ptlm parameters.
   */
  getStlm(): number | undefined;

  /**
   * Gets array of Ttlm values.
   */
  getTtlm(): Array<number>;

  /**
   * Gets array of Ptlm values.
   */
  getPtlm(): Array<number>;
}

declare class ComSegment extends Segment {
  /**
   * Creates an instance of ComSegment.
   */
  constructor(position: number, buffer: ArrayBuffer);

  /**
   * Gets comment registration.
   */
  getRegistration(): number | undefined;

  /**
   * Gets comment string.
   */
  getComment(): string | undefined;
}

declare class TilePart {
  /**
   * Creates an instance of TilePart.
   */
  constructor(sotSegment: SotSegment, sodPosition: number);
}

declare class Tile {
  /**
   * Creates an instance of Tile.
   */
  constructor(
    tileIndex: number,
    tileRect: Rectangle,
    siz: SizSegment,
    cod: CodSegment,
    qcd: QcdSegment
  );

  /**
   * Gets tile index.
   */
  getTileIndex(): number;

  /**
   * Gets tile rectangle.
   */
  getTileRectangle(): Rectangle;

  /**
   * Gets coding style parameters.
   */
  getCodingStyleParameters(): CodSegment;

  /**
   * Gets tile width.
   */
  getWidth(): number;

  /**
   * Gets tile height.
   */
  getHeight(): number;

  /**
   * Adds a tile part.
   */
  addTilePart(tilePart: TilePart): void;

  /**
   * Gets the tile description.
   */
  toString(): string;
}

declare class TileComponent {
  /**
   * Creates an instance of TileComponent.
   */
  constructor(
    tileComponentIndex: number,
    tileComponentRect: Rectangle,
    siz: SizSegment,
    cod: CodSegment,
    qcd: QcdSegment
  );

  /**
   * Gets tile component index.
   */
  getTileComponentIndex(): number;

  /**
   * Gets tile component rectangle.
   */
  getTileComponentRectangle(): Rectangle;

  /**
   * Gets coding style parameters.
   */
  getCodingStyleParameters(): CodSegment;

  /**
   * Gets quantization parameters.
   */
  getQuantizationParameters(): QcdSegment;

  /**
   * Gets bit depth for tile component.
   */
  getBitDepth(): number;

  /**
   * Gets signedness for tile component.
   */
  isSigned(): boolean;

  /**
   * Gets sub-sampling X for tile component.
   */
  getSubSamplingX(): number;

  /**
   * Gets sub-sampling Y for tile component.
   */
  getSubSamplingY(): number;

  /**
   * Gets tile component width.
   */
  getWidth(): number;

  /**
   * Gets tile component height.
   */
  getHeight(): number;

  /**
   * Gets the tile component description.
   */
  toString(): string;
}

declare class Resolution {
  /**
   * Creates an instance of Resolution.
   */
  constructor(
    resolutionIndex: number,
    resolutionRect: Rectangle,
    decompositionLevel: number,
    precinctParams: object,
    codeblockParams: object
  );

  /**
   * Gets resolution index.
   */
  getResolutionIndex(): number;

  /**
   * Gets resolution rectangle.
   */
  getResolutionRectangle(): Rectangle;

  /**
   * Gets decomposition level.
   */
  getDecompositionLevel(): number;

  /**
   * Gets precinct parameters.
   */
  getPrecinctParameters(): object;

  /**
   * Gets codeblock parameters.
   */
  getCodeblockParameters(): object;
}

declare class SubBand {
  /**
   * Creates an instance of SubBand.
   */
  constructor(
    subBandIndex: number,
    subBandType: string,
    subBandRect: Rectangle,
    precinctParams?: object,
    codeblockParams?: object
  );

  /**
   * Gets sub-band index.
   */
  getSubBandIndex(): number;

  /**
   * Gets sub-band type.
   */
  getSubBandType(): string;

  /**
   * Gets sub-band rectangle.
   */
  getSubBandRectangle(): Rectangle;
}

declare class BinaryReader {
  /**
   * Creates an instance of BinaryReader.
   */
  constructor(buffer: ArrayBuffer, littleEndian?: boolean);

  /**
   * Reads an unsigned integer value.
   */
  readUint32(): number;

  /**
   * Reads a signed integer value.
   */
  readInt32(): number;

  /**
   * Reads an unsigned short value.
   */
  readUint16(): number;

  /**
   * Reads a signed short value.
   */
  readInt16(): number;

  /**
   * Reads a byte value.
   */
  readUint8(): number;

  /**
   * Reads a byte value array.
   */
  readUint8Array(length: number): Uint8Array;

  /**
   * Reads a string.
   */
  readString(length: number): string;

  /**
   * Gets the buffer byte length.
   */
  length(): number;

  /**
   * Gets the read offset.
   */
  position(): number;

  /**
   * Sets the read offset to the given position.
   */
  seek(pos: number): void;

  /**
   * Resets the reading offset.
   */
  reset(): void;

  /**
   * Checks if the reading offset is at or beyond the buffer boundaries.
   */
  isAtEnd(): boolean;

  /**
   * Sets the reading offset to the end of the reading buffer.
   */
  toEnd(): void;
}

declare class BlockDecoder {
  /**
   * Creates an instance of BlockDecoder.
   */
  constructor();

  /**
   * MEL threshold exponent table (13 entries).
   */
  MEL_EXP: Array<number>;

  /**
   * Decodes one HTJ2K cleanup-pass codeblock.
   */
  decodeCodeblock(
    codedData: Uint8Array,
    offset: number,
    missingMSBs: number,
    numPasses: number,
    lengths1: number,
    lengths2: number,
    width: number,
    height: number
  ): Int32Array | null;
}

declare class PacketReader {
  /**
   * Creates an instance of PacketReader.
   */
  constructor();

  /**
   * Reads one HTJ2K packet header and body.
   */
  readPacket(
    buffer: Uint8Array,
    pos: number,
    dataEnd: number,
    layer: number,
    resolution: Resolution,
    precinctIdx: number,
    cod: CodSegment
  ): number;
}

declare class Wavelet {
  /**
   * Creates an instance of Wavelet.
   */
  constructor();

  /**
   * Performs a full multi-resolution IDWT for one tile-component.
   */
  iDwt2d(
    resolutions: Array<{
      width: number;
      height: number;
      ll?: Float64Array;
      hl?: Float64Array;
      lh?: Float64Array;
      hh?: Float64Array;
    }>,
    isReversible: boolean
  ): Float64Array;
}

declare class Codestream {
  /**
   * Creates an instance of Codestream.
   */
  constructor(buffer: ArrayBuffer, opts?: { logSegmentMarkers?: boolean });

  /**
   * Gets segments.
   */
  getSegments(): Array<Segment>;

  /**
   * Reads the codestream header.
   */
  readHeader(): {
    width: number;
    height: number;
    bitDepth: number;
    signed: boolean;
    components: number;
    reversible: boolean;
    decompositionLevels: number;
    progressionOrder: string;
  };

  /**
   * Decodes the codestream.
   */
  decode(opts?: { logSegmentMarkers?: boolean }): {
    components: Array<Int16Array | Uint16Array | Uint8Array>;
    width: number;
    height: number;
    bitDepth: number;
    signed: boolean;
  } | null;
}

declare class Decoder {
  /**
   * Creates an instance of Decoder.
   */
  constructor(buffer: ArrayBuffer, opts?: { logBoxes?: boolean; logSegmentMarkers?: boolean });

  /**
   * Reads the header.
   */
  readHeader(): {
    width: number;
    height: number;
    bitDepth: number;
    signed: boolean;
    components: number;
    reversible: boolean;
    decompositionLevels: number;
    progressionOrder: string;
  };

  /**
   * Performs decoding and rendering.
   */
  decodeAndRender(opts?: Record<string, unknown>): {
    components: Array<Int16Array | Uint16Array | Uint8Array>;
    width: number;
    height: number;
    bitDepth: number;
    signed: boolean;
  } | null;

  /**
   * Performs decoding and rendering to RGBA format.
   */
  decodeAndRenderToRgba(opts?: Record<string, unknown>): {
    data: Uint8Array;
    width: number;
    height: number;
    bitDepth: number;
    signed: boolean;
  } | null;
}

/**
 * Version.
 */
declare const version: string;

export namespace helpers {
  export { Point };
  export { Size };
  export { Rectangle };
}

export namespace tree {
  export { TagTree };
  export { InclusionTree };
}

export namespace boxes {
  export { Box };
  export { BoxReader };
  export { ColorSpecificationBox };
  export { FileTypeBox };
  export { ImageHeaderBox };
  export { Jp2SignatureBox };
  export { UrlBox };
  export { XmlBox };
}

export namespace segments {
  export { CapSegment };
  export { CodSegment };
  export { ComSegment };
  export { QcdSegment };
  export { Segment };
  export { SizSegment };
  export { SotSegment };
  export { TlmSegment };
}

export namespace coding {
  export { Resolution };
  export { SubBand };
  export { Tile };
  export { TileComponent };
  export { TilePart };
}

export namespace constants {
  export { BoxType };
  export { CodeblockStyle };
  export { CodingStyle };
  export { EnumeratedColorSpace };
  export { J2kFormat };
  export { Marker };
  export { ProgressionOrder };
  export { SubBandType };
  export { WaveletTransform };
}

export { BinaryReader, BlockDecoder, Codestream, Decoder, PacketReader, Wavelet, log, version };
