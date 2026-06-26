import { describe, expect, it } from "vitest";

import { renderReviewMarkdown } from "./review-document.js";

describe("renderReviewMarkdown", () => {
  it("renders clickable file links for reviewed files and findings", () => {
    const markdown = renderReviewMarkdown(
      {
        diffFiles: ["packages/shared/src/model-routing.ts"],
        review: {
          summary: "Routes are inverted.",
          findings: [
            {
              severity: "high",
              message: "Public routing points at the private model.",
              filePath: "packages/shared/src/model-routing.ts",
              line: 42
            }
          ]
        }
      },
      "/Users/jasonp/repos/dev-assistant"
    );

    expect(markdown).toContain(
      "[packages/shared/src/model-routing.ts](file:///Users/jasonp/repos/dev-assistant/packages/shared/src/model-routing.ts)"
    );
    expect(markdown).toContain(
      "[packages/shared/src/model-routing.ts:42](file:///Users/jasonp/repos/dev-assistant/packages/shared/src/model-routing.ts#L42)"
    );
  });

  it("renders a no-findings fallback", () => {
    const markdown = renderReviewMarkdown(
      {
        diffFiles: [],
        review: {
          summary: "No issues found.",
          findings: []
        }
      },
      "/workspace"
    );

    expect(markdown).toContain("## Files\n\n- None");
    expect(markdown).toContain("## Findings\n\n- No findings.");
  });
});
