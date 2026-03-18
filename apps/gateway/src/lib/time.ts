export function nowIso() {
  return new Date().toISOString();
}

export function addHours(value: string | Date, hours: number) {
  const base = value instanceof Date ? new Date(value) : new Date(value);
  base.setTime(base.getTime() + hours * 60 * 60 * 1_000);
  return base.toISOString();
}

export function addMinutes(value: string | Date, minutes: number) {
  const base = value instanceof Date ? new Date(value) : new Date(value);
  base.setTime(base.getTime() + minutes * 60 * 1_000);
  return base.toISOString();
}

export async function sleep(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
