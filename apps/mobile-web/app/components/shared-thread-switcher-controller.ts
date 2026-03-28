import { useCallback, useEffect, useState } from "react";

import type { CodexThread } from "@codex-remote/protocol";

import { shouldHideThreadFromMobileList } from "../lib/chat-thread-presentation";
import { getCodexOverview } from "../lib/gateway-client";
import { type Locale } from "../lib/locale";
import {
  getStoredThreadListRoute,
  type ThreadListRoute
} from "../lib/thread-list-route-storage";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { describeActionError } from "../lib/thread-realtime-state";

export interface ThreadSwitcherControllerState {
  isLoadingThreads: boolean;
  returnToListHref: ThreadListRoute;
  switcherThreads: CodexThread[];
  threadSwitcherError: string | null;
}

interface LoadThreadSwitcherResult {
  switcherThreads: CodexThread[];
  threadSwitcherError: string | null;
}

interface UseSharedThreadSwitcherControllerInput {
  locale: Locale;
  onSelectThread: (threadId: string) => void;
  threadId: string;
}

const INITIAL_THREAD_SWITCHER_CONTROLLER_STATE: ThreadSwitcherControllerState = {
  isLoadingThreads: false,
  returnToListHref: "/projects",
  switcherThreads: [],
  threadSwitcherError: null
};

export function resetThreadSwitcherControllerState(): ThreadSwitcherControllerState {
  return { ...INITIAL_THREAD_SWITCHER_CONTROLLER_STATE };
}

export function beginThreadSwitcherLoadState(
  current: ThreadSwitcherControllerState
): ThreadSwitcherControllerState {
  return {
    ...current,
    isLoadingThreads: true,
    threadSwitcherError: null
  };
}

export function resolveThreadSwitcherThreads(threads: CodexThread[]) {
  return [...threads]
    .filter((thread) => !shouldHideThreadFromMobileList(thread))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function completeThreadSwitcherLoadState(
  current: ThreadSwitcherControllerState,
  threads: CodexThread[]
): ThreadSwitcherControllerState {
  return {
    ...current,
    isLoadingThreads: false,
    switcherThreads: resolveThreadSwitcherThreads(threads),
    threadSwitcherError: null
  };
}

export function failThreadSwitcherLoadState(
  current: ThreadSwitcherControllerState,
  message: string
): ThreadSwitcherControllerState {
  return {
    ...current,
    isLoadingThreads: false,
    switcherThreads: [],
    threadSwitcherError: message
  };
}

export async function loadThreadSwitcherResult(input: {
  describeError: (error: unknown) => string;
  loadOverview: typeof getCodexOverview;
}): Promise<LoadThreadSwitcherResult> {
  try {
    const overview = await input.loadOverview({
      includeArchived: true
    });
    return {
      switcherThreads: resolveThreadSwitcherThreads(overview.threads),
      threadSwitcherError: null
    };
  } catch (error) {
    return {
      switcherThreads: [],
      threadSwitcherError: input.describeError(error)
    };
  }
}

export function useSharedThreadSwitcherController(
  input: UseSharedThreadSwitcherControllerInput
) {
  const [state, setState] = useState<ThreadSwitcherControllerState>(
    INITIAL_THREAD_SWITCHER_CONTROLLER_STATE
  );

  useEffect(() => {
    setState({
      ...INITIAL_THREAD_SWITCHER_CONTROLLER_STATE,
      returnToListHref: getStoredThreadListRoute()
    });
  }, [input.threadId]);

  const loadThreads = useCallback(async () => {
    setState((current) => beginThreadSwitcherLoadState(current));
    const result = await loadThreadSwitcherResult({
      loadOverview: getCodexOverview,
      describeError: (error) => describeActionError(input.locale, error)
    });
    setState((current) =>
      result.threadSwitcherError
        ? failThreadSwitcherLoadState(current, result.threadSwitcherError)
        : {
            ...completeThreadSwitcherLoadState(current, result.switcherThreads),
            switcherThreads: result.switcherThreads
          }
    );
  }, [input.locale]);

  const selectThread = useCallback(
    (nextThreadId: string) => {
      setStoredLastActiveThread(nextThreadId);
      input.onSelectThread(nextThreadId);
    },
    [input.onSelectThread]
  );

  return {
    ...state,
    loadThreads,
    selectThread
  };
}
