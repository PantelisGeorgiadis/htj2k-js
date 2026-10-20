const {
  CapSegment,
  CodSegment,
  ComSegment,
  NltSegment,
  PpmSegment,
  QccSegment,
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
   * @returns {boolean} header.reversible reversible.
   * @returns {number} header.decompositionLevels decompositionLevels.
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
      } else if (marker === Marker.Qcc) {
        segment = new QccSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Tlm) {
        segment = new TlmSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Com) {
        segment = new ComSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Ppm) {
        segment = new PpmSegment(position, data);
        segment.parse();
      } else if (marker === Marker.Nlt) {
        segment = new NltSegment(position, data);
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

    // Determine effective bit depth / signedness for component 0, taking NLT into
    // account (a Part 2 NLT marker can override the SIZ-encoded values to reflect
    // the original pre-transformed sample range).
    const nlt = this._findNltSegment(0);
    const effectiveBitDepth = nlt ? nlt.getBitDepth() : siz.getBitDepth(0);
    const effectiveSigned = nlt ? nlt.isSigned() : siz.isSigned(0);

    return {
      width: siz.getWidth(0),
      height: siz.getHeight(0),
      bitDepth: effectiveBitDepth,
      signed: effectiveSigned,
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
        let tileQcd = undefined;
        const tileQccs = [];
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

          // Per-tile quantization segments override the main header values
          let segment;
          if (marker === Marker.Qcd) {
            segment = new QcdSegment(position, data);
            segment.parse();
            tileQcd = segment;
          } else if (marker === Marker.Qcc) {
            segment = new QccSegment(position, data);
            segment.parse();
            tileQccs.push(segment);
          } else {
            segment = new Segment(marker, position, data);
          }
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
        const tilePart = new TilePart(sotSegment, sodPosition);
        // Per-tile quantization overrides are picked up during decoding
        tilePart.qcd = tileQcd;
        tilePart.qccs = tileQccs;
        tile.addTilePart(tilePart);

        // Jump to next tile part
        const tileEndPosition = tileStartPosition + sotSegment.getPayloadLength();
        this.binaryReader.seek(tileEndPosition);
      }
    }

    return this._decodeAndRenderImage(siz, cod, qcd);
  }

  //#region Private Methods
  /**
   * Builds the effective QCD-equivalent quantization for one component of a
   * tile. Tile-part QCD/QCC segments override the main header values for the
   * tile (ISO/IEC 15444-1 B.10, non-PSQCD mode).
   * @method
   * @private
   * @param {QcdSegment|undefined} tileQcd - Tile-part QCD segment, if any.
   * @param {Array<QccSegment>} tileQccs - Tile-part QCC segments, if any.
   * @param {number} component - Component index.
   * @param {Object} mainComponentQcd - Main-header effective QCD for the
   * component (main QCD, or main QCC if present).
   * @returns {Object} The effective quantization segment for the component.
   */
  _resolveQcdForComponent(tileQcd, tileQccs, component, mainComponentQcd) {
    if (!tileQcd) {
      for (const qcc of tileQccs || []) {
        if (qcc.getComponent() === component) {
          return qcc;
        }
      }
      return mainComponentQcd;
    }
    for (const qcc of tileQccs || []) {
      if (qcc.getComponent() === component) {
        return qcc;
      }
    }
    return tileQcd;
  }

  /**
   * Finds the NLT segment that applies to a given component, if any.
   * Per-component NLTs take precedence over global (Cnlt = 0xFFFF) NLTs.
   * @method
   * @private
   * @param {number} component - Component index.
   * @returns {NltSegment|undefined} Matching NLT segment, or undefined.
   */
  _findNltSegment(component) {
    let global;
    for (const s of this.segments) {
      if (s.getMarker() !== Marker.Nlt) {
        continue;
      }
      if (s.getComponent() === component) {
        return s;
      }
      if (s.isForAllComponents()) {
        global = s;
      }
    }
    return global;
  }

  /**
   * Builds (and caches) the concatenated PPM payload across all PPM segments,
   * ordered by Zppm. Returns an empty Uint8Array if no PPM segments are present.
   * @method
   * @private
   * @returns {Uint8Array} Concatenated PPM payload.
   */
  _getPpmBuffer() {
    if (this._ppmBuffer !== undefined) {
      return this._ppmBuffer;
    }
    const parts = this.segments
      .filter((s) => s.getMarker() === Marker.Ppm)
      .sort((a, b) => a.getZppm() - b.getZppm())
      .map((s) => s.getPayload());
    if (parts.length === 0) {
      this._ppmBuffer = new Uint8Array(0);
      return this._ppmBuffer;
    }
    let total = 0;
    for (const p of parts) {
      total += p.byteLength;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    this._ppmBuffer = merged;
    return this._ppmBuffer;
  }

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
    // Referenced by _assembleBand when concatenating codeblock data chunks.
    this._codestreamBytes = buffer;

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

    // Process every tile and composite into the full-image buffers.
    // PPM (packed packet headers in main header) handling: the concatenated
    // PPM payload is structured as a sequence of [Nppm uint32, Ippm bytes] groups
    // — one group per tile-part in the order they appear. We walk this cursor in
    // lockstep with the tile-part loop and install each Ippm slice as the
    // PacketReader's packed-header source.
    const ppmBuffer = this._getPpmBuffer();
    const ppmActive = ppmBuffer.byteLength > 0;
    let ppmCursor = 0;

    // Per-component main-header effective QCD (QCC overrides QCD per spec B.10).
    // Tile-part QCD/QCC segments override these during the tile loop below.
    const mainQcds = [];
    for (let c = 0; c < numComponents; c++) {
      let compQcd = qcd;
      for (const s of this.segments) {
        if (s.getMarker() === Marker.Qcc && s.getComponent && s.getComponent() === c) {
          compQcd = s;
          break;
        }
      }
      mainQcds.push(compQcd);
    }

    const codInfo = {
      useSop: cod.useSopMarker(),
      useEph: cod.useEphMarker(),
      codeblockStyle: cod.getCodeblockStyle(),
    };

    for (const tile of this.tiles) {
      // Effective quantization per component: main-header QCC overrides the
      // main QCD; tile-part QCD/QCC segments override both for this tile.
      const effectiveQcds = mainQcds.slice();

      // Persistent packet-header state (tag-trees, segments) is per tile.
      this.packetReader.resetState();

      // Mb (nominal dynamic range minus guard bands) per quantization band,
      // per OpenJPEG: numbps = expn + numgbits - 1 (tcd.c).
      const bandNumbpsPerComp = [];
      const buildBandNumbps = (qcdSeg) => {
        const guardBits = qcdSeg.quantizationStyle >> 5;
        const noQuant = (qcdSeg.quantizationStyle & 0x1f) === 0;
        return qcdSeg.quantizationStepSize.map((s) => (noQuant ? s >> 3 : s >> 11) + guardBits - 1);
      };

      // Position-anchored progressions (RPCL/PCRL/CPRL) require per
      // (component, resolution) cursors that walk each resolution's own
      // precinct grid in raster order and persist across tile-parts, exactly
      // like OpenJPH's cur_precinct_loc. At each step the next packet
      // position is the head precinct with the smallest projected
      // full-resolution (y, x) top-left, ties broken by scan order
      // (component, then resolution).
      const progCursors = tile.tileComponents.map((tc) =>
        tc.resolutions.map(() => ({ x: 0, y: 0 }))
      );
      const progTileX0 = tile.getTileRectangle().getPoint().getX();
      const progTileY0 = tile.getTileRectangle().getPoint().getY();
      const peekProgPrecinct = (c, r) => {
        const tc = tile.tileComponents[c];
        const resolution = tc.resolutions[r];
        if (!resolution) {
          return null;
        }
        const pp = resolution.getPrecinctParameters();
        const cur = progCursors[c][r];
        const idx = cur.y * pp.numPrecinctsWide + cur.x;
        if (pp.numPrecincts === 0 || idx >= pp.numPrecincts) {
          return null;
        }
        const decomp = tc.getCodingStyleParameters().getDecompositionLevels();
        const scale = 1 << (decomp - r);
        const ppx0 = (pp.precinctX0 + cur.x) * pp.precinctWidth;
        const ppy0 = (pp.precinctY0 + cur.y) * pp.precinctHeight;
        return {
          x: Math.max(progTileX0, ppx0 * scale * tc.getSubSamplingX()),
          y: Math.max(progTileY0, ppy0 * scale * tc.getSubSamplingY()),
          idx,
        };
      };

      // Read packets according to progression order
      for (const tilePart of tile.tileParts) {
        if (tilePart.qcd) {
          for (let c = 0; c < numComponents; c++) {
            effectiveQcds[c] = this._resolveQcdForComponent(
              tilePart.qcd,
              tilePart.qccs,
              c,
              mainQcds[c]
            );
          }
        } else if (tilePart.qccs && tilePart.qccs.length) {
          for (const qcc of tilePart.qccs) {
            if (qcc.getComponent() < numComponents) {
              effectiveQcds[qcc.getComponent()] = qcc;
            }
          }
        }

        const dataStart = tilePart.sodPosition + 2; // SOD marker is 2 bytes
        const dataEnd = tilePart.sotSegment.getPosition() + tilePart.sotSegment.getTilePartLength();
        let pos = dataStart;
        const progressionOrder = cod.getProgressionOrder();

        // Refresh Mb tables for this tile-part's effective quantization.
        bandNumbpsPerComp.length = 0;
        for (let c = 0; c < numComponents; c++) {
          bandNumbpsPerComp.push(buildBandNumbps(effectiveQcds[c]));
        }

        // If PPM is in use, peel off the next [Nppm, Ippm] group for this tile-part
        // and install it as the packet-header source.
        if (ppmActive) {
          if (ppmCursor + 4 > ppmBuffer.byteLength) {
            throw new Error('PPM payload exhausted before all tile-parts were consumed');
          }
          const nppm =
            (ppmBuffer[ppmCursor] * 0x1000000 +
              ((ppmBuffer[ppmCursor + 1] << 16) |
                (ppmBuffer[ppmCursor + 2] << 8) |
                ppmBuffer[ppmCursor + 3])) >>>
            0;
          ppmCursor += 4;
          const pphStart = ppmCursor;
          const pphEnd = ppmCursor + nppm;
          if (pphEnd > ppmBuffer.byteLength) {
            throw new Error('PPM Nppm exceeds remaining PPM payload');
          }
          ppmCursor = pphEnd;
          this.packetReader.setPphSource(ppmBuffer, pphStart, pphEnd);
        } else {
          this.packetReader.clearPphSource();
        }

        if (progressionOrder === ProgressionOrder.Lrcp) {
          // Layer-Resolution-Component-Position
          for (let l = 0; l < qualityLayers; l++) {
            for (let r = 0; r <= decompositionLevels; r++) {
              for (let c = 0; c < numComponents; c++) {
                const resolution = tile.tileComponents[c].resolutions[r];
                const nPrecincts = resolution.getPrecinctParameters().numPrecincts;
                for (let p = 0; p < nPrecincts; p++) {
                  if (this.packetReader.isExhausted(pos, dataEnd)) {
                    break;
                  }
                  pos = this.packetReader.readPacket(
                    buffer,
                    pos,
                    dataEnd,
                    l,
                    c,
                    r,
                    resolution,
                    p,
                    bandNumbpsPerComp[c],
                    codInfo
                  );
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
                  if (this.packetReader.isExhausted(pos, dataEnd)) {
                    break;
                  }
                  pos = this.packetReader.readPacket(
                    buffer,
                    pos,
                    dataEnd,
                    l,
                    c,
                    r,
                    resolution,
                    p,
                    bandNumbpsPerComp[c],
                    codInfo
                  );
                }
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Rpcl) {
          // Resolution-Position-Component-Layer
          for (let r = 0; r <= decompositionLevels; r++) {
            for (;;) {
              let best = null;
              let bestC = -1;
              for (let c = 0; c < numComponents; c++) {
                const cand = peekProgPrecinct(c, r);
                if (!cand) {
                  continue;
                }
                if (!best || cand.y < best.y || (cand.y === best.y && cand.x < best.x)) {
                  best = cand;
                  bestC = c;
                }
              }
              if (!best) {
                break;
              }
              const resolution = tile.tileComponents[bestC].resolutions[r];
              const pp = resolution.getPrecinctParameters();
              const cur = progCursors[bestC][r];
              for (let l = 0; l < qualityLayers; l++) {
                if (this.packetReader.isExhausted(pos, dataEnd)) {
                  break;
                }
                pos = this.packetReader.readPacket(
                  buffer,
                  pos,
                  dataEnd,
                  l,
                  bestC,
                  r,
                  resolution,
                  best.idx,
                  bandNumbpsPerComp[bestC],
                  codInfo
                );
              }
              if (++cur.x >= pp.numPrecinctsWide) {
                cur.x = 0;
                cur.y++;
              }
            }
          }
        } else if (progressionOrder === ProgressionOrder.Pcrl) {
          // Position-Component-Resolution-Layer
          for (;;) {
            let best = null;
            let bestC = -1;
            let bestR = -1;
            for (let c = 0; c < numComponents; c++) {
              for (let r = 0; r <= decompositionLevels; r++) {
                const cand = peekProgPrecinct(c, r);
                if (!cand) {
                  continue;
                }
                if (
                  !best ||
                  cand.y < best.y ||
                  (cand.y === best.y && cand.x < best.x) ||
                  (cand.y === best.y && cand.x === best.x && c < bestC) ||
                  (cand.y === best.y && cand.x === best.x && c === bestC && r < bestR)
                ) {
                  best = cand;
                  bestC = c;
                  bestR = r;
                }
              }
            }
            if (!best) {
              break;
            }
            const resolution = tile.tileComponents[bestC].resolutions[bestR];
            const pp = resolution.getPrecinctParameters();
            const cur = progCursors[bestC][bestR];
            for (let l = 0; l < qualityLayers; l++) {
              if (this.packetReader.isExhausted(pos, dataEnd)) {
                break;
              }
              pos = this.packetReader.readPacket(
                buffer,
                pos,
                dataEnd,
                l,
                bestC,
                bestR,
                resolution,
                best.idx,
                bandNumbpsPerComp[bestC],
                codInfo
              );
            }
            if (++cur.x >= pp.numPrecinctsWide) {
              cur.x = 0;
              cur.y++;
            }
          }
        } else if (progressionOrder === ProgressionOrder.Cprl) {
          // Component-Position-Resolution-Layer
          for (let c = 0; c < numComponents; c++) {
            for (;;) {
              let best = null;
              let bestR = -1;
              for (let r = 0; r <= decompositionLevels; r++) {
                const cand = peekProgPrecinct(c, r);
                if (!cand) {
                  continue;
                }
                if (!best || cand.y < best.y || (cand.y === best.y && cand.x < best.x)) {
                  best = cand;
                  bestR = r;
                }
              }
              if (!best) {
                break;
              }
              const resolution = tile.tileComponents[c].resolutions[bestR];
              const pp = resolution.getPrecinctParameters();
              const cur = progCursors[c][bestR];
              for (let l = 0; l < qualityLayers; l++) {
                if (this.packetReader.isExhausted(pos, dataEnd)) {
                  break;
                }
                pos = this.packetReader.readPacket(
                  buffer,
                  pos,
                  dataEnd,
                  l,
                  c,
                  bestR,
                  resolution,
                  best.idx,
                  bandNumbpsPerComp[c],
                  codInfo
                );
              }
              if (++cur.x >= pp.numPrecinctsWide) {
                cur.x = 0;
                cur.y++;
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
        const compQcd = effectiveQcds[c];
        //guardBits = compQcd.quantizationStyle >> 5;
        // Codeblock style bit 0x08 = vertically stripe-causal context (VSC).
        const stripeCausal = (tc.getCodingStyleParameters().getCodeblockStyle() & 0x08) !== 0;

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
          this._assembleBand(
            llBand,
            llBuf,
            llW,
            llSx0,
            llSy0,
            compQcd,
            0,
            isReversible,
            bitDepth,
            stripeCausal
          );
          resolutionsForIDWT.push({ width: llW, height: llH, ll: llBuf, x0: llSx0, y0: llSy0 });
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
            compQcd,
            bandIdxHl,
            isReversible,
            bitDepth,
            stripeCausal
          );
          this._assembleBand(
            lhBand,
            lhBuf,
            lhW,
            lhSx0,
            lhSy0,
            compQcd,
            bandIdxLh,
            isReversible,
            bitDepth,
            stripeCausal
          );
          this._assembleBand(
            hhBand,
            hhBuf,
            hhW,
            hhSx0,
            hhSy0,
            compQcd,
            bandIdxHh,
            isReversible,
            bitDepth,
            stripeCausal
          );

          resolutionsForIDWT.push({
            width: resW,
            height: resH,
            hl: hlBuf,
            lh: lhBuf,
            hh: hhBuf,
            x0: res.getResolutionRectangle().getPoint().getX(),
            y0: res.getResolutionRectangle().getPoint().getY(),
            hlW: hlW,
            hlH: hlH,
            lhW: lhW,
            lhH: lhH,
          });
        }

        // Run IDWT
        const pixels = this.wavelet.iDwt2d(resolutionsForIDWT, isReversible);
        componentData.push(pixels);
      }

      // Inverse colour transform
      if (isColorTransform && numComponents >= 3) {
        const len = componentData[0].length;
        // Cache array references to reduce property lookups
        const comp0 = componentData[0];
        const comp1 = componentData[1];
        const comp2 = componentData[2];

        if (isReversible) {
          // Inverse RCT: Y, Cb, Cr → R, G, B  (integer arithmetic)
          for (let i = 0; i < len; i++) {
            const y = comp0[i];
            const cb = comp1[i];
            const cr = comp2[i];
            const g = y - ((cb + cr) >> 2);
            comp0[i] = cr + g; // R
            comp1[i] = g; // G
            comp2[i] = cb + g; // B
          }
        } else {
          // Inverse ICT with precomputed constants
          const ICT_CR_R = 1.402;
          const ICT_CB_G = -0.34413;
          const ICT_CR_G = -0.71414;
          const ICT_CB_B = 1.772;

          for (let i = 0; i < len; i++) {
            const y = comp0[i];
            const cb = comp1[i];
            const cr = comp2[i];
            comp0[i] = y + ICT_CR_R * cr; // R
            comp1[i] = y + ICT_CB_G * cb + ICT_CR_G * cr; // G
            comp2[i] = y + ICT_CB_B * cb; // B
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
        const imgH = siz.getHeight(c);
        const imgComp = imageComps[c];

        // Tiles routinely extend beyond the image area (the nominal grid is
        // not aligned with x0siz/y0siz). Clip the copy rectangle to the
        // image: an unclamped negative dstX0/dstY0 would wrap into the
        // previous line and corrupt unrelated pixels.
        const row0 = Math.max(0, -dstY0);
        const row1 = Math.min(tcH, imgH - dstY0);
        const col0 = Math.max(0, -dstX0);
        const col1 = Math.min(tcW, imgW - dstX0);
        for (let row = row0; row < row1; row++) {
          const srcOff = row * tcW;
          const dstOff = (dstY0 + row) * imgW + dstX0;
          for (let col = col0; col < col1; col++) {
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

    // PPM state belongs to this decode invocation only.
    this.packetReader.clearPphSource();

    const nlt = this._findNltSegment(0);
    return {
      components: imageComps,
      width: siz.getWidth(0),
      height: siz.getHeight(0),
      bitDepth: nlt ? nlt.getBitDepth() : siz.getBitDepth(0),
      signed: nlt ? nlt.isSigned() : siz.isSigned(0),
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
   * @param {boolean} [stripeCausal] - Vertically stripe-causal context (codeblock style bit 0x08).
   * @private
   */
  _assembleBand(
    sb,
    buf,
    sbW,
    sx0,
    sy0,
    qcd,
    bandIdx,
    isReversible,
    bitDepth,
    stripeCausal = false
  ) {
    // Step size Delta_b for this subband (Rec. T.800 Equation E-3). The
    // decoder-irreversible path uses log2-gain = 0 for every subband (the
    // subband gains are folded into the 9/7 synthesis filter normalization
    // instead, cf. OpenJPEG two_invK), so Rb is the component precision.
    let stepSize = 1.0;
    let mantissaOk = false;
    if (!isReversible && bandIdx < qcd.quantizationStepSize.length) {
      const s = qcd.quantizationStepSize[bandIdx];
      const twoByte = (qcd.quantizationStyle & 0x1f) === 2;
      const expn = twoByte ? s >> 11 : s >> 5;
      const mant = twoByte ? s & 0x7ff : (s & 0x1f) << 3;
      stepSize = (1 + mant / 2048) * Math.pow(2, (bitDepth || 8) - expn);
      mantissaOk = true;
    }

    const codeblocks = sb.codeblocks;
    const cbCount = codeblocks.length;

    // Concatenation scratch buffer, reused across multi-chunk codeblocks.
    let concatBuf = null;

    for (let cbIdx = 0; cbIdx < cbCount; cbIdx++) {
      const cb = codeblocks[cbIdx];
      const st = cb._pkt;
      if (!st || st.corrupted || st.numchunks === 0 || st.numsegs === 0) {
        continue;
      }

      const cbW = cb.cbx1 - cb.cbx0;
      const cbH = cb.cby1 - cb.cby0;
      if (cbW <= 0 || cbH <= 0) {
        continue;
      }

      const Mb = st.Mb;
      if (Mb === 0 || Mb > 30) {
        continue;
      }
      // zero_bplanes = (Mb + 1) - numbps (ht_dec.c). numbps > Mb + 1 means an
      // inconsistent (corrupted) zero-bitplane tree value; skip the codeblock.
      if (st.numbps > Mb + 1) {
        continue;
      }
      const zeroBplanes = Mb + 1 - st.numbps;
      if (zeroBplanes > Mb) {
        continue;
      }

      // Gather (possibly chunked) codeblock data, mirroring ht_dec.c.
      const chunks = st.chunks;
      const numchunks = st.numchunks;
      let cblkLen = 0;
      for (let i = 0; i < numchunks; i++) {
        cblkLen += chunks[i * 2 + 1];
      }
      let codedData;
      let dataOff = 0;
      if (numchunks === 1) {
        // Pass an exact byte view of the chunk with offset 0: BlockDecoder's
        // bit-reader alignment arithmetic assumes the codeblock data starts at
        // index 0 of the array it is given.
        codedData = this._codestreamBytes.subarray(chunks[0], chunks[0] + cblkLen);
      } else {
        if (concatBuf === null || concatBuf.length < cblkLen) {
          concatBuf = new Uint8Array(cblkLen);
        }
        let off = 0;
        for (let i = 0; i < numchunks; i++) {
          const pos = chunks[i * 2];
          const len = chunks[i * 2 + 1];
          concatBuf.set(this._codestreamBytes.subarray(pos, pos + len), off);
          off += len;
        }
        codedData = concatBuf;
      }

      // Per-segment accumulated state (opj_openjp2 ht_dec.c):
      // passes = segs[0].realNumPasses + segs[1].realNumPasses.
      let passes = st.segs[0].realNumPasses;
      passes += st.numsegs > 1 ? st.segs[1].realNumPasses : 0;
      let lengths1 = passes > 0 ? st.segs[0].len : 0;
      // OpenJPEG's segs array is zero-initialised: an uninitialised segs[1]
      // reads as { len: 0, real_num_passes: 0 }. Mirror that here.
      const lengths2 = passes > 1 && st.numsegs > 1 ? st.segs[1].len : 0;
      if (passes > 1 && lengths2 === 0) {
        passes = 1;
      }
      if (zeroBplanes === Mb && passes > 1) {
        passes = 1;
      }
      // OpenJPEG's ht_dec hard-fails when the accumulated pass count exceeds
      // three, but multi-layer HT streams legitimately carry many
      // refinement passes per segment: the HT entropy streams are
      // bitplane-driven, so the pass type saturates at CUP+SPP+MRP while the
      // full lengths1/lengths2 byte ranges still carry every accumulated pass.
      // Clamp instead of rejecting (matches BlockDecoder's own clamping).
      if (passes > 3) {
        passes = 3;
      }
      if (lengths1 < 2 || lengths1 > cblkLen || lengths1 + lengths2 > cblkLen) {
        continue;
      }

      // BlockDecoder follows the OpenJPH convention where missingMSBs
      // counts the all-zero planes strictly ABOVE the first significant
      // bitplane, i.e. openjpeg_zero_bplanes - 1 (block decoders typically
      // pass missing_msbs = mb - numbps - 1 with their own numbps offset).
      // The OpenJPEG-style guards above still use the standard count.
      const missingMSBs = zeroBplanes > 0 ? zeroBplanes - 1 : 0;
      const p = 30 - missingMSBs;
      if (p < 0) {
        continue;
      }

      // Decode codeblock and get array of quantized coefficients
      const coeffs = this.blockDecoder.decodeCodeblock(
        codedData,
        dataOff,
        missingMSBs,
        passes,
        lengths1,
        lengths2,
        cbW,
        cbH,
        stripeCausal
      );
      if (!coeffs) {
        continue;
      }

      // Map codeblock coefficients into the subband buffer
      const dstX0 = cb.cbx0 - sx0;
      const dstY0 = cb.cby0 - sy0;
      const dstBase = dstY0 * sbW + dstX0;

      if (isReversible) {
        // Reversible path - integer operations. `buf` is freshly zero-initialised,
        // so we can skip writing 0 explicitly (the common case).
        const mask = 0x7fffffff;
        for (let j = 0; j < cbH; j++) {
          const srcOff = j * cbW;
          const dstOff = dstBase + j * sbW;
          for (let i = 0; i < cbW; i++) {
            const val = coeffs[srcOff + i];
            if (val !== 0) {
              const mag = (val & mask) >>> p;
              buf[dstOff + i] = val >>> 31 ? -mag : mag;
            }
          }
        }
      } else {
        // Irreversible path - floating point with quantization.
        //
        // BlockDecoder returns magnitudes normalized to bit 30, i.e. the
        // decoded int32 codeblock values left-shifted by (30 - (Mb -
        // zeroBplanes) + 1) = 31 - zeroBplanes - numbps. We replicate
        // OpenJPEG's gain-free de-quintization exactly: the decoded int32
        // is multiplied by 0.5 * stepsize, where stepsize omits the subband
        // gain (log2_gain is forced to 0 by BUG_WEIRD_TWO_INVK in tcd.c).
        // The subband gains are instead applied inside the inverse DWT by
        // OpenJPEG's use of two_invK = 2 * invK on the high bands, which
        // the 9/7 synthesis in Wavelet.js mirrors.
        const mask = 0x7fffffff;
        const scale = mantissaOk ? 0.5 * stepSize * Math.pow(2, st.numbps + zeroBplanes - 31) : 1.0;
        for (let j = 0; j < cbH; j++) {
          const srcOff = j * cbW;
          const dstOff = dstBase + j * sbW;
          for (let i = 0; i < cbW; i++) {
            const val = coeffs[srcOff + i];
            if (val !== 0) {
              const mag = val & mask;
              buf[dstOff + i] = val >>> 31 ? -mag * scale : mag * scale;
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
   * @returns {number} segment.length length.
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
// Temporary debug export removed
module.exports = Codestream;
//#endregion
