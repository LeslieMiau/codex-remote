import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const logPath = process.argv[2] ?? null;

let buffer = "";
let remoteThreadId = null;
let remoteTurnId = null;
let currentCwd = process.cwd();
let turnCounter = 0;
const pendingInterrupts = new Map();

function log(message) {
  if (!logPath) {
    return;
  }
  appendFileSync(logPath, `${message}\n`, "utf8");
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  write({
    id,
    result
  });
}

function respondError(id, code, message) {
  write({
    id,
    error: {
      code,
      message
    }
  });
}

function notify(method, params) {
  write({
    method,
    params
  });
}

function readPrompt(params) {
  const input = Array.isArray(params?.input) ? params.input : [];
  const firstText = input.find((item) => item?.type === "text" && typeof item.text === "string");
  return typeof firstText?.text === "string" ? firstText.text : "";
}

function scheduleExit() {
  setTimeout(() => {
    process.exit(0);
  }, 40);
}

async function request(method, params) {
  return await new Promise((resolve, reject) => {
    const id = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const onLine = (message) => {
      if (message?.id !== id) {
        return false;
      }

      if (message.error) {
        reject(new Error(String(message.error.message ?? method)));
      } else {
        resolve(message.result ?? {});
      }
      return true;
    };

    pendingInterrupts.set(id, onLine);
    write({
      id,
      method,
      params
    });
  });
}

function completeTurn(status, extra = {}) {
  notify("turn/completed", {
    turn: {
      id: remoteTurnId,
      status,
      ...extra
    }
  });
  scheduleExit();
}

async function playFixtureTurn(promptText, turnId) {
  notify("thread/status/changed", {
    status: {
      type: "active",
      activeFlags: ["running"]
    }
  });

  notify("item/started", {
    item: {
      type: "agentMessage"
    }
  });
  notify("item/agentMessage/delta", {
    delta: "Working on it"
  });

  if (/\[fixture:duplicate-assistant-delta\]/i.test(promptText)) {
    notify("item/agentMessage/delta", {
      delta: "Working on it"
    });
  }

  if (/\[fixture:approval\]/i.test(promptText)) {
    const approvalResponse = await request("item/commandExecution/requestApproval", {
      threadId: remoteThreadId,
      turnId,
      itemId: `cmd-${turnCounter}`,
      command: "pnpm test",
      cwd: currentCwd,
      reason: "Need to run the test suite."
    });
    log(`approval:${String(approvalResponse?.decision ?? "unknown")}`);
  }

  if (/\[fixture:user-input\]/i.test(promptText)) {
    const inputResponse = await request("item/tool/requestUserInput", {
      threadId: remoteThreadId,
      turnId,
      itemId: `input-${turnCounter}`,
      questions: [
        {
          id: "answer",
          question: "Provide the confirmation text."
        }
      ]
    });
    log(`user-input:${JSON.stringify(inputResponse)}`);
  }

  notify("item/completed", {
    item: {
      type: "commandExecution",
      command: "pnpm test",
      exitCode: 0,
      aggregatedOutput: "test suite passed",
      durationMs: 25
    }
  });

  const fileName = `real-${turnCounter}.txt`;
  const relativePath = path.join("notes", fileName);
  const fileContent = `hello-${turnCounter}\n`;
  const patchDecision = await request("item/fileChange/requestApproval", {
    threadId: remoteThreadId,
    turnId,
    itemId: `file-change-${turnCounter}`,
    reason: "Review pending file changes."
  });
  log(`patch:${String(patchDecision?.decision ?? "unknown")}`);

  if (patchDecision?.decision === "accept" || patchDecision?.decision === "acceptForSession") {
    mkdirSync(path.join(currentCwd, "notes"), { recursive: true });
    writeFileSync(path.join(currentCwd, relativePath), fileContent, "utf8");
    notify("item/completed", {
      item: {
        type: "fileChange",
        id: `file-change-${turnCounter}`,
        status: "accepted",
        changes: {
          [relativePath]: {
            type: "add",
            content: fileContent
          }
        }
      }
    });
  } else {
    notify("item/completed", {
      item: {
        type: "fileChange",
        id: `file-change-${turnCounter}`,
        status: "declined",
        changes: {
          [relativePath]: {
            type: "add",
            content: fileContent
          }
        }
      }
    });
  }

  notify("item/completed", {
    item: {
      type: "agentMessage",
      text: `Finished turn ${turnCounter}.`,
      phase: "final_answer"
    }
  });
  completeTurn("completed");
}

async function handleRequest(message) {
  log(`request:${message.method}`);

  if (message.method === "initialize") {
    respond(message.id, {});
    return;
  }

  if (message.method === "initialized") {
    return;
  }

  if (message.method === "thread/start") {
    currentCwd = typeof message.params?.cwd === "string" ? message.params.cwd : currentCwd;
    remoteThreadId = "remote-thread-1";
    respond(message.id, {
      thread: {
        id: remoteThreadId
      }
    });
    notify("thread/started", {
      thread: {
        id: remoteThreadId
      }
    });
    return;
  }

  if (message.method === "thread/resume") {
    if (message.params?.threadId !== "remote-thread-1") {
      respondError(message.id, -32000, "no rollout found for thread id");
      return;
    }

    remoteThreadId = "remote-thread-1";
    respond(message.id, {
      thread: {
        id: remoteThreadId
      }
    });
    return;
  }

  if (message.method === "turn/start") {
    turnCounter += 1;
    currentCwd = typeof message.params?.cwd === "string" ? message.params.cwd : currentCwd;
    remoteTurnId = `remote-turn-${turnCounter}`;
    const promptText = readPrompt(message.params);

    respond(message.id, {
      turn: {
        id: remoteTurnId
      }
    });
    notify("turn/started", {
      turn: {
        id: remoteTurnId
      }
    });

    if (/\[fixture:interrupt\]/i.test(promptText)) {
      return;
    }

    void playFixtureTurn(promptText, remoteTurnId);
    return;
  }

  if (message.method === "turn/interrupt") {
    respond(message.id, {
      interrupted: true
    });
    completeTurn("interrupted", {
      error: {
        message: "Interrupted by request."
      }
    });
    return;
  }

  respond(message.id, {});
}

function handleResponse(message) {
  const resolver = pendingInterrupts.get(message.id);
  if (!resolver) {
    return;
  }
  const handled = resolver(message);
  if (handled) {
    pendingInterrupts.delete(message.id);
  }
}

function handleMessage(message) {
  if (typeof message?.method === "string") {
    void handleRequest(message);
    return;
  }

  if (typeof message?.id !== "undefined") {
    handleResponse(message);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;

  while (true) {
    const lineEnd = buffer.indexOf("\n");
    if (lineEnd === -1) {
      break;
    }

    const raw = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (!raw) {
      continue;
    }

    handleMessage(JSON.parse(raw));
  }
});
