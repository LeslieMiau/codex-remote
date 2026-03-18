import { randomUUID } from "node:crypto";

export function createUlid() {
  return randomUUID().replace(/-/g, "");
}
