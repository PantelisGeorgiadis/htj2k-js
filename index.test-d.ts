import { expectType, expectError } from 'tsd';
import {
  BinaryReader,
  BlockDecoder,
  Codestream,
  Decoder,
  PacketReader,
  Wavelet,
  log,
  version,
  helpers,
  tree,
  boxes,
  segments,
  coding,
  constants,
} from '.';

// version
expectType<string>(version);

// log
import log2 from 'loglevel';
expectType<typeof log2>(log);

// Point
const point = new helpers.Point();
expectType<helpers.Point>(point);
expectType<number>(point.getX());
expectType<number>(point.getY());
expectType<void>(point.setX(1));
expectType<void>(point.setY(2));
expectType<string>(point.toString());

const pointWithArgs = new helpers.Point(3, 4);
expectType<helpers.Point>(pointWithArgs);

expectError(new helpers.Point('a', 'b'));

// Size
const size = new helpers.Size();
expectType<helpers.Size>(size);
expectType<number>(size.getWidth());
expectType<number>(size.getHeight());
expectType<void>(size.setWidth(10));
expectType<void>(size.setHeight(20));
expectType<number>(size.getArea());
expectType<string>(size.toString());

const sizeWithArgs = new helpers.Size(100, 200);
expectType<helpers.Size>(sizeWithArgs);

expectError(new helpers.Size('w', 'h'));

// Rectangle
const rect = new helpers.Rectangle();
expectType<helpers.Rectangle>(rect);
expectType<helpers.Point>(rect.getPoint());
expectType<helpers.Size>(rect.getSize());
expectType<void>(rect.setPoint(point));
expectType<void>(rect.setSize(size));
expectType<string>(rect.toString());

const rectWithArgs = new helpers.Rectangle(point, size);
expectType<helpers.Rectangle>(rectWithArgs);

expectError(new helpers.Rectangle('p', 's'));

// TagTree
const tagTree = new tree.TagTree(4, 4);
expectType<tree.TagTree>(tagTree);
expectType<void>(tagTree.reset(0, 0));
expectType<void>(tagTree.incrementValue());
expectType<boolean>(tagTree.nextLevel());

expectError(new tree.TagTree());

// InclusionTree
const inclusionTree = new tree.InclusionTree(4, 4);
expectType<tree.InclusionTree>(inclusionTree);
expectType<void>(inclusionTree.reset(0, 0, 1));
expectType<void>(inclusionTree.incrementValue());
expectType<boolean>(inclusionTree.nextLevel());
expectType<boolean>(inclusionTree.isLeaf());
expectType<boolean>(inclusionTree.isAboveThreshold());
expectType<boolean>(inclusionTree.isKnown());
expectType<void>(inclusionTree.setKnown());

expectError(new tree.InclusionTree());

// Box
const buf = new ArrayBuffer(16);
const box = new boxes.Box(1, 0, buf);
expectType<boxes.Box>(box);
expectType<number>(box.getType());
expectType<number>(box.getPosition());
expectType<ArrayBuffer>(box.getBuffer());
expectType<number>(box.getLength());
expectType<void>(box.parse());
expectType<string>(box.toString());

// BoxReader
const boxReader = new boxes.BoxReader(buf);
const boxReaderWithOpts = new boxes.BoxReader(buf, { logBoxes: true });
expectType<boxes.BoxReader>(boxReader);
expectType<Array<boxes.Box>>(boxReader.getBoxes());
expectType<void>(boxReader.readBoxes());

expectError(new boxes.BoxReader());

// FileTypeBox
const fileTypeBox = new boxes.FileTypeBox(0, buf);
expectType<boxes.FileTypeBox>(fileTypeBox);
expectType<number>(fileTypeBox.getBrand());
expectType<number>(fileTypeBox.getMinorVersion());
expectType<Array<number>>(fileTypeBox.getCompatibilityList());

// Jp2SignatureBox
const sigBox = new boxes.Jp2SignatureBox(0, buf);
expectType<boxes.Jp2SignatureBox>(sigBox);
expectType<number>(sigBox.getSignature());
expectType<boolean>(sigBox.isSignatureValid());

// ImageHeaderBox
const imgHeaderBox = new boxes.ImageHeaderBox(0, buf);
expectType<boxes.ImageHeaderBox>(imgHeaderBox);
expectType<number>(imgHeaderBox.getWidth());
expectType<number>(imgHeaderBox.getHeight());
expectType<number>(imgHeaderBox.getComponents());
expectType<number>(imgHeaderBox.getBitDepth());
expectType<boolean>(imgHeaderBox.isSigned());
expectType<number>(imgHeaderBox.getCompressionType());
expectType<boolean>(imgHeaderBox.getUnknownColorspace());
expectType<boolean>(imgHeaderBox.getIntellectualProperty());

// ColorSpecificationBox
const colorSpecBox = new boxes.ColorSpecificationBox(0, buf);
expectType<boxes.ColorSpecificationBox>(colorSpecBox);
expectType<number>(colorSpecBox.getMethod());
expectType<number>(colorSpecBox.getPrecedence());
expectType<number>(colorSpecBox.getApproximationAccuracy());
expectType<number>(colorSpecBox.getEnumeratedColorSpace());
expectType<Uint8Array | undefined>(colorSpecBox.getIccProfileData());

// XmlBox
const xmlBox = new boxes.XmlBox(0, buf);
expectType<boxes.XmlBox>(xmlBox);
expectType<string>(xmlBox.getXml());

// UrlBox
const urlBox = new boxes.UrlBox(0, buf);
expectType<boxes.UrlBox>(urlBox);
expectType<number>(urlBox.getVersion());
expectType<number>(urlBox.getFlags());
expectType<string>(urlBox.getUrl());

// Segment
const seg = new segments.Segment(0xff90, 0, buf);
expectType<segments.Segment>(seg);
expectType<number>(seg.getMarker());
expectType<number>(seg.getPosition());
expectType<ArrayBuffer>(seg.getBuffer());
expectType<number>(seg.getLength());
expectType<void>(seg.parse());
expectType<string>(seg.toString());

// SizSegment
const sizSeg = new segments.SizSegment(0, buf);
expectType<segments.SizSegment>(sizSeg);
expectType<number>(sizSeg.getProfile());
expectType<helpers.Size>(sizSeg.getRefGridSize());
expectType<helpers.Point>(sizSeg.getImageOffset());
expectType<helpers.Size>(sizSeg.getTileSize());
expectType<helpers.Point>(sizSeg.getTileOffset());
expectType<number>(sizSeg.getComponents());
expectType<number>(sizSeg.getBitDepth(0));
expectType<boolean>(sizSeg.isSigned(0));
expectType<number>(sizSeg.getSubSamplingX(0));
expectType<number>(sizSeg.getSubSamplingY(0));
expectType<number>(sizSeg.getWidth(0));
expectType<number>(sizSeg.getHeight(0));
expectType<helpers.Size>(sizSeg.getNumberOfTiles());

// CapSegment
const capSeg = new segments.CapSegment(0, buf);
expectType<segments.CapSegment>(capSeg);
expectType<number>(capSeg.getCapabilities());

// CodSegment
const codSeg = new segments.CodSegment(0, buf);
expectType<segments.CodSegment>(codSeg);
expectType<number>(codSeg.getCodingStyle());
expectType<boolean>(codSeg.usePrecincts());
expectType<boolean>(codSeg.useSopMarker());
expectType<boolean>(codSeg.useEphMarker());
expectType<number>(codSeg.getProgressionOrder());
expectType<number>(codSeg.getQualityLayers());
expectType<boolean>(codSeg.isEmployingColorTransform());
expectType<number>(codSeg.getDecompositionLevels());
expectType<helpers.Size>(codSeg.getCodeblockSize());
expectType<helpers.Size>(codSeg.getLogCodeblockSize());
expectType<number>(codSeg.getCodeblockStyle());
expectType<number>(codSeg.getWaveletFilter());
expectType<boolean>(codSeg.isReversible());
expectType<helpers.Size>(codSeg.getPrecinctSize(0));

// QcdSegment
const qcdSeg = new segments.QcdSegment(0, buf);
expectType<segments.QcdSegment>(qcdSeg);
expectType<number>(qcdSeg.getDecompositionLevels());
expectType<number>(qcdSeg.getQuantizationStyle());
expectType<number>(qcdSeg.getQuantizationStepSize());

// SotSegment
const sotSeg = new segments.SotSegment(0, buf);
expectType<segments.SotSegment>(sotSeg);
expectType<number>(sotSeg.getTileIndex());
expectType<number>(sotSeg.getTilePartLength());
expectType<number>(sotSeg.getTilePartIndex());
expectType<number>(sotSeg.getTilePartCount());
expectType<number>(sotSeg.getPayloadLength());

// TlmSegment
const tlmSeg = new segments.TlmSegment(0, buf);
expectType<segments.TlmSegment>(tlmSeg);
expectType<number | undefined>(tlmSeg.getLtlm());
expectType<number | undefined>(tlmSeg.getZtlm());
expectType<number | undefined>(tlmSeg.getStlm());
expectType<Array<number>>(tlmSeg.getTtlm());
expectType<Array<number>>(tlmSeg.getPtlm());

// ComSegment
const comSeg = new segments.ComSegment(0, buf);
expectType<segments.ComSegment>(comSeg);
expectType<number | undefined>(comSeg.getRegistration());
expectType<string | undefined>(comSeg.getComment());

// TilePart
const tilePart = new coding.TilePart(sotSeg, 0);
expectType<coding.TilePart>(tilePart);

// Tile
const tile = new coding.Tile(0, rect, sizSeg, codSeg, qcdSeg);
expectType<coding.Tile>(tile);
expectType<number>(tile.getTileIndex());
expectType<helpers.Rectangle>(tile.getTileRectangle());
expectType<segments.CodSegment>(tile.getCodingStyleParameters());
expectType<number>(tile.getWidth());
expectType<number>(tile.getHeight());
expectType<void>(tile.addTilePart(tilePart));
expectType<string>(tile.toString());

// TileComponent
const tileComp = new coding.TileComponent(0, rect, sizSeg, codSeg, qcdSeg);
expectType<coding.TileComponent>(tileComp);
expectType<number>(tileComp.getTileComponentIndex());
expectType<helpers.Rectangle>(tileComp.getTileComponentRectangle());
expectType<segments.CodSegment>(tileComp.getCodingStyleParameters());
expectType<segments.QcdSegment>(tileComp.getQuantizationParameters());
expectType<number>(tileComp.getBitDepth());
expectType<boolean>(tileComp.isSigned());
expectType<number>(tileComp.getSubSamplingX());
expectType<number>(tileComp.getSubSamplingY());
expectType<number>(tileComp.getWidth());
expectType<number>(tileComp.getHeight());
expectType<string>(tileComp.toString());

// Resolution
const resolution = new coding.Resolution(0, rect, 1, {}, {});
expectType<coding.Resolution>(resolution);
expectType<number>(resolution.getResolutionIndex());
expectType<helpers.Rectangle>(resolution.getResolutionRectangle());
expectType<number>(resolution.getDecompositionLevel());
expectType<object>(resolution.getPrecinctParameters());
expectType<object>(resolution.getCodeblockParameters());

// SubBand
const subBand = new coding.SubBand(0, 'LL', rect);
expectType<coding.SubBand>(subBand);
expectType<number>(subBand.getSubBandIndex());
expectType<string>(subBand.getSubBandType());
expectType<helpers.Rectangle>(subBand.getSubBandRectangle());

// BinaryReader
const reader = new BinaryReader(buf);
const readerLE = new BinaryReader(buf, true);
expectType<BinaryReader>(reader);
expectType<number>(reader.readUint32());
expectType<number>(reader.readInt32());
expectType<number>(reader.readUint16());
expectType<number>(reader.readInt16());
expectType<number>(reader.readUint8());
expectType<Uint8Array>(reader.readUint8Array(4));
expectType<string>(reader.readString(4));
expectType<number>(reader.length());
expectType<number>(reader.position());
expectType<void>(reader.seek(0));
expectType<void>(reader.reset());
expectType<boolean>(reader.isAtEnd());
expectType<void>(reader.toEnd());

expectError(new BinaryReader());

// BlockDecoder
const blockDecoder = new BlockDecoder();
expectType<BlockDecoder>(blockDecoder);
expectType<Array<number>>(blockDecoder.MEL_EXP);

const codedData = new Uint8Array(64);
const decodeResult = blockDecoder.decodeCodeblock(codedData, 0, 0, 1, 64, 0, 4, 4);
expectType<Int32Array | null>(decodeResult);

expectError(blockDecoder.decodeCodeblock());
expectError(blockDecoder.decodeCodeblock(codedData, 0, 0, 1, 64, 0, 4));

// PacketReader
const packetReader = new PacketReader();
expectType<PacketReader>(packetReader);
expectType<number>(packetReader.readPacket(codedData, 0, 64, 0, resolution, 0, codSeg));

expectError(packetReader.readPacket());

// Wavelet
const wavelet = new Wavelet();
expectType<Wavelet>(wavelet);

const iDwtResult = wavelet.iDwt2d([{ width: 4, height: 4, ll: new Float64Array(16) }], true);
expectType<Float64Array>(iDwtResult);

expectError(wavelet.iDwt2d());

// Codestream
const codestream = new Codestream(buf);
const codestreamWithOpts = new Codestream(buf, { logSegmentMarkers: true });
expectType<Codestream>(codestream);
expectType<Array<segments.Segment>>(codestream.getSegments());

const csHeader = codestream.readHeader();
expectType<{
  width: number;
  height: number;
  bitDepth: number;
  signed: boolean;
  components: number;
  reversible: boolean;
  decompositionLevels: number;
  progressionOrder: string;
}>(csHeader);

const csDecoded = codestream.decode();
expectType<{
  components: Array<Int16Array | Uint16Array | Uint8Array>;
  width: number;
  height: number;
  bitDepth: number;
  signed: boolean;
} | null>(csDecoded);

expectError(new Codestream());

// Decoder
const decoder = new Decoder(buf);
const decoderWithOpts = new Decoder(buf, { logBoxes: true, logSegmentMarkers: false });
expectType<Decoder>(decoder);

const hdr = decoder.readHeader();
expectType<{
  width: number;
  height: number;
  bitDepth: number;
  signed: boolean;
  components: number;
  reversible: boolean;
  decompositionLevels: number;
  progressionOrder: string;
}>(hdr);

const rendered = decoder.decodeAndRender();
expectType<{
  components: Array<Int16Array | Uint16Array | Uint8Array>;
  width: number;
  height: number;
  bitDepth: number;
  signed: boolean;
} | null>(rendered);

const rgba = decoder.decodeAndRenderToRgba();
expectType<{
  data: Uint8Array;
  width: number;
  height: number;
  bitDepth: number;
  signed: boolean;
} | null>(rgba);

expectError(new Decoder());

// BoxType
expectType<number>(constants.BoxType.Undefined);
expectType<number>(constants.BoxType.Jp2SignatureBox);
expectType<number>(constants.BoxType.FileTypeBox);
expectType<number>(constants.BoxType.Jp2HeaderBox);
expectType<number>(constants.BoxType.ImageHeaderBox);
expectType<number>(constants.BoxType.BitsPerCompBox);
expectType<number>(constants.BoxType.ColorSpecBox);
expectType<number>(constants.BoxType.PaletteBox);
expectType<number>(constants.BoxType.CompMapBox);
expectType<number>(constants.BoxType.ChannelDefBox);
expectType<number>(constants.BoxType.ResolutionBox);
expectType<number>(constants.BoxType.CaptureResBox);
expectType<number>(constants.BoxType.DisplayResBox);
expectType<number>(constants.BoxType.CodestreamBox);
expectType<number>(constants.BoxType.IntellectPropRightsBox);
expectType<number>(constants.BoxType.XmlBox);
expectType<number>(constants.BoxType.UuidBox);
expectType<number>(constants.BoxType.UuidInfoBox);
expectType<number>(constants.BoxType.UuidListBox);
expectType<number>(constants.BoxType.UrlBox);

// CodeblockStyle
expectType<number>(constants.CodeblockStyle.None);
expectType<number>(constants.CodeblockStyle.SelectiveArithmeticCodingBypass);
expectType<number>(constants.CodeblockStyle.ResetContextProbabilitiesOnCodingPassBoundaries);
expectType<number>(constants.CodeblockStyle.TerminateOnEachCodingPass);
expectType<number>(constants.CodeblockStyle.VerticalCausalContext);
expectType<number>(constants.CodeblockStyle.PredictableTermination);
expectType<number>(constants.CodeblockStyle.SegmentationSymbols);

// CodingStyle
expectType<number>(constants.CodingStyle.None);
expectType<number>(constants.CodingStyle.UsePrecincts);
expectType<number>(constants.CodingStyle.UseSopMarker);
expectType<number>(constants.CodingStyle.UseEphMarker);

// EnumeratedColorSpace
expectType<number>(constants.EnumeratedColorSpace.sRgb);
expectType<number>(constants.EnumeratedColorSpace.Gray);
expectType<number>(constants.EnumeratedColorSpace.Ycc);

// J2kFormat
expectType<number>(constants.J2kFormat.Unknown);
expectType<number>(constants.J2kFormat.RawCodestream);
expectType<number>(constants.J2kFormat.CodestreamInBox);

// Marker
expectType<number>(constants.Marker.Soc);
expectType<number>(constants.Marker.Cap);
expectType<number>(constants.Marker.Siz);
expectType<number>(constants.Marker.Cod);
expectType<number>(constants.Marker.Tlm);
expectType<number>(constants.Marker.Prf);
expectType<number>(constants.Marker.Plm);
expectType<number>(constants.Marker.Plt);
expectType<number>(constants.Marker.Cpf);
expectType<number>(constants.Marker.Qcd);
expectType<number>(constants.Marker.Qcc);
expectType<number>(constants.Marker.Com);
expectType<number>(constants.Marker.Sot);
expectType<number>(constants.Marker.Sop);
expectType<number>(constants.Marker.Eph);
expectType<number>(constants.Marker.Sod);
expectType<number>(constants.Marker.Eoc);
expectType<number>(constants.Marker.Coc);
expectType<number>(constants.Marker.Rgn);
expectType<number>(constants.Marker.Poc);
expectType<number>(constants.Marker.Ppm);
expectType<number>(constants.Marker.Ppt);
expectType<number>(constants.Marker.Crg);

// ProgressionOrder
expectType<number>(constants.ProgressionOrder.Lrcp);
expectType<number>(constants.ProgressionOrder.Rlcp);
expectType<number>(constants.ProgressionOrder.Rpcl);
expectType<number>(constants.ProgressionOrder.Pcrl);
expectType<number>(constants.ProgressionOrder.Cprl);

// SubBandType
expectType<string>(constants.SubBandType.Ll);
expectType<string>(constants.SubBandType.Hl);
expectType<string>(constants.SubBandType.Lh);
expectType<string>(constants.SubBandType.Hh);

// WaveletTransform
expectType<number>(constants.WaveletTransform.Irreversible_9_7);
expectType<number>(constants.WaveletTransform.Reversible_5_3);
