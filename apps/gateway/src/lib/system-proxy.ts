export interface ResolvedAppServerEnvironment {
  env: NodeJS.ProcessEnv;
}

export async function resolveCodexAppServerEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Promise<ResolvedAppServerEnvironment> {
  return {
    env: {
      ...source
    }
  };
}
