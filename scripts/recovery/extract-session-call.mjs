#!/usr/bin/env node

import fs from "node:fs";

function usage() {
  console.error(
    "Usage: node scripts/recovery/extract-session-call.mjs <session.jsonl> <call_id> [call_id...]",
  );
  process.exit(1);
}

const [, , sessionPath, ...callIds] = process.argv;

if (!sessionPath || callIds.length === 0) {
  usage();
}

const wanted = new Set(callIds);
const raw = fs.readFileSync(sessionPath, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);

let found = 0;

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
  if (!payload || typeof payload !== "object") {
    continue;
  }

  const callId = payload.call_id;
  if (!wanted.has(callId)) {
    continue;
  }

  found += 1;
  console.log(`=== ${callId} :: ${payload.type} ===`);

  if (payload.type === "function_call") {
    console.log(`name: ${payload.name}`);
    console.log("arguments:");
    console.log(payload.arguments ?? "");
  } else if (payload.type === "function_call_output") {
    console.log(payload.output ?? "");
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  console.log("");
}

if (found === 0) {
  console.error("No matching call ids found.");
  process.exit(2);
}
