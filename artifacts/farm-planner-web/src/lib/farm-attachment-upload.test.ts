import { afterEach, describe, expect, it, vi } from 'vitest';
import { shrinkPhoto, uploadFarmAttachment } from './farm-attachment-upload';

const photo = (size: number, type = 'image/jpeg', name = 'IMG_2041.jpg') =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1_700_000_000_000 });

function fakeCanvas(outputBytes: number) {
  const drawImage = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob([new Uint8Array(outputBytes)], { type })) };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as typeof document.createElement);
  return { canvas, drawImage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shrinkPhoto', () => {
  it('turns a large camera photo into a 2048 px JPEG', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const { canvas, drawImage } = fakeCanvas(420_000);

    const shrunk = await shrinkPhoto(photo(5_000_000));

    expect([canvas.width, canvas.height]).toEqual([2048, 1536]);
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(shrunk.size).toBe(420_000);
    expect(shrunk.type).toBe('image/jpeg');
    expect(shrunk.name).toBe('IMG_2041.jpg');
  });

  it('keeps the original when it is small, not a photo, or cannot be read', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('HEIC not supported'); }));
    const small = photo(200_000);
    const pdf = photo(5_000_000, 'application/pdf', 'spray-label.pdf');
    const heic = photo(5_000_000, 'image/heic', 'IMG_1.heic');

    expect(await shrinkPhoto(small)).toBe(small);
    expect(await shrinkPhoto(pdf)).toBe(pdf);
    expect(await shrinkPhoto(heic)).toBe(heic);
  });

  it('keeps the original when the copy would not be smaller', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 900, close: vi.fn() })));
    fakeCanvas(900_000);
    const original = photo(800_000);
    expect(await shrinkPhoto(original)).toBe(original);
  });
});

describe('uploadFarmAttachment', () => {
  it('sends the shrunk photo with its new size and name', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    fakeCanvas(420_000);
    const sent: Array<{ body: unknown }> = [];
    class FakeRequest {
      upload = { onprogress: null };
      status = 200;
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send(body: unknown) { sent.push({ body }); this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const requestUpload = { mutateAsync: vi.fn(async () => ({ uploadUrl: '/api/attachments/att-1/upload', attachment: { id: 'att-1' } })) };
    const completeUpload = { mutateAsync: vi.fn(async () => ({ id: 'att-1' })) };

    await uploadFarmAttachment({ taskId: 'task-1', file: photo(5_000_000, 'image/jpeg', 'IMG_2041.JPG'), requestUpload: requestUpload as never, completeUpload: completeUpload as never });

    expect(requestUpload.mutateAsync).toHaveBeenCalledWith({ data: { taskId: 'task-1', name: 'IMG_2041.jpg', size: 420_000, contentType: 'image/jpeg' } });
    expect((sent[0].body as File).size).toBe(420_000);
    expect(completeUpload.mutateAsync).toHaveBeenCalledWith({ attachmentId: 'att-1' });
  });
});
