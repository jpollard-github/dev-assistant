import { join } from "node:path";
import { pathToFileURL } from "node:url";

type ReviewSummary = {
  readonly diffFiles: readonly string[];
  readonly review: {
    readonly summary: string;
    readonly findings: readonly {
      readonly severity: string;
      readonly message: string;
      readonly filePath?: string | undefined;
      readonly line?: number | undefined;
    }[];
  };
};

export function renderReviewMarkdown(summary: ReviewSummary, workspacePath: string): string {
  const findings =
    summary.review.findings.length > 0
      ? summary.review.findings
          .map((finding) => {
            const location = formatFindingLocation(workspacePath, finding.filePath, finding.line);
            return `- [${finding.severity}] ${escapeMarkdown(finding.message)}${location}`;
          })
          .join("\n")
      : "- No findings.";

  return `# Diff Review

${escapeMarkdown(summary.review.summary)}

## Files

${formatFileList(summary.diffFiles, workspacePath)}

## Findings

${findings}
`;
}

function formatFileList(values: readonly string[], workspacePath: string): string {
  return values.length > 0 ? values.map((value) => `- ${formatFileLink(workspacePath, value)}`).join("\n") : "- None";
}

function formatFindingLocation(workspacePath: string, filePath?: string, line?: number): string {
  if (!filePath) {
    return "";
  }

  return ` (${formatFileLink(workspacePath, filePath, line)})`;
}

function formatFileLink(workspacePath: string, filePath: string, line?: number): string {
  const label = line ? `${filePath}:${line}` : filePath;
  const uri = pathToFileURL(join(workspacePath, filePath));
  if (line) {
    uri.hash = `L${line}`;
  }

  return `[${escapeMarkdown(label)}](${uri.toString()})`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_`[\]]/g, "\\$&");
}
