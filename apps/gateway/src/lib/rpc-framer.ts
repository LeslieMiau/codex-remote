interface PendingFrame {
  contentLength: number | null;
}

export class ContentLengthFramer {
  private buffer = "";
  private pending: PendingFrame = { contentLength: null };

  push(chunk: string | Buffer): string[] {
    this.buffer += chunk.toString("utf8");
    const messages: string[] = [];

    while (true) {
      if (this.pending.contentLength === null) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");

        if (headerEnd === -1) {
          break;
        }

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);

        if (!match) {
          throw new Error("Missing Content-Length header");
        }

        this.pending.contentLength = Number.parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.pending.contentLength === null) {
        break;
      }

      if (Buffer.byteLength(this.buffer, "utf8") < this.pending.contentLength) {
        break;
      }

      const payloadBuffer = Buffer.from(this.buffer, "utf8");
      const payload = payloadBuffer.subarray(0, this.pending.contentLength).toString("utf8");
      const remainder = payloadBuffer.subarray(this.pending.contentLength).toString("utf8");
      messages.push(payload);
      this.buffer = remainder;
      this.pending = { contentLength: null };
    }

    return messages;
  }
}

export function encodeContentLengthMessage(payload: string): string {
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
}

export class JsonLineFramer {
  private buffer = "";

  push(chunk: string | Buffer): string[] {
    this.buffer += chunk.toString("utf8");
    const messages: string[] = [];

    while (true) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) {
        break;
      }

      const line = this.buffer.slice(0, lineEnd).trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (line) {
        messages.push(line);
      }
    }

    return messages;
  }
}

export function encodeJsonLineMessage(payload: string): string {
  return `${payload}\n`;
}
