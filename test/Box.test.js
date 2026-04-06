const {
  Box,
  BoxReader,
  ColorSpecificationBox,
  FileTypeBox,
  ImageHeaderBox,
  Jp2SignatureBox,
  UrlBox,
  XmlBox,
} = require('./../src/Box');
const { BoxType } = require('./../src/Constants');

const chai = require('chai');
const expect = chai.expect;

// Build an ArrayBuffer with payloadBytes at offset 0 and 8 zero bytes appended.
// byteLength = payload + 8 mirrors what BoxReader._readBoxesImpl passes to box constructors.
function makeBoxBuffer(payloadBytes) {
  const buf = Buffer.alloc(payloadBytes.length + 8);
  for (let i = 0; i < payloadBytes.length; i++) {
    buf[i] = payloadBytes[i];
  }
  return buf.buffer;
}

function uint32BE(val) {
  return [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
}

function uint16BE(val) {
  return [(val >>> 8) & 0xff, val & 0xff];
}

describe('Box', () => {
  it('should store type, position and buffer from constructor', () => {
    const buf = new ArrayBuffer(8);
    const box = new Box(BoxType.XmlBox, 100, buf);
    expect(box.getType()).to.equal(BoxType.XmlBox);
    expect(box.getPosition()).to.equal(100);
    expect(box.getBuffer()).to.equal(buf);
  });

  it('should return byteLength from getLength', () => {
    const buf = new ArrayBuffer(20);
    const box = new Box(BoxType.FileTypeBox, 0, buf);
    expect(box.getLength()).to.equal(20);
  });

  it('should return 0 from getLength when buffer is falsy', () => {
    const box = new Box(BoxType.XmlBox, 0, null);
    expect(box.getLength()).to.equal(0);
  });

  it('should throw from parse()', () => {
    const box = new Box(BoxType.XmlBox, 0, new ArrayBuffer(8));
    expect(() => box.parse()).to.throw('parse should be implemented');
  });

  it('should include type name and position in toString()', () => {
    const box = new Box(BoxType.XmlBox, 256, new ArrayBuffer(8));
    const str = box.toString();
    expect(str).to.include('XmlBox');
    expect(str).to.include('256');
  });

  it('should fall back to hex type in toString() for unknown type value', () => {
    const box = new Box(0xdeadbeef, 0, new ArrayBuffer(8));
    const str = box.toString();
    expect(str).to.include('0xdeadbeef');
  });
});

describe('FileTypeBox', () => {
  it('should have BoxType.FileTypeBox as its type', () => {
    const box = new FileTypeBox(0, new ArrayBuffer(16));
    expect(box.getType()).to.equal(BoxType.FileTypeBox);
  });

  it('should parse brand and minorVersion correctly', () => {
    // payload: brand(4) + minorVersion(4)
    const payload = [...uint32BE(0x6a703220), ...uint32BE(1)];
    const box = new FileTypeBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getBrand()).to.equal(0x6a703220);
    expect(box.getMinorVersion()).to.equal(1);
    expect(box.getCompatibilityList()).to.deep.equal([]);
  });

  it('should parse a non-empty compatibility list', () => {
    // payload: brand(4) + minorVersion(4) + one compat entry(4)
    const payload = [...uint32BE(0x6a703220), ...uint32BE(0), ...uint32BE(0x6a703220)];
    const box = new FileTypeBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getCompatibilityList()).to.deep.equal([0x6a703220]);
  });

  it('should include brand value in toString()', () => {
    const payload = [...uint32BE(0x6a703220), ...uint32BE(0)];
    const box = new FileTypeBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.toString()).to.include('FileTypeBox');
  });
});

describe('Jp2SignatureBox', () => {
  it('should have BoxType.Jp2SignatureBox as its type', () => {
    const payload = uint32BE(0x0d0a870a);
    const box = new Jp2SignatureBox(0, makeBoxBuffer(payload));
    expect(box.getType()).to.equal(BoxType.Jp2SignatureBox);
  });

  it('should parse the signature value', () => {
    const payload = uint32BE(0x0d0a870a);
    const box = new Jp2SignatureBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getSignature()).to.equal(0x0d0a870a);
  });

  it('should report isSignatureValid() true for the correct signature', () => {
    const payload = uint32BE(0x0d0a870a);
    const box = new Jp2SignatureBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.isSignatureValid()).to.equal(true);
  });

  it('should report isSignatureValid() false for an incorrect signature', () => {
    const payload = uint32BE(0x12345678);
    const box = new Jp2SignatureBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.isSignatureValid()).to.equal(false);
  });
});

describe('ImageHeaderBox', () => {
  function makeIhdrBuffer({
    height,
    width,
    components,
    precision,
    compressionType,
    unknownCs,
    ip,
  }) {
    return makeBoxBuffer([
      ...uint32BE(height),
      ...uint32BE(width),
      ...uint16BE(components),
      precision & 0xff,
      compressionType & 0xff,
      unknownCs & 0xff,
      ip & 0xff,
    ]);
  }

  it('should parse width and height', () => {
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 512,
        width: 256,
        components: 1,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 0,
        ip: 0,
      })
    );
    box.parse();
    expect(box.getWidth()).to.equal(256);
    expect(box.getHeight()).to.equal(512);
  });

  it('should parse number of components', () => {
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 8,
        width: 8,
        components: 3,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 0,
        ip: 0,
      })
    );
    box.parse();
    expect(box.getComponents()).to.equal(3);
  });

  it('should report correct bit depth from precision byte', () => {
    // precision = 0x07 → (0x07 & 0x7f) + 1 = 8
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 1,
        width: 1,
        components: 1,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 0,
        ip: 0,
      })
    );
    box.parse();
    expect(box.getBitDepth()).to.equal(8);
  });

  it('should report isSigned() false when sign bit is clear', () => {
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 1,
        width: 1,
        components: 1,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 0,
        ip: 0,
      })
    );
    box.parse();
    expect(box.isSigned()).to.equal(false);
  });

  it('should report isSigned() true when sign bit is set', () => {
    // precision = 0x87 → bit 7 set → signed
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 1,
        width: 1,
        components: 1,
        precision: 0x87,
        compressionType: 7,
        unknownCs: 0,
        ip: 0,
      })
    );
    box.parse();
    expect(box.isSigned()).to.equal(true);
    expect(box.getBitDepth()).to.equal(8);
  });

  it('should report getUnknownColorspace() correctly', () => {
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 1,
        width: 1,
        components: 1,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 1,
        ip: 0,
      })
    );
    box.parse();
    expect(box.getUnknownColorspace()).to.equal(true);
  });

  it('should report getIntellectualProperty() correctly', () => {
    const box = new ImageHeaderBox(
      0,
      makeIhdrBuffer({
        height: 1,
        width: 1,
        components: 1,
        precision: 0x07,
        compressionType: 7,
        unknownCs: 0,
        ip: 1,
      })
    );
    box.parse();
    expect(box.getIntellectualProperty()).to.equal(true);
  });
});

describe('ColorSpecificationBox', () => {
  it('should parse method, precedence and approximation', () => {
    // method=1, precedence=2, approximation=3, ecs=17 (Gray)
    const payload = [1, 2, 3, ...uint32BE(17)];
    const box = new ColorSpecificationBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getMethod()).to.equal(1);
    expect(box.getPrecedence()).to.equal(2);
    expect(box.getApproximationAccuracy()).to.equal(3);
  });

  it('should parse the enumerated color space when method is 1', () => {
    const payload = [1, 0, 0, ...uint32BE(17)]; // ecs = Gray (17)
    const box = new ColorSpecificationBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getEnumeratedColorSpace()).to.equal(17);
    expect(box.getIccProfileData()).to.equal(undefined);
  });

  it('should parse ICC profile data when method is 2', () => {
    const iccData = [0x01, 0x02, 0x03];
    const payload = [2, 0, 0, ...iccData]; // method=2
    const box = new ColorSpecificationBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getIccProfileData()).to.be.instanceOf(Uint8Array);
    expect(Array.from(box.getIccProfileData())).to.deep.equal(iccData);
  });

  it('should parse ICC profile data when method is 3', () => {
    const iccData = [0xaa, 0xbb];
    const payload = [3, 0, 0, ...iccData]; // method=3
    const box = new ColorSpecificationBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getIccProfileData()).to.be.instanceOf(Uint8Array);
    expect(Array.from(box.getIccProfileData())).to.deep.equal(iccData);
  });
});

describe('XmlBox', () => {
  it('should parse an XML string from the buffer', () => {
    const xml = '<root/>';
    const payload = [...xml].map((c) => c.charCodeAt(0));
    const box = new XmlBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.getXml()).to.equal(xml);
  });

  it('should parse an empty string when payload is empty', () => {
    const box = new XmlBox(0, makeBoxBuffer([]));
    box.parse();
    expect(box.getXml()).to.equal('');
  });

  it('should include the XML content in toString()', () => {
    const xml = '<test/>';
    const payload = [...xml].map((c) => c.charCodeAt(0));
    const box = new XmlBox(0, makeBoxBuffer(payload));
    box.parse();
    expect(box.toString()).to.include('<test/>');
  });
});

describe('UrlBox', () => {
  function makeUrlBuffer(version, flags, url) {
    const urlBytes = [...url].map((c) => c.charCodeAt(0));
    const payload = [
      version & 0xff,
      (flags >>> 16) & 0xff,
      (flags >>> 8) & 0xff,
      flags & 0xff,
      ...urlBytes,
    ];
    return makeBoxBuffer(payload);
  }

  it('should parse version and flags', () => {
    const box = new UrlBox(0, makeUrlBuffer(1, 0x000002, 'http://example.com'));
    box.parse();
    expect(box.getVersion()).to.equal(1);
    expect(box.getFlags()).to.equal(2);
  });

  it('should parse the URL string', () => {
    const box = new UrlBox(0, makeUrlBuffer(0, 0, 'http://example.com'));
    box.parse();
    expect(box.getUrl()).to.equal('http://example.com');
  });

  it('should handle an empty URL', () => {
    const box = new UrlBox(0, makeUrlBuffer(0, 0, ''));
    box.parse();
    expect(box.getUrl()).to.equal('');
  });
});

describe('BoxReader', () => {
  // Build a raw JP2-style byte stream for BoxReader tests.
  // Box layout: [LBox(4)][TBox(4)][payload...]. readBoxes() needs 8 extra trailing bytes.
  function makeStream(...boxes) {
    const parts = boxes.map(({ lbox, tbox, payload }) => {
      const part = Buffer.alloc(Math.max(lbox, 8 + payload.length));
      const dv = new DataView(part.buffer);
      dv.setUint32(0, lbox, false);
      dv.setUint32(4, tbox, false);
      for (let i = 0; i < payload.length; i++) {
        part[8 + i] = payload[i];
      }
      return part;
    });
    // Append 8 trailing zero bytes so readUint8Array doesn't go out of range on the last box.
    const total = parts.reduce((s, p) => s + p.length, 0) + 8;
    const combined = Buffer.alloc(total);
    let offset = 0;
    for (const p of parts) {
      p.copy(combined, offset);
      offset += p.length;
    }
    return combined.buffer;
  }

  it('should return an empty array before readBoxes() is called', () => {
    const stream = makeStream({
      lbox: 12,
      tbox: BoxType.Jp2SignatureBox,
      payload: uint32BE(0x0d0a870a),
    });
    const reader = new BoxReader(stream);
    expect(reader.getBoxes()).to.deep.equal([]);
  });

  it('should parse a Jp2SignatureBox from a stream', () => {
    const stream = makeStream({
      lbox: 12,
      tbox: BoxType.Jp2SignatureBox,
      payload: uint32BE(0x0d0a870a),
    });
    const reader = new BoxReader(stream);
    reader.readBoxes();
    const sigBox = reader.getBoxes().find((b) => b.getType() === BoxType.Jp2SignatureBox);
    expect(sigBox).to.not.equal(undefined);
    expect(sigBox.isSignatureValid()).to.equal(true);
  });

  it('should parse a FileTypeBox from a stream', () => {
    const stream = makeStream({
      lbox: 16,
      tbox: BoxType.FileTypeBox,
      payload: [...uint32BE(0x6a703220), ...uint32BE(0)],
    });
    const reader = new BoxReader(stream);
    reader.readBoxes();
    const ftBox = reader.getBoxes().find((b) => b.getType() === BoxType.FileTypeBox);
    expect(ftBox).to.not.equal(undefined);
    expect(ftBox.getBrand()).to.equal(0x6a703220);
  });

  it('should parse multiple boxes from a stream in order', () => {
    const stream = makeStream(
      { lbox: 12, tbox: BoxType.Jp2SignatureBox, payload: uint32BE(0x0d0a870a) },
      { lbox: 16, tbox: BoxType.FileTypeBox, payload: [...uint32BE(0x6a703220), ...uint32BE(0)] }
    );
    const reader = new BoxReader(stream);
    reader.readBoxes();
    const knownBoxes = reader.getBoxes().filter((b) => b.getType() !== 0);
    expect(knownBoxes.length).to.equal(2);
    expect(knownBoxes[0].getType()).to.equal(BoxType.Jp2SignatureBox);
    expect(knownBoxes[1].getType()).to.equal(BoxType.FileTypeBox);
  });

  it('should throw for extended-length (LBox=1) boxes', () => {
    const stream = makeStream({ lbox: 1, tbox: BoxType.FileTypeBox, payload: [] });
    const reader = new BoxReader(stream);
    expect(() => reader.readBoxes()).to.throw('Extended length boxes are not supported');
  });
});
