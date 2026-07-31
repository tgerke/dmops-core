// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import remarkHeadingId from "remark-heading-id";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  site: "https://tgerke.github.io",
  base: "/dmops-core",
  // Old top-level slugs, kept alive after the move under guide/.
  // Astro prepends `base` to redirect sources but not destinations.
  redirects: {
    "/milestones": "/dmops-core/guide/milestones/",
    "/uat": "/dmops-core/guide/uat/",
    "/metrics": "/dmops-core/guide/metrics/",
    "/adapters": "/dmops-core/guide/adapters/",
  },
  markdown: {
    remarkPlugins: [remarkHeadingId],
  },
  integrations: [
    starlight({
      title: "dmops-core",
      description:
        "The DM PMO layer beside the EDC: milestone boards, deliverable status, and capability-gated quality metrics",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/tgerke/dmops-core" }],
      customCss: ["./src/styles/custom.css"],
      components: {
        Footer: "./src/components/Footer.astro",
      },
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        {
          label: "Getting started",
          items: ["start-here", "getting-started", "tour"],
        },
        {
          label: "The study board",
          items: [
            "guide/milestones",
            "guide/deliverables",
            "guide/uat",
            "guide/training-access",
            "guide/lock-readiness",
          ],
        },
        {
          label: "Metrics",
          items: ["guide/metrics", "guide/portfolio", "guide/exports", "guide/writing-a-metric"],
        },
        {
          label: "Integrations",
          items: ["guide/adapters", "guide/writing-an-adapter", "guide/api"],
        },
        {
          label: "Architecture and compliance",
          items: ["architecture", "personas-and-access", "compliance"],
        },
        {
          label: "Reference",
          items: [
            "reference/milestone-taxonomy",
            "reference/glossary",
            {
              label: "Design decisions",
              collapsed: true,
              items: [{ autogenerate: { directory: "reference/decisions" } }],
            },
          ],
        },
      ],
    }),
  ],
});
