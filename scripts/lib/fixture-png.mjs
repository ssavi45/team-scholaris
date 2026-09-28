import { deflateSync } from 'node:zlib'
// Tiny deterministic RGB fixture with valid CRCs (no image-library dependency).
export function fixturePng() {
  const chunk = (name, bytes) => {
    const data = Buffer.concat([Buffer.from(name), bytes])
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, data, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,30,70,45,30,70,45,0,30,70,45,30,70,45]))), chunk('IEND', Buffer.alloc(0))])
}
