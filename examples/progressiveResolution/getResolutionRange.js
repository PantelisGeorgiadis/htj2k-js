const Parser = require('../../src/Parser')
const ParserWriter = require('../../src/ParserWriter')

const getStartPosition = (bufferStream, sotSegments, startResolution) => {
    if(startResolution === 0 || startResolution === undefined) {
        return 0
    }
    if(startResolution >= sotSegments.length) {
        return bufferStream.buffer.length
    }
    return sotSegments[startResolution].position
}

const getEndPosition = (bufferStream, sotSegments, endResolution) => {
    if(endResolution === undefined) {
        return bufferStream.buffer.length
    }
    if(endResolution >= sotSegments.length) {
        return bufferStream.buffer.length
    }
    return sotSegments[endResolution].position + sotSegments[endResolution].tilePartLength
}

const createResponse = (bufferStream, sotSegments, startResolution, endResolution) => {
    let startPosition = getStartPosition(bufferStream, sotSegments, startResolution)
    let endPosition = getEndPosition(bufferStream, sotSegments, endResolution)
    //console.log('startPosition = ', startPosition)
    //console.log('endPosition = ', endPosition)
    return bufferStream.buffer.slice(startPosition, endPosition)
}

const getResolutionRange = async (readable, startResolution, endResolution) => {

    let sotSegments = []

    const segment = (segment) => {
        //console.log("NEW SEGMENT", segment)
        if(segment.markerName === 'Sot') {
            sotSegments.push(segment)
        }
        else if (segment.markerName === 'Eoc') {
            // end
        }

        //if(sotSegments.length === endResolution

    }
    
    const handler = {segment}
    const parser = new Parser(handler, {trace: true})
    const parserWriter = new ParserWriter(parser)

    readable.pipe(parserWriter)

    await parser.complete()
    //console.log('done!!')
    //console.log(sotSegments)

    const bufferStream = parser.getBufferStream()

    return createResponse(bufferStream, sotSegments, startResolution, endResolution)
}

module.exports = getResolutionRange