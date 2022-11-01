const BinaryReader = require('./../src/BinaryReader');

const { SmartBuffer } = require('smart-buffer');
const chai = require('chai');
const expect = chai.expect;

const types = {
  uint32BE: {
    writeFn: 'writeUInt32BE',
    readFn: 'readUint32',
    min: 0x00000000,
    max: 0xffffffff,
    littleEndian: false,
    byteLength: 4,
  },
  uint32LE: {
    writeFn: 'writeUInt32LE',
    readFn: 'readUint32',
    min: 0x00000000,
    max: 0xffffffff,
    littleEndian: true,
    byteLength: 4,
  },
  uint16BE: {
    writeFn: 'writeUInt16BE',
    readFn: 'readUint16',
    min: 0x0000,
    max: 0xffff,
    littleEndian: false,
    byteLength: 2,
  },
  uint16LE: {
    writeFn: 'writeUInt16LE',
    readFn: 'readUint16',
    min: 0x0000,
    max: 0xffff,
    littleEndian: true,
    byteLength: 2,
  },
  int32BE: {
    writeFn: 'writeInt32BE',
    readFn: 'readInt32',
    min: 0x80000000,
    max: 0x7fffffff,
    littleEndian: false,
    byteLength: 4,
  },
  int32LE: {
    writeFn: 'writeInt32LE',
    readFn: 'readInt32',
    min: 0x80000000,
    max: 0x7fffffff,
    littleEndian: true,
    byteLength: 4,
  },
  int16BE: {
    writeFn: 'writeInt16BE',
    readFn: 'readInt16',
    min: 0x8000,
    max: 0x7fff,
    littleEndian: false,
    byteLength: 2,
  },
  int16LE: {
    writeFn: 'writeInt16LE',
    readFn: 'readInt16',
    min: 0x8000,
    max: 0x7fff,
    littleEndian: true,
    byteLength: 2,
  },
  uint8LE: {
    writeFn: 'writeUInt8',
    readFn: 'readUint8',
    min: 0x00,
    max: 0xff,
    littleEndian: true,
    byteLength: 1,
  },
};

function getRandomInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

describe('BinaryReader', () => {
  it('should correctly read individual numeric types', () => {
    Object.keys(types).forEach((type) => {
      const smartBuffer = SmartBuffer.fromOptions({
        encoding: 'ascii',
      });
      const typeObj = types[type];
      const writeValue = getRandomInteger(typeObj.min, typeObj.max);
      smartBuffer[typeObj.writeFn](writeValue);

      const buffer = smartBuffer.toBuffer();
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );

      const binaryReader = new BinaryReader(arrayBuffer, typeObj.littleEndian);
      expect(binaryReader.length()).to.be.eq(typeObj.byteLength);
      const readValue = binaryReader[typeObj.readFn]();

      expect(writeValue).to.be.eq(readValue);
      expect(binaryReader.position()).to.be.eq(typeObj.byteLength);
      expect(binaryReader.isAtEnd()).to.be.true;
    });
  });

  it('should correctly read multiple numeric types', () => {
    const littleEndian = [true, false];
    littleEndian.forEach((le) => {
      const size = getRandomInteger(256, 1024);
      const filteredTypes = Object.keys(types).filter((key) => types[key].littleEndian === le);
      const typeValues = new Array(size).fill().map(() => {
        const type = filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
        const typeObj = types[type];
        return { type, value: getRandomInteger(typeObj.min, typeObj.max) };
      });

      const smartBuffer = SmartBuffer.fromOptions({
        encoding: 'ascii',
      });

      typeValues.forEach((typeValue) => {
        const typeObj = types[typeValue.type];
        smartBuffer[typeObj.writeFn](typeValue.value);
      });

      const buffer = smartBuffer.toBuffer();
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );

      const binaryReader = new BinaryReader(arrayBuffer, le);
      [0, 1].forEach(() => {
        typeValues.forEach((typeValue) => {
          const typeObj = types[typeValue.type];
          const readValue = binaryReader[typeObj.readFn]();
          expect(typeValue.value).to.be.eq(readValue);
        });
        expect(binaryReader.isAtEnd()).to.be.true;
        binaryReader.reset();
      });
    });
  });

  it('should correctly read strings', () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = getRandomInteger(256, 1024);

    let randomString = '';
    for (let i = 0; i < length; i++) {
      randomString += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const smartBuffer = SmartBuffer.fromOptions({
      encoding: 'ascii',
    });
    smartBuffer.writeString(randomString);

    const buffer = smartBuffer.toBuffer();
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );

    const binaryReader = new BinaryReader(arrayBuffer);
    expect(binaryReader.readString(length)).to.be.eq(randomString);
    expect(binaryReader.isAtEnd()).to.be.true;
  });

  it('should correctly read arrays', () => {
    const littleEndian = [true, false];
    const arrayTypeMap = { uint8: 'readUint8Array' };

    Object.keys(arrayTypeMap).forEach((arrayType) => {
      const arrayTypeMapReadFn = arrayTypeMap[arrayType];
      littleEndian.forEach((le) => {
        const size = getRandomInteger(10, 20);
        const filteredTypes = Object.keys(types).filter(
          (key) => types[key].littleEndian === le && key.includes(arrayType)
        );
        if (filteredTypes.length !== 0) {
          const typeValues = new Array(size).fill().map(() => {
            const type = filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
            const typeObj = types[type];
            let arraySize = getRandomInteger(10, 20);
            arraySize += arraySize % 2 === 1 ? 1 : 0;
            return {
              type,
              values: new Array(arraySize)
                .fill()
                .map(() => getRandomInteger(typeObj.min, typeObj.max)),
            };
          });

          const smartBuffer = SmartBuffer.fromOptions({
            encoding: 'ascii',
          });

          typeValues.forEach((typeValue) => {
            const typeObj = types[typeValue.type];
            typeValue.values.forEach((value) => {
              smartBuffer[typeObj.writeFn](value);
            });
          });

          const buffer = smartBuffer.toBuffer();
          const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          );

          const binaryReader = new BinaryReader(arrayBuffer, le);
          [0, 1].forEach(() => {
            typeValues.forEach((typeValue) => {
              const typeObj = types[typeValue.type];
              const readValues = binaryReader[arrayTypeMapReadFn](
                typeObj.byteLength * typeValue.values.length
              );
              expect(typeValue.values).to.deep.equal(Array.from(readValues));
            });
            expect(binaryReader.isAtEnd()).to.be.true;
            binaryReader.reset();
          });
        }
      });
    });
  });
});
