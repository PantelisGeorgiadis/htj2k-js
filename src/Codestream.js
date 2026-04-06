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
const { Marker, ProgressionOrder } = require('./Constants');
const { Tile, TilePart } = require('./Coding');
const { Point, Rectangle, Size } = require('./Helpers');
const BinaryReader = require('./BinaryReader');
const log = require('./log');
const BlockDecoder = require('./BlockDecoder');
const Wavelet = require('./Wavelet');
const PacketReader = require('./PacketReader');

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
  constructor(buffer, opts = {}) {
    this.logSegmentMarkers = opts.logSegmentMarkers || false;

    this.binaryReader = new BinaryReader(buffer, false);
    this.packetReader = new PacketReader();
    this.blockDecoder = new BlockDecoder();
    this.wavelet = new Wavelet();
    this.segments = [];
    this.tiles = [];
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
   * @throws Error if codestream ends before finding a tile segment and
   * SIZ, COD and QCD segments are not found.
   */
  readHeader() {
    this.binaryReader.seek(0);
    this.segments.length = 0;
    this.tiles.length = 0;
    let tileFound = false;

    for (;;) {
      // Read next segment
      const { position, marker, data } = this._readNextSegment();
      if (position === -1 && marker === -1) {
        log.error('File terminated early');
        break;
      }

      // Stop at the first SOT marker found and rewind stream
      if (marker === Marker.Sot) {
        this.binaryReader.seek(position);
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
      } else if (marker === Marker.Tlm) {
        segment = new TlmSegment(position, data);
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
      throw new Error('Codestream ended before finding a tile segment');
    }
    const mandatorySegments = [Marker.Siz, Marker.Cod, Marker.Qcd].every((m) =>
      this.segments.some((s) => s.getMarker() === m)
    );
    if (!mandatorySegments) {
      throw new Error('SIZ, COD and QCD segments are required and were not found');
    }

    const siz = this.segments.find((s) => s.getMarker() === Marker.Siz);
    const cod = this.segments.find((s) => s.getMarker() === Marker.Cod);
    const qcd = this.segments.find((s) => s.getMarker() === Marker.Qcd);

    // Create empty tiles
    this._createTiles(siz, cod, qcd);

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
   * @param {boolean} [opts.logSegmentMarkers] - Flag to indicate whether to log segment markers.
   * @returns {Object|null} result Decoded image data and metadata, or null if decoding fails.
   * @returns {Array<Int16Array|Uint16Array|Uint8Array>} result.components components.
   * @returns {number} result.width width.
   * @returns {number} result.height height.
   * @returns {number} result.bitDepth bitDepth.
   * @returns {boolean} result.signed signed.
   * @throws Error if a SIZ segment was not found.
   */
  // eslint-disable-next-line no-unused-vars
  decode(opts = {}) {
    // Decode was called without reading the header segments first.
    if (this.segments.length === 0) {
      this.readHeader();
    }

    const siz = this.segments.find((s) => s.getMarker() === Marker.Siz);
    if (!siz) {
      throw new Error('SIZ segment was not found');
    }
    const cod = this.segments.find((s) => s.getMarker() === Marker.Cod);
    const qcd = this.segments.find((s) => s.getMarker() === Marker.Qcd);

    // Header parsing stopped at first tile
    // Continue iterating over tiles
    for (;;) {
      const { marker, position, data } = this._readNextSegment();
      if (position === -1 && marker === -1) {
        log.error('File terminated early');
        break;
      }

      // End of codestream
      if (marker === Marker.Eoc) {
        const segment = new Segment(marker, position, data);
        this._addSegment(segment);
        break;
      }

      // Start of tile part
      if (marker === Marker.Sot) {
        const sotSegment = new SotSegment(position, data);
        sotSegment.parse();
        this._addSegment(sotSegment);

        const tileStartPosition = this.binaryReader.position();
        const tilePartIndex = sotSegment.getTilePartIndex();

        if (sotSegment.getTileIndex() > siz.getNumberOfTiles().getArea()) {
          throw new Error(`Wrong tile index [${tilePartIndex}]`);
        }
        if (tilePartIndex) {
          if (sotSegment.getTilePartCount() && tilePartIndex >= sotSegment.getTilePartCount()) {
            throw new Error('Tile part count should be less than total number of tile parts');
          }
        }

        // Read segments inside tile part
        let sodFound = false;
        let sodPosition = -1;
        for (;;) {
          const { position, marker, data } = this._readNextSegment();
          if (position === -1 && marker === -1) {
            log.error('File terminated early');
            break;
          }

          // Start of data
          if (marker === Marker.Sod) {
            const segment = new Segment(marker, position, data);
            this._addSegment(segment);

            this.binaryReader.seek(position);
            sodPosition = position;
            sodFound = true;
            break;
          }

          const segment = new Segment(marker, position, data);
          this._addSegment(segment);
        }

        if (!sodFound) {
          throw new Error(
            `Codestream terminated early before start of data is found for tile index ${sotSegment.getTileIndex()} and tile part ${tilePartIndex}`
          );
        }

        // Add tile part to tile
        const tile = this.tiles.find((t) => t.getTileIndex() === sotSegment.getTileIndex());
        if (!tile) {
          throw new Error(`Couldn't find tile with index ${sotSegment.getTileIndex()}`);
        }
        tile.addTilePart(new TilePart(sotSegment, sodPosition));

        // Jump to next tile part
        const tileEndPosition = tileStartPosition + sotSegment.getPayloadLength();
        this.binaryReader.seek(tileEndPosition);
      }
    }

    return this._decodeAndRenderImage(siz, cod, qcd);
  }

  //#region Private Methods
  /**
   * Full decoding and rendering pipeline: reads packets, decodes codeblocks, runs IDWT,
   * applies colour transform, level-shifts and returns pixel data.
   * @method
   * @private
   * @param {SizSegment} siz - SIZ segment.
   * @param {CodSegment} cod - COD segment.
   * @param {QcdSegment} qcd - QCD segment.
   * @returns {Object} result Decoded image data and metadata.
   * @returns {Array<Int16Array|Uint16Array|Uint8Array>} result.components components.
   * @returns {number} result.width width.
   * @returns {number} result.height height.
   * @returns {number} result.bitDepth bitDepth.
   * @returns {boolean} result.signed signed.
   */
  _decodeAndRenderImage(siz, cod, qcd) {
    const numComponents = siz.getComponents();
    const decompositionLevels = cod.getDecompositionLevels();
    const qualityLayers = cod.getQualityLayers();
    const isReversible = cod.isReversible();
    const isColorTransform = cod.isEmployingColorTransform();

    const buffer = new Uint8Array(this.binaryReader.buffer);

    if (!this.tiles || this.tiles.length === 0) {
      throw new Error('No tiles found in codestream');
    }

    // Allocate full-image output buffers (one per component)
    const imageComps = [];
    for (let c = 0; c < numComponents; c++) {
      const bitDepth = siz.getBitDepth(c);
      const isSigned = siz.isSigned(c);
      const ArrayType = isSigned ? Int16Array : bitDepth <= 8 ? Uint8Array : Uint16Array;
      imageComps.push(new ArrayType(siz.getWidth(c) * siz.getHeight(c)));
    }

    // Process every tile and composite into the full-image buffers
    for (const tile of this.tiles) {
      // Read packets according to progression order
      for (const tilePart of tile.tileParts) {
        const dataStart = tilePart.sodPosition + 2; // SOD marker is 2 bytes
        const dataEnd = tilePart.sotSegment.getPosition() + tilePart.sotSegment.getTilePartLength();
        let pos = dataStart;
        const progressionOrder = cod.getProgressionOrder();

        if (progressionOrder === ProgressionOrder.Lrcp) {
          // Layer-Resolution-Component-Position
          for (let l = 0; l < qualityLayers; l++) {
            for (let r = 0; r <= decompositionLevels; r++) {
              for (let c = 0; c < numComponents; c++) {
                const resolution = tile.tileComponents[c].resolutions[r];
                const nPrecincts = resolution.getPrecinctParameters().numPrecincts;
                for (let p = 0; p < nPrecincts; p++) {
                  if (pos >= dataEnd) {
                    break;
                  }
                  pos = this.packetReader.readPacket(buffer, pos, dataEnd, l, resolution, p, cod);
                }
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Rlcp) {
          // Resolution-Layer-Component-Position
          for (let r = 0; r <= decompositionLevels; r++) {
            for (let l = 0; l < qualityLayers; l++) {
              for (let c = 0; c < numComponents; c++) {
                const resolution = tile.tileComponents[c].resolutions[r];
                const nPrecincts = resolution.getPrecinctParameters().numPrecincts;
                for (let p = 0; p < nPrecincts; p++) {
                  if (pos >= dataEnd) {
                    break;
                  }
                  pos = this.packetReader.readPacket(buffer, pos, dataEnd, l, resolution, p, cod);
                }
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Rpcl) {
          // Resolution-Position-Component-Layer
          for (let r = 0; r <= decompositionLevels; r++) {
            let maxH = 0;
            let maxW = 0;
            for (let c = 0; c < numComponents; c++) {
              const pp = tile.tileComponents[c].resolutions[r].getPrecinctParameters();
              maxH = Math.max(maxH, pp.numPrecinctsHigh);
              maxW = Math.max(maxW, pp.numPrecinctsWide);
            }
            for (let py = 0; py < maxH; py++) {
              for (let px = 0; px < maxW; px++) {
                for (let c = 0; c < numComponents; c++) {
                  const resolution = tile.tileComponents[c].resolutions[r];
                  const pp = resolution.getPrecinctParameters();
                  const p = py * pp.numPrecinctsWide + px;
                  if (p >= pp.numPrecincts) {
                    continue;
                  }
                  for (let l = 0; l < qualityLayers; l++) {
                    if (pos >= dataEnd) {
                      break;
                    }
                    pos = this.packetReader.readPacket(buffer, pos, dataEnd, l, resolution, p, cod);
                  }
                }
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Pcrl) {
          // Position-Component-Resolution-Layer
          let maxH = 0;
          let maxW = 0;
          for (let c = 0; c < numComponents; c++) {
            for (let r = 0; r <= decompositionLevels; r++) {
              const pp = tile.tileComponents[c].resolutions[r].getPrecinctParameters();
              maxH = Math.max(maxH, pp.numPrecinctsHigh);
              maxW = Math.max(maxW, pp.numPrecinctsWide);
            }
          }
          for (let py = 0; py < maxH; py++) {
            for (let px = 0; px < maxW; px++) {
              for (let c = 0; c < numComponents; c++) {
                for (let r = 0; r <= decompositionLevels; r++) {
                  const resolution = tile.tileComponents[c].resolutions[r];
                  const pp = resolution.getPrecinctParameters();
                  const p = py * pp.numPrecinctsWide + px;
                  if (p >= pp.numPrecincts) {
                    continue;
                  }
                  for (let l = 0; l < qualityLayers; l++) {
                    if (pos >= dataEnd) {
                      break;
                    }
                    pos = this.packetReader.readPacket(buffer, pos, dataEnd, l, resolution, p, cod);
                  }
                }
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Cprl) {
          // Component-Position-Resolution-Layer
          for (let c = 0; c < numComponents; c++) {
            let maxH = 0;
            let maxW = 0;
            for (let r = 0; r <= decompositionLevels; r++) {
              const pp = tile.tileComponents[c].resolutions[r].getPrecinctParameters();
              maxH = Math.max(maxH, pp.numPrecinctsHigh);
              maxW = Math.max(maxW, pp.numPrecinctsWide);
            }
            for (let py = 0; py < maxH; py++) {
              for (let px = 0; px < maxW; px++) {
                for (let r = 0; r <= decompositionLevels; r++) {
                  const resolution = tile.tileComponents[c].resolutions[r];
                  const pp = resolution.getPrecinctParameters();
                  const p = py * pp.numPrecinctsWide + px;
                  if (p >= pp.numPrecincts) {
                    continue;
                  }
                  for (let l = 0; l < qualityLayers; l++) {
                    if (pos >= dataEnd) {
                      break;
                    }
                    pos = this.packetReader.readPacket(buffer, pos, dataEnd, l, resolution, p, cod);
                  }
                }
              }
            }
          }
        }
      }

      // Decode codeblocks and perform IDWT for each component
      const componentData = [];

      for (let c = 0; c < numComponents; c++) {
        const tc = tile.tileComponents[c];
        const bitDepth = tc.getBitDepth();
        //const guardBits = qcd.quantizationStyle >> 5;

        // Build resolutions array for idwt2d
        // resolutions[0] holds LL; resolutions[r>0] holds HL/LH/HH
        const resolutionsForIDWT = [];

        // LL subband (resolution index 0, coarsest)
        {
          const res0 = tc.resolutions[0];
          const llBand = res0.subBands[0];
          const llSx0 = llBand.subBandRect.getPoint().getX();
          const llSy0 = llBand.subBandRect.getPoint().getY();
          const llW = llBand.subBandRect.getSize().getWidth() - llSx0;
          const llH = llBand.subBandRect.getSize().getHeight() - llSy0;
          const llBuf = new Float64Array(Math.max(llW * llH, 0));
          this._assembleBand(llBand, llBuf, llW, llSx0, llSy0, qcd, 0, isReversible, bitDepth);
          resolutionsForIDWT.push({ width: llW, height: llH, ll: llBuf });
        }

        // Higher resolutions (HL / LH / HH subbands)
        for (let r = 1; r <= decompositionLevels; r++) {
          const res = tc.resolutions[r];
          const resW =
            res.getResolutionRectangle().getSize().getWidth() -
            res.getResolutionRectangle().getPoint().getX();
          const resH =
            res.getResolutionRectangle().getSize().getHeight() -
            res.getResolutionRectangle().getPoint().getY();

          const bandIdxHl = 3 * (r - 1) + 1;
          const bandIdxLh = 3 * (r - 1) + 2;
          const bandIdxHh = 3 * (r - 1) + 3;

          const hlBand = res.subBands[0]; // HL
          const lhBand = res.subBands[1]; // LH
          const hhBand = res.subBands[2]; // HH

          const hlSx0 = hlBand.subBandRect.getPoint().getX();
          const hlSy0 = hlBand.subBandRect.getPoint().getY();
          const hlW = hlBand.subBandRect.getSize().getWidth() - hlSx0;
          const hlH = hlBand.subBandRect.getSize().getHeight() - hlSy0;

          const lhSx0 = lhBand.subBandRect.getPoint().getX();
          const lhSy0 = lhBand.subBandRect.getPoint().getY();
          const lhW = lhBand.subBandRect.getSize().getWidth() - lhSx0;
          const lhH = lhBand.subBandRect.getSize().getHeight() - lhSy0;

          const hhSx0 = hhBand.subBandRect.getPoint().getX();
          const hhSy0 = hhBand.subBandRect.getPoint().getY();
          const hhW = hhBand.subBandRect.getSize().getWidth() - hhSx0;
          const hhH = hhBand.subBandRect.getSize().getHeight() - hhSy0;

          const hlBuf = new Float64Array(Math.max(hlW * hlH, 0));
          const lhBuf = new Float64Array(Math.max(lhW * lhH, 0));
          const hhBuf = new Float64Array(Math.max(hhW * hhH, 0));

          this._assembleBand(
            hlBand,
            hlBuf,
            hlW,
            hlSx0,
            hlSy0,
            qcd,
            bandIdxHl,
            isReversible,
            bitDepth
          );
          this._assembleBand(
            lhBand,
            lhBuf,
            lhW,
            lhSx0,
            lhSy0,
            qcd,
            bandIdxLh,
            isReversible,
            bitDepth
          );
          this._assembleBand(
            hhBand,
            hhBuf,
            hhW,
            hhSx0,
            hhSy0,
            qcd,
            bandIdxHh,
            isReversible,
            bitDepth
          );

          resolutionsForIDWT.push({ width: resW, height: resH, hl: hlBuf, lh: lhBuf, hh: hhBuf });
        }

        // Run IDWT
        const pixels = this.wavelet.iDwt2d(resolutionsForIDWT, isReversible);
        componentData.push(pixels);
      }

      // Inverse colour transform
      if (isColorTransform && numComponents >= 3) {
        const len = componentData[0].length;
        if (isReversible) {
          // Inverse RCT: Y, Cb, Cr → R, G, B  (integer arithmetic)
          for (let i = 0; i < len; i++) {
            const y = componentData[0][i];
            const cb = componentData[1][i];
            const cr = componentData[2][i];
            const g = y - ((cb + cr) >> 2);
            componentData[0][i] = cr + g; // R
            componentData[1][i] = g; // G
            componentData[2][i] = cb + g; // B
          }
        } else {
          // Inverse ICT
          for (let i = 0; i < len; i++) {
            const y = componentData[0][i];
            const cb = componentData[1][i];
            const cr = componentData[2][i];
            componentData[0][i] = y + 1.402 * cr; // R
            componentData[1][i] = y - 0.34413 * cb - 0.71414 * cr; // G
            componentData[2][i] = y + 1.772 * cb; // B
          }
        }
      }

      // Level shift + clamp → typed array, then composite into full image buffers
      for (let c = 0; c < numComponents; c++) {
        const bitDepth = siz.getBitDepth(c);
        const isSigned = siz.isSigned(c);
        const pixels = componentData[c];

        const shift = isSigned ? 0 : 1 << (bitDepth - 1);
        const minVal = isSigned ? -(1 << (bitDepth - 1)) : 0;
        const maxVal = isSigned ? (1 << (bitDepth - 1)) - 1 : (1 << bitDepth) - 1;

        const tileRect = tile.getTileRectangle();
        const subSampX = siz.getSubSamplingX(c);
        const subSampY = siz.getSubSamplingY(c);
        const dstX0 =
          Math.ceil(tileRect.getPoint().getX() / subSampX) -
          Math.ceil(siz.getImageOffset().getX() / subSampX);
        const dstY0 =
          Math.ceil(tileRect.getPoint().getY() / subSampY) -
          Math.ceil(siz.getImageOffset().getY() / subSampY);
        const tcW = tile.tileComponents[c].getWidth();
        const tcH = tile.tileComponents[c].getHeight();
        const imgW = siz.getWidth(c);
        const imgComp = imageComps[c];

        for (let row = 0; row < tcH; row++) {
          const srcOff = row * tcW;
          const dstOff = (dstY0 + row) * imgW + dstX0;
          for (let col = 0; col < tcW; col++) {
            let v = Math.round(pixels[srcOff + col]) + shift;
            if (v < minVal) {
              v = minVal;
            } else if (v > maxVal) {
              v = maxVal;
            }
            imgComp[dstOff + col] = v;
          }
        }
      }
    }

    return {
      components: imageComps,
      width: siz.getWidth(0),
      height: siz.getHeight(0),
      bitDepth: siz.getBitDepth(0),
      signed: siz.isSigned(0),
    };
  }

  /**
   * Decode codeblocks for one subband and write coefficients into a Float64Array.
   * @param {SubBand} sb - SubBand with decoded codeblock data.
   * @param {Float64Array} buf - Output buffer (sbW × sbH).
   * @param {number} sbW - Subband width.
   * @param {number} sx0 - Subband x-origin in subband-coord space.
   * @param {number} sy0 - Subband y-origin in subband-coord space.
   * @param {QcdSegment} qcd - Quantization parameters.
   * @param {number} bandIdx - Quantization step-size index for this subband.
   * @param {boolean} isReversible - True for 5/3 reversible wavelet.
   * @param {number} bitDepth - Bit depth of the component.
   * @private
   */
  _assembleBand(sb, buf, sbW, sx0, sy0, qcd, bandIdx, isReversible, bitDepth) {
    // Quantization step size (irreversible only).
    let delta = 1.0;
    if (!isReversible && bandIdx < qcd.quantizationStepSize.length) {
      const s = qcd.quantizationStepSize[bandIdx];
      const mant = s & 0x7ff;
      const guardBits = qcd.quantizationStyle >> 5;
      // Subband type: 0=LL, 1=HL, 2=LH, 3=HH
      const sbType = bandIdx === 0 ? 0 : bandIdx % 3 === 0 ? 3 : bandIdx % 3;
      const arr = [1, 2, 2, 4];
      delta = (1 + mant / 2048) * arr[sbType] * Math.pow(2, guardBits + (bitDepth || 8) - 32);
    }

    for (const cb of sb.codeblocks) {
      if (!cb.data || cb.passes === 0 || cb.lengths1 < 2) {
        continue;
      }

      const cbW = cb.cbx1 - cb.cbx0;
      const cbH = cb.cby1 - cb.cby0;
      if (cbW <= 0 || cbH <= 0) {
        continue;
      }

      const p = 30 - cb.missingMSBs;
      if (p < 0) {
        continue;
      }

      // Decode codeblock and get array of quantized coefficients
      const coeffs = this.blockDecoder.decodeCodeblock(
        cb.data,
        0,
        cb.missingMSBs,
        cb.passes,
        cb.lengths1,
        cb.lengths2 || 0,
        cbW,
        cbH
      );
      if (!coeffs) {
        continue;
      }

      // Map codeblock coefficients into the subband buffer
      const dstX0 = cb.cbx0 - sx0;
      const dstY0 = cb.cby0 - sy0;
      const dstBase = dstY0 * sbW + dstX0;
      if (isReversible) {
        for (let j = 0; j < cbH; j++) {
          const srcOff = j * cbW;
          const dstOff = dstBase + j * sbW;
          for (let i = 0; i < cbW; i++) {
            const val = coeffs[srcOff + i];
            if (val === 0) {
              buf[dstOff + i] = 0;
            } else {
              const mag = (val & 0x7fffffff) >>> p;
              buf[dstOff + i] = val >>> 31 ? -mag : mag;
            }
          }
        }
      } else {
        for (let j = 0; j < cbH; j++) {
          const srcOff = j * cbW;
          const dstOff = dstBase + j * sbW;
          for (let i = 0; i < cbW; i++) {
            const val = coeffs[srcOff + i];
            if (val === 0) {
              buf[dstOff + i] = 0;
            } else {
              const mag = val & 0x7fffffff;
              buf[dstOff + i] = (val >>> 31 ? -mag : mag) * delta;
            }
          }
        }
      }
    }
  }

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
    // Position and marker
    let { position, marker } = this._scanNextMarker();
    if (position === -1 && marker === -1) {
      return { position, marker, length: 0, data: undefined };
    }

    // Size
    let length =
      marker !== Marker.Soc &&
      marker !== Marker.Sod &&
      marker !== Marker.Eoc &&
      (marker < 0xd0 || marker > 0xd8)
        ? this.binaryReader.readUint16() - 2
        : 0;

    // Data
    let data = undefined;
    length =
      length > this.binaryReader.length() - this.binaryReader.position()
        ? this.binaryReader.length() - this.binaryReader.position()
        : length;
    if (length > 0) {
      const buffer = this.binaryReader.readUint8Array(length);
      data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    return { position, marker, length, data };
  }

  /**
   * Scans for the next marker in the codestream.
   * @method
   * @private
   * @returns {Object} nextMarker Read next marker result object.
   * @returns {number} nextMarker.position position.
   * @returns {Marker} nextMarker.marker marker.
   * @throws Error if found marker is not valid.
   */
  _scanNextMarker() {
    let position = -1;
    let marker = -1;
    while (!this.binaryReader.isAtEnd()) {
      const m1 = this.binaryReader.readUint8();
      if (m1 === 0xff) {
        position = this.binaryReader.position() - 1;
        const m2 = this.binaryReader.readUint8();

        marker = (m1 << 8) | m2;
        if ((marker & 0xff00) !== 0xff00) {
          throw new Error(`Not a marker: ${marker.toString(16)}`);
        }
        marker &= 0xff;
        break;
      }
    }

    return { position, marker };
  }

  /**
   * Create empty tiles.
   * @method
   * @private
   * @param {SizSegment} siz - SIZ segment.
   * @param {CodSegment} cod - COD segment.
   * @param {QcdSegment} qcd - QCD segment.
   */
  _createTiles(siz, cod, qcd) {
    const numberOfTiles = siz.getNumberOfTiles();
    let index = 0;
    for (let i = 0; i < numberOfTiles.getHeight(); i++) {
      for (let j = 0; j < numberOfTiles.getWidth(); j++) {
        const tileRect = new Rectangle(
          new Point(
            Math.max(
              siz.getTileOffset().getX() + j * siz.getTileSize().getWidth(),
              siz.getImageOffset().getX()
            ),
            Math.max(
              siz.getTileOffset().getY() + i * siz.getTileSize().getHeight(),
              siz.getImageOffset().getY()
            )
          ),
          new Size(
            Math.min(
              siz.getTileOffset().getX() + (j + 1) * siz.getTileSize().getWidth(),
              siz.getRefGridSize().getWidth()
            ),
            Math.min(
              siz.getTileOffset().getY() + (i + 1) * siz.getTileSize().getHeight(),
              siz.getRefGridSize().getHeight()
            )
          )
        );

        this.tiles.push(new Tile(index, tileRect, siz, cod, qcd));
        index++;
      }
    }
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = Codestream;
//#endregion
