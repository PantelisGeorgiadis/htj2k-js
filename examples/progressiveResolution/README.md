# Progressive Resolution Demo

## Introduction

One of the more powerful features of HTJ2K (and JPEG2000) is the ability to provide
scalable access to different resolutions for the same image.  When specific HTJ2K
encoding options are used, the resulting bitstream encodes data in increasing resolution
order.  For example, a 512x512x16 bit grayscale image could look like this:

* Byte     0 - 286    - HTJ2K Header
* Byte   286 - 4543   - Resolution 0 data (128x128)  
* Byte  4543 - 14788  - Resolution 1 data (256x256) 
* Byte 14788 - 48266  - Resolution 2 data (512x512) 

A client with an HTJ2K decoder that supports partial bitstream decoding will allow an 
image to be decoded with just part of the bitstream.  This image will look very 
similar to the full resolution image but will have some details lost and is therefore
a "lossy" representation.  

A client can take advantage of this in a number of use cases:

1. Display a small thumbnail of the image.  Rather than downloading the entire 48266 bytes,
   the client could download the first 4543 bytes and have a high quality thumbnail of size 128x128
2. Provide a fast first low quality image and automatically improve it to full resolution:
   * Download bytes 0 - 4542 bytes, decode and render
   * Download bytes 4543 - 14788, append to bytes 0-4542, decode and render
   * Download bytes 1479 - 4826. append to bytes in step b, decode and render

## Encoding Options

Progression Order: RPCL
Encode TLM Markers: On

## Usage

This example shows how to extract out the bytes for specific resolution ranges.  This is
done using two paramters - startResolution and endResolution.  Using the example image
in the Introduction above, you will get the following results:

* start: 0 = Bytes 0-4826 (full resolution image)
* start: 0, end: 0 = Bytes 0-4543 (resolution level 0)
* start: 0, end: 1 = Bytes 0-14788 (resolution levels 0 and 1)
* start: 2, end: 2 = Bytes 14789-48266 (resolution level 2 - requires bytes 0-14789 to already be downloaded)

## Examples

```
$ node examples/progressiveResolution/index.js examples/MR01.jph 0
responseBuffer of length 48268
```

```
$ node examples/progressiveResolution/index.js examples/MR01.jph 0 0
responseBuffer of length 4539
```

```
$ node examples/progressiveResolution/index.js examples/MR01.jph 0 1
responseBuffer of length 14784
```

```
$ node examples/progressiveResolution/index.js examples/MR01.jph 2 2
responseBuffer of length 33482
```