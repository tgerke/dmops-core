// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tgerke.github.io",
  base: "/dmops-core",
  integrations: [
    starlight({
      title: "dmops-core",
      description:
        "The DM PMO layer beside the EDC: milestone boards, deliverable status, and capability-gated quality metrics",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/tgerke/dmops-core" }],
      sidebar: [
        { label: "Getting started", items: ["getting-started"] },
        {
          label: "Guide",
          items: ["milestones", "metrics", "adapters", "compliance"],
        },
      ],
    }),
  ],
});
