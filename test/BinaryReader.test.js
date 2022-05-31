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
  },
  uint32LE: {
    writeFn: 'writeUInt32LE',
    readFn: 'readUint32',
    min: 0x00000000,
    max: 0xffffffff,
    littleEndian: true,
  },
  uint16BE: {
    writeFn: 'writeUInt16BE',
    readFn: 'readUint16',
    min: 0x0000,
    max: 0xffff,
    littleEndian: false,
  },
  uint16LE: {
    writeFn: 'writeUInt16LE',
    readFn: 'readUint16',
    min: 0x0000,
    max: 0xffff,
    littleEndian: true,
  },
  int32BE: {
    writeFn: 'writeInt32BE',
    readFn: 'readInt32',
    min: 0x80000000,
    max: 0x7fffffff,
    littleEndian: false,
  },
  int32LE: {
    writeFn: 'writeInt32LE',
    readFn: 'readInt32',
    min: 0x80000000,
    max: 0x7fffffff,
    littleEndian: true,
  },
  int16BE: {
    writeFn: 'writeInt16BE',
    readFn: 'readInt16',
    min: 0x8000,
    max: 0x7fff,
    littleEndian: false,
  },
  int16LE: {
    writeFn: 'writeInt16LE',
    readFn: 'readInt16',
    min: 0x8000,
    max: 0x7fff,
    littleEndian: true,
  },
  uint8LE: {
    writeFn: 'writeUInt8',
    readFn: 'readUint8',
    min: 0x00,
    max: 0xff,
    littleEndian: true,
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
      const readValue = binaryReader[typeObj.readFn]();

      expect(writeValue).to.be.eq(readValue);
      expect(binaryReader.end()).to.be.true;
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
        expect(binaryReader.end()).to.be.true;
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
    expect(binaryReader.end()).to.be.true;
  });

  it('should correctly read arrays', () => {
    const littleEndian = [true, false];
    const arrayTypeMap = { uint16: 'readUint16Array' };
    Object.keys(arrayTypeMap).forEach((arrayType) => {
      const arrayTypeMapReadFn = arrayTypeMap[arrayType];
      littleEndian.forEach((le) => {
        const size = getRandomInteger(3, 4);
        const filteredTypes = Object.keys(types).filter(
          (key) => types[key].littleEndian === le && key.includes(arrayType)
        );
        const typeValues = new Array(size).fill().map(() => {
          const type = filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
          const typeObj = types[type];
          let arraySize = getRandomInteger(3, 4);
          arraySize += arraySize % 2 == 1 ? 1 : 0;
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

        console.log(typeValues);

        const buffer = smartBuffer.toBuffer();
        const arrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        console.log(arrayBuffer);

        const binaryReader = new BinaryReader(arrayBuffer, le);
        [0, 1].forEach(() => {
          typeValues.forEach((typeValue) => {
            const readValues = binaryReader[arrayTypeMapReadFn](2 * typeValue.values.length);
            //expect(typeValue.value).to.be.eq(readValue);
            console.log(typeValue.values.length);
            console.log(readValues);
            console.log(arrayTypeMapReadFn);
          });
          expect(binaryReader.end()).to.be.true;
          binaryReader.reset();
        });
      });
    });
  });
});
