import { describe, expect, it } from 'vitest';
import { sniffImage } from './users.controller';

describe('sniffImage', () => {
  it('recognises PNG, JPEG, GIF and WebP from their magic bytes', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects SVG, HTML and unknown data whatever the file is called', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(2))).toBeNull();
  });
});
