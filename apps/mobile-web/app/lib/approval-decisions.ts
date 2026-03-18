import { localize, type Locale } from "./locale";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseDecisionValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }

  return raw;
}

function getDecisionKind(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return "custom";
  }

  const [firstKey] = Object.keys(record);
  return firstKey ?? "custom";
}

function getExecPolicyPreview(value: unknown) {
  const record = asRecord(value);
  const amendment = asRecord(record?.acceptWithExecpolicyAmendment);
  const command = amendment?.execpolicy_amendment;
  return Array.isArray(command) ? command.join(" ") : null;
}

function getNetworkPolicyPreview(value: unknown) {
  const record = asRecord(value);
  const amendment = asRecord(record?.acceptWithNetworkPolicyAmendment);
  return amendment ? JSON.stringify(amendment, null, 2) : null;
}

export interface ApprovalDecisionPresentation {
  approved: boolean;
  buttonClassName: string;
  detail: string | null;
  id: string;
  kind: string;
  label: string;
  nativeDecision: unknown;
  technicalDetail: string | null;
}

export function buildApprovalDecisionPresentation(
  locale: Locale,
  rawDecision: string
): ApprovalDecisionPresentation {
  const nativeDecision = parseDecisionValue(rawDecision);
  const kind = getDecisionKind(nativeDecision);
  const execPreview = getExecPolicyPreview(nativeDecision);
  const networkPreview = getNetworkPolicyPreview(nativeDecision);

  switch (kind) {
    case "accept":
    case "approved":
      return {
        approved: true,
        buttonClassName: "primary-button",
        detail: localize(locale, {
          zh: "仅批准这一次操作。",
          en: "Approve only this action."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "批准", en: "Approve" }),
        nativeDecision,
        technicalDetail: null
      };
    case "acceptForSession":
      return {
        approved: true,
        buttonClassName: "primary-button",
        detail: localize(locale, {
          zh: "在当前会话内记住这次批准，减少重复确认。",
          en: "Remember this approval for the current session."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "本会话批准", en: "Approve for session" }),
        nativeDecision,
        technicalDetail: null
      };
    case "acceptWithExecpolicyAmendment":
      return {
        approved: true,
        buttonClassName: "primary-button",
        detail: localize(locale, {
          zh: "批准这次操作，并把下面这条命令加入允许列表。",
          en: "Approve this action and add the command below to the allowlist."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "批准并记住", en: "Approve + remember" }),
        nativeDecision,
        technicalDetail: execPreview
      };
    case "acceptWithNetworkPolicyAmendment":
      return {
        approved: true,
        buttonClassName: "primary-button",
        detail: localize(locale, {
          zh: "批准这次操作，并同时放宽本次所需的网络策略。",
          en: "Approve this action and amend the required network policy."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "批准并放宽网络", en: "Approve + network" }),
        nativeDecision,
        technicalDetail: networkPreview
      };
    case "reject":
    case "denied":
      return {
        approved: false,
        buttonClassName: "danger-button",
        detail: localize(locale, {
          zh: "拒绝这次操作，Codex 会停止当前需要批准的步骤。",
          en: "Reject this action and stop the approval-gated step."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "拒绝", en: "Reject" }),
        nativeDecision,
        technicalDetail: null
      };
    case "cancel":
      return {
        approved: false,
        buttonClassName: "chrome-button",
        detail: localize(locale, {
          zh: "取消当前审批，不继续执行，也不算明确拒绝。",
          en: "Cancel this approval without continuing the action."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, { zh: "取消", en: "Cancel" }),
        nativeDecision,
        technicalDetail: null
      };
    default:
      return {
        approved: kind.startsWith("accept"),
        buttonClassName: kind.startsWith("accept")
          ? "primary-button"
          : kind === "cancel"
            ? "chrome-button"
            : "secondary-button",
        detail: localize(locale, {
          zh: "这是一个扩展审批选项，带有附加策略。",
          en: "This is an extended approval option with additional policy details."
        }),
        id: rawDecision,
        kind,
        label: localize(locale, {
          zh: kind.startsWith("accept") ? "批准并附带策略" : "扩展选项",
          en: kind.startsWith("accept") ? "Approve + policy" : "Advanced option"
        }),
        nativeDecision,
        technicalDetail:
          typeof nativeDecision === "string"
            ? nativeDecision
            : JSON.stringify(nativeDecision, null, 2)
      };
  }
}
