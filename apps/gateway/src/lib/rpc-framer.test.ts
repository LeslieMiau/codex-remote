import { describe, expect, it } from "vitest";

import {
  ContentLengthFramer,
  JsonLineFramer,
  encodeContentLengthMessage,
  encodeJsonLineMessage
} from "./rpc-framer";

describe("rpc-framer", () => {
  it("decodes fragmented content-length messages", () => {
    const framer = new ContentLengthFramer();
    const encoded = encodeContentLengthMessage('{"ok":true}');

    expect(framer.push(encoded.slice(0, 8))).toEqual([]);
    expect(framer.push(encoded.slice(8, 20))).toEqual([]);
    expect(framer.push(encoded.slice(20))).toEqual(['{"ok":true}']);
  });

  it("throws when the content-length header is missing", () => {
    const framer = new ContentLengthFramer();

    expect(() => framer.push("Content-Type: application/json\r\n\r\n{}")).toThrow(
      "Missing Content-Length header"
    );
  });

  it("decodes json lines while ignoring blank lines", () => {
    const framer = new JsonLineFramer();
    const payload = `${encodeJsonLineMessage('{"first":1}')}\n${encodeJsonLineMessage('{"second":2}')}`;

    expect(framer.push(payload)).toEqual(['{"first":1}', '{"second":2}']);
  });
});
