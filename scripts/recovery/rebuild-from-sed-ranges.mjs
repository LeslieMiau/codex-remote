#!/usr/bin/env node

import fs from "node:fs";

function usage() {
  console.error(
    "Usage: node scripts/recovery/rebuild-from-sed-ranges.mjs <session.jsonl> <call_id> [call_id...]",
  );
  process.exit(1);
}

const [, , sessionPath, ...callIds] = process.argv;

if (!sessionPath || callIds.length === 0) {
  usage();
}

const raw = fs.readFileSync(sessionPath, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
const wanted = new Set(callIds);
const entries = new Map();
const NOISE_LINES = new Set([
  "/opt/homebrew/Library/Homebrew/cmd/shellenv.sh: line 18: /bin/ps: Operation not permitted",
]);
const MAX_ALIGNMENT_SHIFT = 200;

function parseSegments(command) {
  const parts = command
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
  const segments = [];

  for (const part of parts) {
    let match = part.match(/^sed -n '(\d+),(\d+)p' (.+)$/);
    if (match) {
      segments.push({
        start: Number(match[1]),
        end: Number(match[2]),
        path: match[3],
        numbered: false,
      });
      continue;
    }

    match = part.match(/^nl -ba (.+) \| sed -n '(\d+),(\d+)p'$/);
    if (match) {
      segments.push({
        start: Number(match[2]),
        end: Number(match[3]),
        path: match[1],
        numbered: true,
      });
      continue;
    }

    return null;
  }

  return segments;
}

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  if (entry.type !== "response_item") {
    continue;
  }

  const payload = entry.payload;
  if (!payload || typeof payload !== "object" || !wanted.has(payload.call_id)) {
    continue;
  }

  let item = entries.get(payload.call_id);
  if (!item) {
    item = { callId: payload.call_id, command: null, output: null };
    entries.set(payload.call_id, item);
  }

  if (payload.type === "function_call") {
    try {
      const args = JSON.parse(payload.arguments ?? "{}");
      item.command = String(args.cmd ?? "");
    } catch {
      item.command = payload.arguments ?? "";
    }
  } else if (payload.type === "function_call_output") {
    item.output = String(payload.output ?? "");
  }
}

const recovered = new Map();
let inferredPath = null;
let highestRecoveredLine = 0;

function canMerge(bodyLines, start, shift) {
  let overlapCount = 0;
  for (let index = 0; index < bodyLines.length; index += 1) {
    const lineNumber = start + shift + index;
    const existing = recovered.get(lineNumber);
    if (existing === undefined) {
      continue;
    }
    if (existing !== bodyLines[index]) {
      return false;
    }
    overlapCount += 1;
  }

  if (recovered.size === 0) {
    return shift === 0;
  }

  if (overlapCount > 0) {
    return true;
  }

  return start + shift > highestRecoveredLine;
}

function mergePlainSegment(bodyLines, start, path) {
  let chosenShift = null;
  for (
    let shift = 0;
    shift <= Math.min(MAX_ALIGNMENT_SHIFT, bodyLines.length);
    shift += 1
  ) {
    if (canMerge(bodyLines, start, shift)) {
      chosenShift = shift;
      break;
    }
  }

  if (chosenShift === null) {
    console.error(`Unable to align segment starting at ${start} for ${path}`);
    process.exit(6);
  }

  for (let index = 0; index < bodyLines.length; index += 1) {
    const lineNumber = start + chosenShift + index;
    recovered.set(lineNumber, bodyLines[index]);
    if (lineNumber > highestRecoveredLine) {
      highestRecoveredLine = lineNumber;
    }
  }
}

function mergeNumberedSegment(bodyLines, path) {
  for (const rawLine of bodyLines) {
    const match = rawLine.match(/^\s*(\d+)\t(.*)$/);
    if (!match) {
      console.error(`Unable to parse numbered line for ${path}: ${rawLine}`);
      process.exit(6);
    }

    const lineNumber = Number(match[1]);
    const line = match[2];
    const existing = recovered.get(lineNumber);
    if (existing !== undefined && existing !== line) {
      console.error(`Conflicting numbered line ${lineNumber} for ${path}`);
      process.exit(6);
    }

    recovered.set(lineNumber, line);
    if (lineNumber > highestRecoveredLine) {
      highestRecoveredLine = lineNumber;
    }
  }
}

for (const callId of callIds) {
  const item = entries.get(callId);
  if (!item?.command || !item.output) {
    console.error(`Missing command/output pair for ${callId}`);
    process.exit(2);
  }

  const segments = parseSegments(item.command);
  if (!segments || segments.length === 0) {
    console.error(`Unsupported sed command for ${callId}: ${item.command}`);
    process.exit(3);
  }

  for (const segment of segments) {
    if (inferredPath === null) {
      inferredPath = segment.path;
    } else if (inferredPath !== segment.path) {
      console.error(`Mixed file paths detected: ${inferredPath} vs ${segment.path}`);
      process.exit(4);
    }
  }

  const marker = "Output:\n";
  const markerIndex = item.output.indexOf(marker);
  if (markerIndex === -1) {
    console.error(`Missing output marker for ${callId}`);
    process.exit(5);
  }

  const body = item.output.slice(markerIndex + marker.length);
  const bodyLines = body
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !NOISE_LINES.has(line));
  if (bodyLines.at(-1) === "") {
    bodyLines.pop();
  }

  let cursor = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const expectedLength = segment.end - segment.start + 1;
    const isLast = index === segments.length - 1;
    const segmentLines = bodyLines.slice(cursor, cursor + expectedLength);

    if (segmentLines.length === 0) {
      console.error(`Missing output lines for ${segment.path} in ${callId}`);
      process.exit(5);
    }

    if (!isLast && segmentLines.length !== expectedLength) {
      console.error(
        `Unexpected output length for ${segment.path} in ${callId}: expected ${expectedLength}, got ${segmentLines.length}`,
      );
      process.exit(5);
    }

    if (segment.numbered) {
      mergeNumberedSegment(segmentLines, segment.path);
    } else {
      mergePlainSegment(segmentLines, segment.start, segment.path);
    }

    cursor += segmentLines.length;
  }
}

const sortedLines = [...recovered.keys()].sort((left, right) => left - right);
if (sortedLines.length === 0) {
  console.error("No lines recovered.");
  process.exit(7);
}

let previous = sortedLines[0] - 1;
if (previous !== 0) {
  console.error(`Recovered content does not start at line 1 for ${inferredPath}`);
  process.exit(8);
}

const output = [];
for (const lineNumber of sortedLines) {
  if (lineNumber !== previous + 1) {
    console.error(
      `Gap detected in recovered content for ${inferredPath}: missing line ${
        previous + 1
      } before ${lineNumber}`,
    );
    process.exit(9);
  }
  output.push(recovered.get(lineNumber));
  previous = lineNumber;
}

process.stdout.write(output.join("\n"));
if (output.length > 0) {
  process.stdout.write("\n");
}
