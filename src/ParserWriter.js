const Writable = require('stream').Writable;
const log = require('./log');
const ParseCancelledError = require('./ParseCancelledError');

class ParserWriter extends Writable {
  constructor(parser, options) {
    super(options);

    this.parser = parser;
  }

  _write(chunk, encoding, callback) {
    log.debug(`ParserWriter._write(${chunk.length})`);
    let forceDrain = false;

    try {
      const result = this.parser.write(chunk);
      if (!result) {
        callback(new ParseCancelledError());
        return forceDrain;
      }
      callback();
    } catch (err) {
      callback(err);
    }

    return forceDrain;
  }

  end() {
    log.debug(`ParserWriter.end()`);
    this.parser.end();
  }
}

module.exports = ParserWriter;
