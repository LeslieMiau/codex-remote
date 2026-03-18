import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codex Remote",
    short_name: "Codex",
    description: "Mobile command center for a remote Codex coding agent",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1015",
    theme_color: "#0b1015"
  };
}
