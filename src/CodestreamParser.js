
const SegmentParser = require('./SegmentParser');


const Marker = {
    Soc: 0x4f, // Start of codestream (required)
    Cap: 0x50, // Extended capability
    Siz: 0x51, // Image and tile size (required)
    Cod: 0x52, // Coding style default (required)
    Tlm: 0x55, // Tile-part lengths
    Prf: 0x56, // Profile
    Plm: 0x57, // Packet length, main header
    Plt: 0x58, // Packet length, tile-part header
    Cpf: 0x59, // Corresponding profile values
    Qcd: 0x5c, // Quantization default (required)
    Qcc: 0x5d, // Quantization component
    Com: 0x64, // Comment
    Sot: 0x90, // Start of tile-part
    Sop: 0x91, // Start of packet
    Eph: 0x92, // End of packet
    Sod: 0x93, // Start of data
    Eoc: 0xd9, // End of codestream (required)
  
    Coc: 0x53, // Coding style component
    Rgn: 0x5e, // Region of interest
    Poc: 0x5f, // Progression order change
    Ppm: 0x60, // Packed packet headers, main header
    Ppt: 0x61, // Packed packet headers, tile-part header
    Crg: 0x63, // Component registration
  };

class CodestreamParser {
    constructor() {
        this.parser = new SegmentParser()
        this.segments = []
    }

    parse(parser) {
        const bufferStream = parser.getBufferStream()
        // must have at least two bytes
        if(2 > bufferStream.buffer.length - bufferStream.position) {
            parser.wait()
            return this
        }

        const result = this.parser.parse(parser)

        // bad result, scan forward...
        if(!result) {
            //console.log('.')
            parser.advancePosition(1)
            return this
        }

        this.segments.push(result)

        console.log(result)

        if(result.markerName === 'Sod') {
            // user Sot length
            const sotSegment = this.segments[this.segments.length - 2]
            //console.log("sot=", sotSegment)
            parser.advancePosition(sotSegment.tilePartLength)
        }

        return this
    }
    /*
    parse2(parser) {
        //console.log('CodestreamParser.parse()')
        //parser.cancel()
        
        const bufferStream = parser.getBufferStream()
        if(1 > bufferStream.buffer.length - bufferStream.position) {
            parser.wait()
            return this
        }
        let m1 = bufferStream.buffer.readUint8(bufferStream.position)
        let marker
        if (m1 !== 0xff) {
            parser.advancePosition(1)
            return this
        }
        let m2 = bufferStream.buffer.readUint8(bufferStream.position+1)
        marker = (m1 << 8) | m2;
        if ((marker & 0xff00) !== 0xff00) {
            throw new Error(`Not a marker: ${marker.toString(16)}`)
        }
        marker &= 0xff
        
        let length =
            marker !== Marker.Soc &&
            marker !== Marker.Sod &&
            marker !== Marker.Eoc &&
            (marker < 0xd0 || marker > 0xd8)
            ? bufferStream.buffer.readUint16BE(bufferStream.position + 2) - 2
        : 0;

        Object.entries(Marker).map((item) => {
            if(item[1] === marker) {
                console.log("Marker: ", item[0], marker, 'length=', length, 'pos=', bufferStream.position)
            }
        })
        
        if(marker !== Marker.Sot) {
            parser.advancePosition(length + 2)
            return this
        } else if(marker == Marker.Sot) {
            parser.advancePosition(4)
            let bufferStream = parser.getBufferStream()

            const tileIndex = bufferStream.buffer.readUint16BE(bufferStream.position);
            const tilePartLength = bufferStream.buffer.readUint32BE(bufferStream.position + 2);
            const tilePartIndex = bufferStream.buffer.readUint8(bufferStream.position + 6);
            const tilePartCount = bufferStream.buffer.readUint8(bufferStream.position + 7)

            console.log(' tileIndex', tileIndex)
            console.log(' tilePartLength', tilePartLength)
            console.log(' tilePartIndex', tilePartIndex)
            console.log(' tilePartCount', tilePartCount)
            
            parser.advancePosition(length)
            bufferStream = parser.getBufferStream()

            let m1eot = bufferStream.buffer.readUint8(bufferStream.position)
            let markerEot
            if (m1eot === 0xff) {
                let m2eot = bufferStream.buffer.readUint8(bufferStream.position+1)
                markerEot = (m1 << 8) | m2eot;
                if ((markerEot & 0xff00) !== 0xff00) {
                    throw new Error(`Not a marker: ${marker.toString(16)}`)
                }
                markerEot &= 0xff
            }
            let lengthEOT =
                markerEot !== Marker.Soc &&
                markerEot !== Marker.Sod &&
                markerEot !== Marker.Eoc &&
                (markerEot < 0xd0 || markerEot > 0xd8)
                ? bufferStream.buffer.readUint16BE(bufferStream.position + 2) - 2
                : 0;

            Object.entries(Marker).map((item) => {
                if(item[1] === marker) {
                    console.log("Marker: ", item[0], markerEot, 'length=', lengthEOT, 'pos=', bufferStream.position)
                }
            })
            parser.advancePosition(length + 2)
        } 
        return this
    }
    */
}


module.exports = CodestreamParser