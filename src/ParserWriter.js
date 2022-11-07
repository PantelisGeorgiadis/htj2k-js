const Writable = require('stream').Writable;

class ParserWriter extends Writable {

    constructor(parser, options) {
        super(options)

        this.parser = parser
    }

    _write(chunk, encoding, callback) {

        let forceDrain = false;

        try {
            const result = this.parser.write(chunk)
            callback();
        } catch(err) {
            callback(err)
        }

        return forceDrain;
    }

    end(chunk, encoding) {
        console.log('Writer "end"', chunk);
        this.parser.end()
    }

}

module.exports = ParserWriter