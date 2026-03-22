import type { TurnInputItem } from "@codex-remote/protocol";

import type { CodexAttachmentStore } from "../runtime/codex-attachment-store";

export async function buildAppServerPromptInputs(input: {
  prompt: string;
  inputItems?: TurnInputItem[];
  attachmentStore?: CodexAttachmentStore;
}) {
  const inputs: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: input.prompt,
      text_elements: []
    }
  ];

  for (const item of input.inputItems ?? []) {
    if (item.type === "skill") {
      inputs.push({
        type: "skill",
        name: item.name,
        path: item.path
      });
      continue;
    }

    if (item.type === "image_attachment") {
      const attachmentId =
        typeof item.attachment_id === "string" ? item.attachment_id : "";
      if (!attachmentId) {
        throw new Error("Invalid image attachment.");
      }
      if (!input.attachmentStore) {
        throw new Error("Image attachments are unavailable on this host.");
      }

      const attachment = await input.attachmentStore.resolveImageAttachment(attachmentId);
      if (!attachment) {
        throw new Error(`Image attachment is unavailable: ${attachmentId}`);
      }

      inputs.push({
        type: "localImage",
        path: attachment.local_path
      });
    }
  }

  return inputs;
}
