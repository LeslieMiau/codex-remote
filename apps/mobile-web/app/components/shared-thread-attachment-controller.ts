import { useCallback, useState } from "react";

import type {
  PendingSendImage,
  PendingSendSkill
} from "../lib/pending-send";

export interface ThreadAttachmentControllerState {
  attachmentSheetOpen: boolean;
  availableSkills: PendingSendSkill[];
  isLoadingSkills: boolean;
  isUploadingImages: boolean;
  selectedImages: PendingSendImage[];
  selectedSkills: PendingSendSkill[];
  skillSheetOpen: boolean;
  skillsError: string | null;
}

const INITIAL_THREAD_ATTACHMENT_CONTROLLER_STATE: ThreadAttachmentControllerState = {
  attachmentSheetOpen: false,
  availableSkills: [],
  isLoadingSkills: false,
  isUploadingImages: false,
  selectedImages: [],
  selectedSkills: [],
  skillSheetOpen: false,
  skillsError: null
};

export function resetThreadAttachmentControllerState() {
  return INITIAL_THREAD_ATTACHMENT_CONTROLLER_STATE;
}

export function toggleSelectedSkillState(
  current: ThreadAttachmentControllerState,
  skill: PendingSendSkill
) {
  const exists = current.selectedSkills.some((candidate) => candidate.path === skill.path);
  return {
    ...current,
    selectedSkills: exists
      ? current.selectedSkills.filter((candidate) => candidate.path !== skill.path)
      : [...current.selectedSkills, skill]
  };
}

export function removeSelectedImageState(
  current: ThreadAttachmentControllerState,
  localId: string
) {
  const removed =
    current.selectedImages.find((image) => image.local_id === localId) ?? null;
  return {
    nextState: {
      ...current,
      selectedImages: current.selectedImages.filter((image) => image.local_id !== localId)
    },
    removed
  };
}

export function addUploadingImageState(
  current: ThreadAttachmentControllerState,
  image: PendingSendImage
) {
  return {
    ...current,
    isUploadingImages: true,
    selectedImages: [...current.selectedImages, image]
  };
}

export function markUploadedImageReadyState(
  current: ThreadAttachmentControllerState,
  input: {
    attachmentId: string;
    localId: string;
  }
) {
  return {
    ...current,
    selectedImages: current.selectedImages.map((image) =>
      image.local_id === input.localId
        ? {
            ...image,
            id: input.attachmentId,
            attachment_id: input.attachmentId,
            status: "ready" as const
          }
        : image
    )
  };
}

export function markUploadedImageFailedState(
  current: ThreadAttachmentControllerState,
  input: {
    error: string;
    localId: string;
  }
) {
  return {
    ...current,
    selectedImages: current.selectedImages.map((image) =>
      image.local_id === input.localId
        ? {
            ...image,
            status: "failed" as const,
            error: input.error
          }
        : image
    )
  };
}

export function useThreadAttachmentController() {
  const [state, setState] = useState<ThreadAttachmentControllerState>(
    INITIAL_THREAD_ATTACHMENT_CONTROLLER_STATE
  );

  const reset = useCallback(() => {
    setState(INITIAL_THREAD_ATTACHMENT_CONTROLLER_STATE);
  }, []);

  const setAvailableSkills = useCallback((skills: PendingSendSkill[]) => {
    setState((current) => ({
      ...current,
      availableSkills: skills
    }));
  }, []);

  const setSkillsError = useCallback((value: string | null) => {
    setState((current) => ({
      ...current,
      skillsError: value
    }));
  }, []);

  const setIsLoadingSkills = useCallback((value: boolean) => {
    setState((current) => ({
      ...current,
      isLoadingSkills: value
    }));
  }, []);

  const openAttachmentSheet = useCallback(() => {
    setState((current) => ({
      ...current,
      attachmentSheetOpen: true
    }));
  }, []);

  const closeAttachmentSheet = useCallback(() => {
    setState((current) => ({
      ...current,
      attachmentSheetOpen: false
    }));
  }, []);

  const openSkillSheet = useCallback(() => {
    setState((current) => ({
      ...current,
      skillSheetOpen: true
    }));
  }, []);

  const closeSkillSheet = useCallback(() => {
    setState((current) => ({
      ...current,
      skillSheetOpen: false
    }));
  }, []);

  const toggleSelectedSkill = useCallback((skill: PendingSendSkill) => {
    setState((current) => toggleSelectedSkillState(current, skill));
  }, []);

  const removeSelectedImage = useCallback((localId: string) => {
    let removed: PendingSendImage | null = null;
    setState((current) => {
      const result = removeSelectedImageState(current, localId);
      removed = result.removed;
      return result.nextState;
    });
    return removed;
  }, []);

  const setIsUploadingImages = useCallback((value: boolean) => {
    setState((current) => ({
      ...current,
      isUploadingImages: value
    }));
  }, []);

  const addUploadingImage = useCallback((image: PendingSendImage) => {
    setState((current) => addUploadingImageState(current, image));
  }, []);

  const markUploadedImageReady = useCallback((localId: string, attachmentId: string) => {
    setState((current) =>
      markUploadedImageReadyState(current, {
        localId,
        attachmentId
      })
    );
  }, []);

  const markUploadedImageFailed = useCallback((localId: string, error: string) => {
    setState((current) =>
      markUploadedImageFailedState(current, {
        localId,
        error
      })
    );
  }, []);

  const setSelectedImages = useCallback((value: PendingSendImage[]) => {
    setState((current) => ({
      ...current,
      selectedImages: value
    }));
  }, []);

  const setSelectedSkills = useCallback((value: PendingSendSkill[]) => {
    setState((current) => ({
      ...current,
      selectedSkills: value
    }));
  }, []);

  return {
    ...state,
    addUploadingImage,
    closeAttachmentSheet,
    closeSkillSheet,
    markUploadedImageFailed,
    markUploadedImageReady,
    openAttachmentSheet,
    openSkillSheet,
    removeSelectedImage,
    reset,
    setAvailableSkills,
    setIsLoadingSkills,
    setIsUploadingImages,
    setSelectedImages,
    setSelectedSkills,
    setSkillsError,
    toggleSelectedSkill
  };
}
