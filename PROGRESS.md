## Harness initialized — 2026-03-28
- 项目类型：Node.js / pnpm monorepo（gateway + mobile-web + shared packages）
- Features planned：12（只覆盖剩余的 Phase 5 前端架构拆分）
- init.sh generated：yes
- .gitignore updated：skipped（已包含 PLAN.json / PROGRESS.md）
- Existing work detected：Phase 1 与 Phase 2 已在 git 历史中提交；Phase 3（gateway repository/projection）和 Phase 4（patch/worktree correctness）已在当前工作区实现并验证，但尚未提交。
- Key decisions：不重做已完成的 gateway/core 架构阶段；Phase 5 从 `shared-thread-workspace-refreshed.tsx` 的 screen-model 拆分开始，优先抽取低风险、高复用的派生状态逻辑，再逐步拆控制器与展示层。

## Session — 2026-03-28 18:12
- 完成 Feature #1：把 `shared-thread-workspace-refreshed.tsx` 里的派生 UI 状态抽成 `shared-thread-workspace-screen-model.ts`，包括 composer gating、pending request 选择、顶部状态条、标题/副标题、附件能力与 degraded fallback 判断。
- 新增 `shared-thread-workspace-screen-model.test.ts`，覆盖批准阻塞文案、degraded fallback 标记和 native request 问题解析。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：在持久会话里启动 mobile-web 后，`HEAD /` 返回 `307`，`HEAD /projects` 返回 `200`，`HEAD /threads/thread_demo` 返回 `200`。
- 剩余建议：继续做 Feature #2，把 approval/native request 的 sheet 控制器从 refreshed workspace 里拆出去。

## Session — 2026-03-28 18:25
- 完成 Feature #2：新增 `shared-thread-request-sheet-controller.ts`，把 approval/native request sheet 的自动打开、手动关闭、dismiss 记忆和答案默认值逻辑从 `shared-thread-workspace-refreshed.tsx` 中抽离。
- 新增 `shared-thread-request-sheet-controller.test.ts`，覆盖新请求自动弹层、关闭后同一请求不重开、请求变化后重新打开、请求消失后状态清空。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：持久会话下 `HEAD /projects` 返回 `200`，`HEAD /threads/thread_demo` 返回 `200`。
- 下一步：继续做 Feature #3，把 details 面板里的 thread actions 可用性和展示文案抽成 view-model。

## Session — 2026-03-28 18:28
- 完成 Feature #3：新增 `shared-thread-details-view-model.ts`，把 details 面板里的模型展示、归档/压缩/分支/review/回滚按钮可用性、快捷操作按钮状态和 sync pending 提示从 `shared-thread-workspace-refreshed.tsx` 里抽离。
- 新增 `shared-thread-details-view-model.test.ts`，覆盖 sync pending 下的动作禁用和已归档线程的文案切换。
- 定向验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`。
- 下一步：继续做 Feature #4，把附件与技能选择控制器从 refreshed workspace 中独立出来。

## Session — 2026-03-28 18:46
- 完成 Feature #4：新增 `shared-thread-attachment-controller.ts`，把 refreshed workspace 里的附件面板、技能选择、图片上传生命周期和已选附件状态从大组件中抽离。
- 新增 `shared-thread-attachment-controller.test.ts`，覆盖技能勾选切换、图片上传从 uploading 到 ready/failed 的状态流转，以及图片移除后的返回值。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：直接启动 `./scripts/start-gateway.sh` 与 `./scripts/start-mobile-web.sh` 后，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`，`HEAD /projects` 返回 `200`，`HEAD /threads/thread_demo` 返回 `200`。
- 下一步：继续做 Feature #5，把最近聊天切换器的 overview 拉取、过滤排序和导航恢复逻辑从 refreshed workspace 里拆出去。

## Session — 2026-03-28 18:47
- 完成 Feature #5：新增 `shared-thread-switcher-controller.ts`，把最近聊天切换器的列表加载、错误恢复、过滤排序、返回列表路由恢复和线程切换动作从 `shared-thread-workspace-refreshed.tsx` 中抽离。
- 新增 `shared-thread-switcher-controller.test.ts`，覆盖加载中清错、正常列表的过滤与更新时间排序、空列表结果和加载失败路径。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：交互式启动 gateway/mobile-web 后，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`，`HEAD /projects` 返回 `200`，`HEAD /threads/thread_demo` 返回 `200`。
- 下一步：继续做 Feature #6，把 degraded、offline、loading 等空状态文案收敛成可复用展示层。

## Session — 2026-03-28 18:51
- 完成 Feature #6：新增 `shared-empty-state-presentation.ts`，把 overview、queue、refreshed workspace 和 legacy workspace 中分叉的 degraded/offline/loading 空状态文案统一到共享 helper。
- 新增 `shared-empty-state-presentation.test.ts`，覆盖退化聊天空消息、overview 搜索空态、queue 退化空态以及最近聊天 sheet 的共享文案。
- 已接入 `overview-screen.tsx`、`queue-screen.tsx`、`shared-thread-workspace-refreshed.tsx` 和 `shared-thread-workspace.tsx`，减少两套 workspace 和入口页之间的文案漂移。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：保持交互式 gateway/mobile-web 服务在线时，`HEAD /projects`、`HEAD /queue`、`HEAD /threads/thread_demo` 均返回 `200`，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`。
- 下一步：继续做 Feature #7，把已抽出的 screen-model 或展示 helper 进一步复用到 legacy `shared-thread-workspace.tsx`，继续减少双实现。

## Session — 2026-03-28 18:55
- 完成 Feature #7：legacy `shared-thread-workspace.tsx` 开始复用 `shared-thread-workspace-screen-model.ts`，把 native request 问题解析、composer gating、pending lead item、返回列表标签、附件能力、模型展示和 fallback 标题等共享规则收敛到同一套纯函数。
- 同步让 legacy workspace 的空聊天文案继续复用 `shared-empty-state-presentation.ts`，避免 fallback/recovery 线程在两套页面里出现不同解释。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：保持交互式 gateway/mobile-web 服务在线时，`HEAD /projects`、`HEAD /threads/thread_demo` 均返回 `200`，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`。
- 下一步：继续做 Feature #8，整理 refreshed/legacy 两个 workspace 之间还残留的 timeline、recent chat 和状态展示 helper。

## Session — 2026-03-28 18:58
- 完成 Feature #8：legacy `shared-thread-workspace.tsx` 开始复用 `shared-thread-switcher-controller.ts`，把最近聊天切换器的加载、错误恢复、更新时间排序和返回列表路由恢复切到与 refreshed workspace 相同的 controller。
- 这一步进一步消除了两套 workspace 在 recent chats 上的副作用重复，也让 `buildRecentChatsSheetCopy`、`shared-thread-workspace-screen-model` 与 `shared-thread-switcher-controller` 三块共享边界开始真正贯通。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：`HEAD /projects`、`HEAD /threads/thread_demo` 均返回 `200`；由于共享 `CODEX_HOME` 下直接重启 gateway 会遇到 SQLite `database is locked`，额外用 `CODEX_HOME=/tmp/codex-remote-gateway-runtime` 启动独立 gateway，并确认 `GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`。
- 下一步：继续做 Feature #9，补齐 refreshed workspace 的 composer gating 与 degraded 状态回归测试。

## Session — 2026-03-28 19:01
- 完成 Feature #9：补强 `shared-thread-workspace-screen-model.test.ts`，新增 native request、pending review、图片上传失败和 live follow-up 不可用这四条 composer gating 路径断言。
- 同步补了 `chat-timeline.test.tsx` 对自定义 degraded 空消息的显式断言，确保 refreshed workspace 在 fallback 线程下不会退回默认的 “No messages yet” 文案。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：`HEAD /projects`、`HEAD /threads/thread_demo` 均返回 `200`，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`。
- 下一步：继续做 Feature #10，补齐 approval/native request sheet 的开关与确认路径回归测试。

## Session — 2026-03-28 19:04
- 完成 Feature #10：在 `shared-thread-request-sheet-controller.ts` 中新增共享的 `buildNativeUserInputResponsePayload()`，让 refreshed 和 legacy workspace 的 user_input 提交都走同一套 payload 构造逻辑。
- 同时修正 request sheet controller：不同 native request 即使题目 id 相同，也会重置回该请求自己的默认答案，不再错误继承上一条请求的手动输入。
- `shared-thread-request-sheet-controller.test.ts` 现已覆盖默认答案初始化、手动关闭后同请求不重开、新请求重开、请求消失清空、同请求保留已编辑答案、新请求重置默认值，以及 user_input payload 构造。
- 验证通过：`corepack pnpm --filter @codex-remote/mobile-web check`、`corepack pnpm --filter @codex-remote/mobile-web test`、`corepack pnpm check`、`corepack pnpm test`。
- 运行态 sanity：`HEAD /projects`、`HEAD /threads/thread_demo` 均返回 `200`，`GET /health` 返回 `{"ok":true,"adapter":"codex-app-server"}`。
- 下一步：继续做 Feature #11，尝试在当前环境里完成手机端聊天从列表到线程到详情/附件入口的真实运行态验收。

## Session — 2026-03-28 19:06
- Feature #11 运行态验收已推进到 smoke harness：`corepack pnpm --filter @codex-remote/mobile-web verify:smoke` 的 HTTP routes 与 compact HTML marker 校验通过；在 `MOBILE_WEB_SMOKE_SKIP_BROWSER=1` 下整套 smoke 通过。
- 为了完成浏览器截图 smoke，额外使用 `NPM_CONFIG_CACHE=/tmp/codex-mobile-npm-cache PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-mobile-browsers npx --yes playwright install chromium` 安装了临时 Chromium 运行时。
- 当前 blocker：带浏览器的 `verify:smoke` 仍在 Chromium 启动阶段被宿主环境拦截，报错为 `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`；这是当前 Codex desktop sandbox 的浏览器权限限制，不是 mobile-web 页面回归。
- 因此 Feature #11 暂不标记完成，但已留下可复现命令和明确阻塞证据，后续可在更宽松的宿主环境里直接重跑 browser smoke。
- 下一步：先完成 Feature #12，把 Phase 5 的前端分层边界和验收/阻塞说明写入架构文档。

## Session — 2026-03-28 19:07
- 完成 Feature #12：更新 `docs/architecture.md`，补充 mobile-web 当前的 screen-model / controller / presentation helper 分层，以及 refreshed/legacy workspace 共享边界。
- 文档明确记录了 `shared-thread-workspace-screen-model.ts`、`shared-thread-request-sheet-controller.ts`、`shared-thread-attachment-controller.ts`、`shared-thread-switcher-controller.ts`、`shared-thread-details-view-model.ts`、`shared-empty-state-presentation.ts` 的职责分工。
- 同时加入 acceptance notes：`verify-smoke` 是首选 smoke 入口；Chromium MachPort 权限错误属于当前 sandbox blocker；gateway 验证遇到 SQLite 锁时应使用隔离 `CODEX_HOME`。
- 验证基线延续上一轮：文档前一轮代码改动已通过 `corepack pnpm check`、`corepack pnpm test`，运行态入口 `HEAD /projects`、`HEAD /threads/thread_demo` 和 `GET /health` 均正常。
- 剩余未完成项：只有 Feature #11 仍受当前环境的浏览器权限限制，需要在能启动 Playwright Chromium 的宿主环境中完成最终手机端运行态验收。

## Session — 2026-03-28 20:49
- 修复本轮运行态故障：`http://127.0.0.1:3000/queue` 可访问但一直空白，根因不是页面路由损坏，而是 8787 上的 gateway 进程继承了错误的 `CODEX_HOME=/tmp/codex-remote-gateway-runtime`，导致 `/api/overview` 进入 degraded 模式并返回 `threads=0`。
- 已现场恢复服务：重启 8787 上的 gateway 后，`/api/overview` 恢复为 `thread_count=133`、`shared_state_available=true`、`codex_home=/Users/miau/.codex`；3000 上的 `/api/overview` 也返回相同结果，Codex app 线程重新可见。
- 更新 `init.sh`：启动前不再只看 `/health=200`，而会额外校验 `/api/overview.capabilities.shared_state_available` 和 `codex_home` 是否指向期望目录；若发现“健康但降级”的旧 gateway，会先杀掉 8787 监听进程再按期望 `CODEX_HOME` 重启。
- 同时修复 harness 自检误报：测试阶段改为使用临时 `CODEX_HOME` 跑 `corepack pnpm test`，避免与正在使用 `~/.codex/state_5.sqlite` 的真实 gateway 争锁导致 `database is locked`。
- 验证通过：`bash init.sh` 现已在当前环境完整通过并以 `errors: 0` 结束；`curl -sS http://127.0.0.1:8787/api/overview` 与 `curl -sS http://127.0.0.1:3000/api/overview` 均显示 `thread_count=133`、`shared_state_available=true`；`HEAD /queue` 返回 `200`。
- 说明：这次是运行环境修复，不单独标记 PLAN feature 完成；Feature #11 仍保留为未完成，因为“列表 -> 线程 -> 详情/附件入口”的浏览器态验收还需要能启动 Playwright Chromium 的宿主环境。

## Session — 2026-03-28 22:53
- 按上一轮 review 的优先级继续修复常驻启动链路：`scripts/start-gateway.sh` 不再把 `tsup --watch --onSuccess "node dist/cli.js"` 当成长期服务入口，而是改成稳定的 `build -> start`；这样启动后留下的是实际的 `node dist/cli.js` listener，而不是只剩 `tsup/esbuild` 父进程。
- `scripts/start-mobile-web.sh` 也改成显式 `clean` 后直接执行 `next dev --hostname 127.0.0.1 --port 3000`，避免通过 `pnpm run dev` 传参时落到错误的目录解析或静默漂移到别的端口。
- `init.sh` 新增 `read_web_runtime()`，现在除了首页 HTTP 状态，还会校验 `http://127.0.0.1:3000/api/overview` 是否真能返回 overview JSON、shared state 是否可用、`codex_home` 是否匹配期望目录；如果 3000 上是陈旧/降级实例，会先杀掉监听进程再拉起新的 mobile-web。
- 宿主级验证通过：`bash init.sh` 在 host context 下以 `errors: 0` 结束；单独用 PTY 会话执行 `./scripts/start-gateway.sh` 与 `./scripts/start-mobile-web.sh` 后，`http://127.0.0.1:8787/api/overview` 与 `http://127.0.0.1:3000/api/overview` 均返回 `thread_count=133`、`shared_state_available=true`、`codex_home=/Users/miau/.codex`；`HEAD /projects` 与 `HEAD /queue` 均返回 `200`。
- smoke 回归通过：`MOBILE_WEB_SMOKE_SKIP_BROWSER=1 corepack pnpm --filter @codex-remote/mobile-web verify:smoke` 再次通过，说明路由与 compact HTML marker 没被本轮启动链路修改破坏。
- 说明：这轮仍然是运行态基础设施修复，不额外修改 PLAN；Feature #11 继续保留未完成，因为“真实浏览器里从列表进入线程、打开详情/附件入口”的最终手机端验收仍受当前宿主 Chromium 权限限制。

## Session — 2026-03-29 15:28
- 完成 Feature #11：在当前宿主环境里使用真实浏览器（Playwright + 本地 Chromium runtime）完成手机端聊天运行态验收，不再停留在无浏览器 smoke。
- 验收前先清理了陈旧的 3000 `next-server` 进程并重新以 `./scripts/start-mobile-web.sh` 拉起当前实例；确认 `http://127.0.0.1:3000/api/overview` 返回 `threads=140`、`codex_home=/Users/miau/.codex`，`/projects` 与 `/queue` 均返回 `200`。
- 浏览器链路验证通过：从 `/projects` 进入真实线程页，打开 `More actions` -> `Chat info`，从详情面板成功打开 `Recent chats`，关闭后回到线程，再次进入详情成功打开 `Pick skills`，回到线程后成功从 Composer 打开 `Open attachments`，最后通过线程页返回入口回到 `/projects` 列表。
- 截图证据已保存在 `output/playwright/feature11v3-projects.png`、`feature11v3-thread.png`、`feature11v3-skills.png`、`feature11v3-attachments.png`、`feature11v3-return-projects.png`；前一轮中间截图 `feature11v2-*` 也保留了 details/recent-chats 辅助证据。
- 补充观察：`Recent chats` 的关闭行为在真实界面上是“回到线程页”，不是重新回到 `Chat info`；这一点与我最初脚本假设不同，但就产品流来说仍然满足“详情面板里可以进入最近聊天切换器”的验收要求。
- 当前剩余状态：Phase 5 的 12 个 feature 已全部完成；之后如果还要继续做 mobile-web 体验优化，就不再是这份 PLAN.json 的范围，而是新的任务切片。
