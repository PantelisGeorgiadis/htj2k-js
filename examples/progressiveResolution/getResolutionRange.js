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
    return bufferStream.buffer.slice(startPosition, endPosition)
}

const getResolutionRange = async (readable, startResolution, endResolution) => {

    let parser = undefined

    let sotSegments = []

    const segment = (segment) => {
        //console.log(segment)
        if(segment.markerName === 'Sot') {
            sotSegments.push(segment)
        }

        // cancel the parsing once we have the data we need so we don't
        // waste resources
        if(endResolution !== undefined) {
            if(sotSegments.length > endResolution) {
                parser.cancel()
                console.log(parser)
            }
        }
    }

    const handler = {segment}
    parser = new Parser(handler, {trace: true})
    const parserWriter = new ParserWriter(parser)

    // This is called when the parser is cancelled due to early termination
    // TODO: Add logic to detect errors due to early termination/cancelling vs 
    //       other error types
    parserWriter.on('error', (err) => {
        //console.log('ERR CAUGHT:', err)
    })

    readable.pipe(parserWriter)

    await parser.complete()

    const bufferStream = parser.getBufferStream()

    return createResponse(bufferStream, sotSegments, startResolution, endResolution)
}

module.exports = getResolutionRange