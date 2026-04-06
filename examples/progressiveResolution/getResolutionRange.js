const Parser = require('../../src/Parser');
const ParserWriter = require('../../src/ParserWriter');

const getStartPosition = (bufferStream, sotSegments, startResolution) => {
  if (startResolution === 0 || startResolution === undefined) {
    return 0;
  }
  if (startResolution >= sotSegments.length) {
    return bufferStream.buffer.length;
  }
  return sotSegments[startResolution].position;
};

const getEndPosition = (bufferStream, sotSegments, endResolution) => {
  if (endResolution === undefined) {
    return bufferStream.buffer.length;
  }
  if (endResolution >= sotSegments.length) {
    return bufferStream.buffer.length;
  }
  return sotSegments[endResolution].position + sotSegments[endResolution].tilePartLength;
};

const createResponse = (bufferStream, sotSegments, startResolution, endResolution) => {
  let startPosition = getStartPosition(bufferStream, sotSegments, startResolution);
  let endPosition = getEndPosition(bufferStream, sotSegments, endResolution);
  return bufferStream.buffer.slice(startPosition, endPosition);
};

const getResolutionRange = async (readable, startResolution, endResolution) => {
  let parser = undefined;

  let sotSegments = [];

  const segment = (segment) => {
    //console.log(segment)
    if (segment.markerName === 'Sot') {
      sotSegments.push(segment);
    }

    // cancel the parsing once we have the data we need so we don't
    // waste resources.  This will result in a ParseCancelledError being thrown
    // on the parseWriter
    if (endResolution !== undefined) {
      if (sotSegments.length > endResolution) {
        parser.cancel();
      }
    }
  };

  const handler = { segment };
  parser = new Parser(handler, { trace: true });
  const parserWriter = new ParserWriter(parser);

  // This is called when an error occurs.  The parser will throw a ParseCancelledError
  // if the parser is cancelled so we check for this and suppress it since this is
  // expected behavior in an early termination case where a request does not requrie
  // the full bitstream
  parserWriter.on('error', (err) => {
    if (err.name !== 'ParseCancelledError') {
      console.log(err);
    }
  });

  readable.pipe(parserWriter);

  await parser.complete();

  const bufferStream = parser.getBufferStream();

  return createResponse(bufferStream, sotSegments, startResolution, endResolution);
};

module.exports = getResolutionRange;
