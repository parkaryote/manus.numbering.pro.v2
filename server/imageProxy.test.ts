import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import imageProxyRouter, { isBlockedAddress, isBlockedHost, parseTargetUrl } from "./imageProxy";

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

describe("image proxy SSRF guard", () => {
  it("allows ordinary public image urls", () => {
    expect(parseTargetUrl("https://example.com/a.png")?.hostname).toBe("example.com");
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks loopback, private and link-local IPv4", () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("blocks numeric IPv4 spellings that URL normalizes", () => {
    expect(parseTargetUrl("http://2130706433/")).toBeNull();
    expect(parseTargetUrl("http://0x7f.1/")).toBeNull();
  });

  it("blocks bracketed IPv6 loopback, ULA and IPv4-mapped addresses", () => {
    expect(parseTargetUrl("http://[::1]/")).toBeNull();
    expect(parseTargetUrl("http://[fd00::1]/")).toBeNull();
    expect(parseTargetUrl("http://[fe80::1]/")).toBeNull();
    expect(parseTargetUrl("http://[::ffff:127.0.0.1]/")).toBeNull();
    expect(parseTargetUrl("http://[::ffff:a9fe:a9fe]/")).toBeNull();
  });

  it("blocks internal hostnames, credentials and non-http schemes", () => {
    expect(parseTargetUrl("http://localhost:3000/x")).toBeNull();
    expect(parseTargetUrl("http://db.internal/x")).toBeNull();
    expect(parseTargetUrl("https://user:pw@example.com/a.png")).toBeNull();
    expect(parseTargetUrl("file:///etc/passwd")).toBeNull();
    expect(parseTargetUrl(undefined)).toBeNull();
  });
});

describe("image proxy route", () => {
  const realFetch = globalThis.fetch;
  let server: Server;
  let base = "";
  let upstream: (url: string) => Response;

  beforeAll(async () => {
    const app = express();
    app.use("/p", imageProxyRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p?url=`;
    vi.stubGlobal("fetch", (input: any, init?: any) => {
      const url = String(input);
      return url.startsWith("http://127.0.0.1:") ? realFetch(input, init) : Promise.resolve(upstream(url));
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    server.close();
  });

  const call = (target: string) => realFetch(base + encodeURIComponent(target));

  it("returns the image with hardening headers", async () => {
    upstream = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    const response = await call("https://cdn.example.com/a.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect((await response.arrayBuffer()).byteLength).toBe(3);
  });

  it("follows a public redirect but refuses a redirect into the internal network", async () => {
    upstream = (url) =>
      url.includes("/start")
        ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/final.png" } })
        : new Response(new Uint8Array([9]), { headers: { "content-type": "image/jpeg" } });
    expect((await call("https://cdn.example.com/start")).status).toBe(200);

    upstream = () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    expect((await call("https://cdn.example.com/start")).status).toBe(400);
  });

  it("rejects non-image content and oversized bodies", async () => {
    upstream = () => new Response("<html></html>", { headers: { "content-type": "text/html" } });
    expect((await call("https://cdn.example.com/a.png")).status).toBe(415);

    upstream = () =>
      new Response(new Uint8Array([1]), { headers: { "content-type": "image/png", "content-length": String(50 * 1024 * 1024) } });
    expect((await call("https://cdn.example.com/a.png")).status).toBe(413);
  });
});
