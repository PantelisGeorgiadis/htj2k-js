const Parser = require('../../src/Parser')
const ParserWriter = require('../../src/ParserWriter')
const log = require('../../src/log');
const fs = require('fs');

log.setLevel("info");

(async () => {

    const fileName = process.argv[2] || './examples/lena_gray_unsigned_8_reversible.jpc'

    const segment = (segment) => {
        console.log("NEW SEGMENT", segment)
    }
    
    const handler = {segment}
    const parser = new Parser(handler, {trace: true})
    const parserWriter = new ParserWriter(parser)
    
    // Use the pipeline API to easily pipe a series of streams
    // together and get notified when the pipeline is fully done.
    // A pipeline to gzip a potentially huge video file efficiently:
    
    const readable = fs.createReadStream(fileName)
    readable.pipe(parserWriter)
    
    await parser.complete()
})()
