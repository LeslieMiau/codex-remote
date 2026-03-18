# codex-remote Recovery Handoff

## 目的

这份文档是给新线程继续补代码用的，重点是：

- 说明当前主树已经恢复到什么程度
- 标出哪些文件是高置信恢复，哪些还是最小重建
- 给出继续补代码时最可信的本地来源
- 避免下一线程重复踩 `/tmp` 里那些重复拼接和错位片段

## 当前状态

当前仓库已经不是“全空壳”了，gateway 和 protocol 的主干已经恢复出一条可继续开发的骨架。

保守估计：

- 主树真实落盘恢复度：约 `80%`
- 如果把 `_recovery` 里的高置信候选一起算上：约 `90%`

这个数字的含义是：

- `packages/protocol` 的核心协议已经回来了
- `apps/gateway` 的持久层、command bridge、settings bridge、主 server 骨架已经回来了
- 但 runtime/adapter 的深层行为和测试还没完全补实

## 已恢复到主树的关键文件

### Protocol

- [packages/protocol/src/common.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/common.ts)
- [packages/protocol/src/ids.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/ids.ts)
- [packages/protocol/src/entities.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/entities.ts)
- [packages/protocol/src/events.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/events.ts)
- [packages/protocol/src/commands.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/commands.ts)
- [packages/protocol/src/api.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/api.ts)
- [packages/protocol/src/codex.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/codex.ts)

这些文件现在已经能作为 gateway/mobile 的契约锚点使用，尤其是：

- `waiting_input`
- `system_error`
- `pending_native_requests`
- `native_status_type`
- `native_active_flags`
- `native_token_usage`
- `native_requests`
- `input_items`
- `CodexLiveState`

### Gateway 已恢复/重建的主干

- [apps/gateway/src/lib/sqlite.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/sqlite.ts)
- [apps/gateway/src/lib/rpc-framer.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/rpc-framer.ts)
- [apps/gateway/src/lib/store.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/store.ts)
- [apps/gateway/src/lib/tailscale-auth.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/tailscale-auth.ts)
- [apps/gateway/src/runtime/codex-command-bridge.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-command-bridge.ts)
- [apps/gateway/src/runtime/codex-settings-bridge.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-settings-bridge.ts)
- [apps/gateway/src/runtime/policy-engine.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/policy-engine.ts)
- [apps/gateway/src/runtime/thread-runtime-manager.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/thread-runtime-manager.ts)
- [apps/gateway/src/adapters/codex-app-server-adapter.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/codex-app-server-adapter.ts)
- [apps/gateway/src/server.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.ts)

### 已恢复但仍需注意的文件

- [apps/gateway/src/runtime/codex-state-bridge.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-state-bridge.ts)

这个文件之前已经从本地 session 片段高置信恢复过了；这轮只补了一个真实语法问题：

- [apps/gateway/src/runtime/codex-state-bridge.ts:737](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-state-bridge.ts:737)

## 哪些文件现在还是“最小重建”，不是完整原版

这点一定要分清，不然后面很容易误判“已经恢复完了”。

### 可运行骨架，但不是完整原逻辑

- [apps/gateway/src/server.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.ts)
  - 已恢复核心 HTTP 路由
  - 还没补 WebSocket/SSE 流式通道
  - 还没有完整 attachment/upload/patch/native-request 路由

- [apps/gateway/src/runtime/thread-runtime-manager.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/thread-runtime-manager.ts)
  - 目前是最小可用版本
  - 已有 `startTurn`、dedup、queued turn 入库、基础 event publish
  - 没有完整 approval/native request/patch/app-server execution 流程

- [apps/gateway/src/adapters/codex-app-server-adapter.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/codex-app-server-adapter.ts)
  - 当前是“degraded adapter”
  - 只会明确报 `adapter_recovery_incomplete`
  - 不是原始 app-server 执行器

- [apps/gateway/src/runtime/policy-engine.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/policy-engine.ts)
  - 只补了当前 server/runtime 真正在用的最小策略
  - 不代表原始策略已完整恢复

- [apps/gateway/src/runtime/codex-command-bridge.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-command-bridge.ts)
  - 基本 RPC 桥已经回来
  - `thread/*`、`review/start`、`config/*`、`model/list` 这批方法是按 recovered 契约风格补的
  - 具体 method 名和响应 shape 仍建议对照 app-server 官方文档再收一遍

### 仍是占位文件

这些文件目前仍然是 placeholder，不要误用：

- [apps/gateway/src/adapters/mock-adapter.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/mock-adapter.ts)
- [apps/gateway/src/runtime/codex-native-thread-marker.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-native-thread-marker.ts)

对应测试也仍是 placeholder：

- [apps/gateway/src/adapters/codex-app-server-adapter.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/codex-app-server-adapter.test.ts)
- [apps/gateway/src/lib/rpc-framer.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/rpc-framer.test.ts)
- [apps/gateway/src/lib/system-proxy.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/system-proxy.test.ts)
- [apps/gateway/src/lib/tailscale-auth.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/lib/tailscale-auth.test.ts)
- [apps/gateway/src/real-app-server.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/real-app-server.test.ts)
- [apps/gateway/src/runtime/codex-native-thread-marker.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-native-thread-marker.test.ts)
- [packages/protocol/src/events.test.ts](/Users/miau/Documents/codex-remote/packages/protocol/src/events.test.ts)

## 还没落主树、但非常值得继续利用的恢复候选

这些是下一线程最该优先用的本地材料。

### Recovery 目录

目录：

- [/.claude/worktrees/_recovery](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery)

关键文件：

- [diff-recovery-index-20260315.md](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/diff-recovery-index-20260315.md)
  - 这里记录了 recovery 线索索引和来源

- [server.recovered-1-1815.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.recovered-1-1815.ts)
  - `server.ts` 的最佳 recovered 主体来源
  - 前半段非常有价值
  - 中后段有截断/错位，不能整文件直接覆盖

- [server.test.exact-1-1895.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.exact-1-1895.ts)
  - `server.test.ts` 目前最值得继续往主树推的候选

- [server.test.candidate-a.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.candidate-a.ts)
- [server.test.candidate-b.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.candidate-b.ts)
- [server.test.overlay-chain.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.overlay-chain.ts)
- [server.test.same-chain.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.same-chain.ts)
  - 用来给 `server.test.ts` 做补洞和对齐

- [shared-thread-workspace.full.tsx](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/shared-thread-workspace.full.tsx)
  - mobile-web 的高价值候选
  - 这个文件之前还没有安全写回主树

### `/tmp` 恢复输出

Antigravity 的恢复输出在：

- `/tmp/codex_recovery_output`

这个目录有帮助，但一定要谨慎：

- 前半段常常是好的
- 后面大量是重复拼接、版本漂移、截断和错位
- 不能整文件照抄

目前已验证相对有参考价值的 `/tmp` 文件：

- `/tmp/codex_recovery_output/apps/gateway/src/lib/sqlite.ts`
- `/tmp/codex_recovery_output/apps/gateway/src/lib/store.ts`
- `/tmp/codex_recovery_output/apps/gateway/src/runtime/codex-command-bridge.ts`
- `/tmp/codex_recovery_output/apps/gateway/src/runtime/codex-settings-bridge.ts`
- `/tmp/codex_recovery_output/apps/gateway/src/lib/tailscale-auth.ts`

### 其它本地来源

如果还要继续考古，优先看：

- `/Users/miau/.codex/sessions/...`
- 本地 `logs_1.sqlite`

之前 Antigravity 就是从本地 `logs_1.sqlite` 和 session 日志里抽出来的。

## 当前 server.ts 已具备的能力

[apps/gateway/src/server.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.ts) 这版已经有：

- `/health`
- `/config`
- `/overview`
- `/queue`
- `/capabilities`
- `/settings/shared` `GET/PATCH`
- `/threads/:threadId/timeline`
- `/threads/:threadId/messages/latest`
- `/threads/:threadId/messages`
- `/metrics`
- `/threads/shared`
- `/threads/:threadId/runs`
- `/runs/:runId/follow-ups`
- `/runs/:runId/interrupt`
- `/threads/:threadId/name`
- `/threads/:threadId/archive`
- `/threads/:threadId/unarchive`
- `/threads/:threadId/compact`
- `/threads/:threadId/fork`
- `/threads/:threadId/rollback`
- `/threads/:threadId/reviews`

但当前还没有：

- WebSocket 推流
- SSE follow stream
- upload/image attachment 路由
- approval/native-request/patch action 路由
- 真实 app-server 执行闭环

## 建议下一线程的优先顺序

### 1. 先把 gateway 运行时补实

优先级最高：

- [apps/gateway/src/runtime/thread-runtime-manager.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/thread-runtime-manager.ts)
- [apps/gateway/src/adapters/codex-app-server-adapter.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/codex-app-server-adapter.ts)

目标：

- 把 `startTurn` 从“入库 + publish queued event”推进到“真正驱动 adapter.runTurn”
- 恢复 approval/native request/patch/live state/event append 的完整闭环
- 把 `codex-app-server-adapter.ts` 从 degraded stub 恢复成真实执行器

### 2. 再补 server.ts 缺口

优先补：

- WebSocket
- SSE
- attachment/upload
- approval routes
- patch routes
- native request routes

建议方法：

- 以 [server.recovered-1-1815.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.recovered-1-1815.ts) 为主
- 用现有 `protocol` 和 app-server 官方契约做收口
- 不要直接拿大块 `/tmp` 重复内容粘贴

### 3. 再恢复 server.test.ts

目标文件：

- [apps/gateway/src/server.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.test.ts)

最推荐的起点：

- [server.test.exact-1-1895.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.exact-1-1895.ts)

策略：

- 先把“高价值主流程测试”搬回主树
- 再按 `candidate-a/b` 和 `overlay-chain` 补剩余区块

### 4. 最后回到 mobile 补 UI 文件

尤其是：

- [shared-thread-workspace.full.tsx](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/shared-thread-workspace.full.tsx)

## 已知问题和注意事项

### 1. 现在不能把“能打开”误当成“完全恢复”

当前很多关键文件是：

- 一部分来自 recovered 原始片段
- 一部分是按协议和调用面重建

所以一定要分“高置信恢复”和“最小重写”。

### 2. `/tmp` 内容不是天然可信

`/tmp/codex_recovery_output` 是 Antigravity 的结果，里面有不少：

- 重复 import 块
- 多版本拼接
- 尾部截断
- 中间跳段

经验规则：

- 第一段通常最干净
- 出现第二个 `import` 基本就说明开始重复了

### 3. 目前 TS 检查还不能作为强验证

这轮尝试过轻量 `tsc`，但当前环境缺：

- `@types/node`
- `fastify`
- `better-sqlite3`
- `@codex-remote/protocol` 的正常 workspace 解析

所以当前 `tsc` 输出里大多数是环境缺件，不是纯语法错误。

### 4. 一个已经修过的真实错误

这处已经修了，不要重复排查：

- [apps/gateway/src/runtime/codex-state-bridge.ts:737](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/codex-state-bridge.ts:737)

## 如果新线程要快速上手，建议这样开工

1. 先读 [HANDOFF.md](/Users/miau/Documents/codex-remote/HANDOFF.md)
2. 再读 [server.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.ts)
3. 再对照 [server.recovered-1-1815.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.recovered-1-1815.ts)
4. 然后补 [thread-runtime-manager.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/runtime/thread-runtime-manager.ts)
5. 再补 [codex-app-server-adapter.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/adapters/codex-app-server-adapter.ts)
6. 最后开始把 [server.test.exact-1-1895.ts](/Users/miau/Documents/codex-remote/.claude/worktrees/_recovery/reconstructed/server.test.exact-1-1895.ts) 推回 [server.test.ts](/Users/miau/Documents/codex-remote/apps/gateway/src/server.test.ts)

## 结论

当前最正确的策略已经不是“继续全量考古”，而是：

- 对高置信 recovered 文件继续利用
- 对明显缺口用 app-server 契约做局部重写
- 先补运行时和测试，再追求字节级还原

换句话说，下一线程已经可以把重点从“找回文件”转到“把项目重新跑起来”。
