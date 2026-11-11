import { afterEach, describe, expect, it, vi } from "vitest";

const proxy = vi.fn();
vi.mock("./google-connectors", () => ({
  GoogleConnectors: class { proxy = proxy; },
  googleAccessToken: vi.fn(async () => "token-1"),
}));

afterEach(() => {
  proxy.mockReset();
  vi.unstubAllGlobals();
});

describe("Drive photo thumbnails", () => {
  it("asks Drive's image host for the size wanted", async () => {
    const { sizedThumbnailUrl } = await import("./google-drive-storage");
    expect(sizedThumbnailUrl("https://lh3.googleusercontent.com/drive-storage/AbC=s220", 640))
      .toBe("https://lh3.googleusercontent.com/drive-storage/AbC=s640");
    expect(sizedThumbnailUrl("https://lh3.googleusercontent.com/drive-storage/AbC", 640))
      .toBe("https://lh3.googleusercontent.com/drive-storage/AbC=s640");
  });

  it("never sends the Google token anywhere but Google's image host", async () => {
    const { sizedThumbnailUrl } = await import("./google-drive-storage");
    expect(sizedThumbnailUrl("https://evil.example.com/x=s220", 640)).toBeNull();
    expect(sizedThumbnailUrl("http://lh3.googleusercontent.com/x=s220", 640)).toBeNull();
    expect(sizedThumbnailUrl("not a url", 640)).toBeNull();
  });

  it("returns the resized image, or null so the original is sent instead", async () => {
    const { downloadDriveThumbnail } = await import("./google-drive-storage");
    const fetchMock = vi.fn(async () => new Response("jpeg-bytes", { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);

    proxy.mockResolvedValueOnce(new Response(JSON.stringify({ thumbnailLink: "https://lh3.googleusercontent.com/d/AbC=s220" })));
    const thumbnail = await downloadDriveThumbnail("file-1", 640);
    expect(await thumbnail?.text()).toBe("jpeg-bytes");
    expect(fetchMock).toHaveBeenCalledWith("https://lh3.googleusercontent.com/d/AbC=s640", { headers: { authorization: "Bearer token-1" } });

    proxy.mockResolvedValueOnce(new Response(JSON.stringify({})));
    expect(await downloadDriveThumbnail("file-without-thumbnail", 640)).toBeNull();

    proxy.mockResolvedValueOnce(new Response(JSON.stringify({ thumbnailLink: "https://lh3.googleusercontent.com/d/AbC=s220" })));
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect(await downloadDriveThumbnail("file-1", 640)).toBeNull();
  });
});
