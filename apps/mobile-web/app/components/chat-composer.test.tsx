import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatComposer } from "./chat-composer";

describe("chat composer", () => {
  it("renders a single attachment trigger instead of separate image and skill buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatComposer, {
        attachmentCount: 0,
        capabilitiesInterrupt: true,
        composerDisabledReason: null,
        composerInputDisabled: false,
        composerRef: { current: null },
        hasAttachmentCapability: true,
        imageInputRef: { current: null },
        isMutating: false,
        isRunActive: false,
        isUploadingImages: false,
        leadApproval: null,
        leadNativeRequest: null,
        leadPatch: null,
        locale: "en",
        onComposerKeyDown() {},
        onImageSelection() {},
        onInterrupt() {},
        onOpenAttachmentSheet() {},
        onOpenApprovalSheet() {},
        onOpenNativeRequestSheet() {},
        onOpenPatchReview() {},
        onPromptChange() {},
        onRemoveImage() {},
        onRun() {},
        onToggleSelectedSkill() {},
        onViewImage() {},
        pendingNativeRequestCount: 0,
        prompt: "Ship it",
        selectedImages: [],
        selectedSkills: []
      })
    );

    expect(markup).toContain("Open attachments");
    expect(markup).not.toContain(">Image<");
    expect(markup).not.toContain(">Skills<");
  });
});
