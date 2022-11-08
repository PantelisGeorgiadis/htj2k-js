
const SegmentParser = require('./SegmentParser');
const log = require('./log');

class CodestreamParser {
    constructor() {
        this.parser = new SegmentParser()
        this.segments = []
    }

    parse(parser) {
        log.debug('CodestreamParser.parse()')
        const bufferStream = parser.getBufferStream()
        // must have at least two bytes
        if(2 > bufferStream.buffer.length - bufferStream.position) {
            parser.wait()
            return this
        }

        const result = this.parser.parse(parser)

        // bad result, scan forward...
        if(!result) {
            console.log('.')
            parser.advancePosition(1)
            return this
        }

        parser.getHandler().segment(result)

        this.segments.push(result)

        if(result.markerName === 'Sod') {
            // use Sot length
            const sotSegment = this.segments[this.segments.length - 2]
            parser.advancePosition(sotSegment.tilePartLength)
        }

        return this
    }
   
}


module.exports = CodestreamParser