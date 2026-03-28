import { describe, expect, it } from "vitest";

import {
  addUploadingImageState,
  markUploadedImageFailedState,
  markUploadedImageReadyState,
  removeSelectedImageState,
  resetThreadAttachmentControllerState,
  toggleSelectedSkillState
} from "./shared-thread-attachment-controller";

describe("thread attachment controller", () => {
  it("toggles selected skills by path", () => {
    const initial = resetThreadAttachmentControllerState();
    const selected = toggleSelectedSkillState(initial, {
      name: "checks",
      path: "/skills/checks"
    });
    const cleared = toggleSelectedSkillState(selected, {
      name: "checks",
      path: "/skills/checks"
    });

    expect(selected.selectedSkills).toHaveLength(1);
    expect(cleared.selectedSkills).toHaveLength(0);
  });

  it("tracks image upload lifecycle from uploading to ready or failed", () => {
    const uploading = addUploadingImageState(resetThreadAttachmentControllerState(), {
      local_id: "image-1",
      file_name: "demo.png",
      content_type: "image/png",
      preview_url: "blob:demo",
      status: "uploading"
    });
    const ready = markUploadedImageReadyState(uploading, {
      localId: "image-1",
      attachmentId: "attachment-1"
    });
    const failed = markUploadedImageFailedState(uploading, {
      localId: "image-1",
      error: "upload failed"
    });

    expect(uploading.isUploadingImages).toBe(true);
    expect(ready.selectedImages[0]).toMatchObject({
      attachment_id: "attachment-1",
      status: "ready"
    });
    expect(failed.selectedImages[0]).toMatchObject({
      status: "failed",
      error: "upload failed"
    });
  });

  it("removes selected images and returns the removed entry", () => {
    const withImage = addUploadingImageState(resetThreadAttachmentControllerState(), {
      local_id: "image-1",
      file_name: "demo.png",
      content_type: "image/png",
      preview_url: "blob:demo",
      status: "uploading"
    });

    const removed = removeSelectedImageState(withImage, "image-1");

    expect(removed.removed?.local_id).toBe("image-1");
    expect(removed.nextState.selectedImages).toHaveLength(0);
  });
});
