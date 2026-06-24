import { z } from "zod";

export const debtSeveritySchema = z.enum(["high", "medium", "low"]);
export type DebtSeverity = z.infer<typeof debtSeveritySchema>;

export const debtStatusSchema = z.enum(["open", "deferred", "resolved"]);
export type DebtStatus = z.infer<typeof debtStatusSchema>;

export const debtSourceSchema = z.enum(["manual", "technical-debt-agent", "reviewer", "architecture-review"]);
export type DebtSource = z.infer<typeof debtSourceSchema>;

export const debtItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: debtSeveritySchema,
  files: z.array(z.string().min(1)).default([]),
  rationale: z.string().min(1),
  recommendedFix: z.string().min(1),
  firstSeenTask: z.string().min(1),
  status: debtStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  source: debtSourceSchema,
  duplicateOf: z.string().min(1).optional(),
  resolutionNote: z.string().min(1).optional()
});

export type DebtItem = z.infer<typeof debtItemSchema>;

export const debtItemInputSchema = z.object({
  title: z.string().min(1),
  severity: debtSeveritySchema,
  files: z.array(z.string().min(1)).default([]),
  rationale: z.string().min(1),
  recommendedFix: z.string().min(1),
  firstSeenTask: z.string().min(1),
  source: debtSourceSchema.default("manual"),
  status: debtStatusSchema.default("open")
});

export type DebtItemInput = z.infer<typeof debtItemInputSchema>;

export const debtStoreSchema = z.object({
  version: z.literal(1),
  items: z.array(debtItemSchema).default([])
});

export type DebtStore = z.infer<typeof debtStoreSchema>;

export function mapPriorityToSeverity(
  priority: "must-fix" | "should-fix" | "nice-to-have"
): DebtSeverity {
  switch (priority) {
    case "must-fix":
      return "high";
    case "should-fix":
      return "medium";
    case "nice-to-have":
      return "low";
  }
}

export function renderDebtItemsAsMarkdown(items: readonly DebtItem[]): string {
  if (items.length === 0) {
    return "";
  }

  return `${items
    .map((item) => {
      const files = item.files.length > 0 ? item.files.join(", ") : "n/a";
      return [
        `## ${item.title}`,
        `- id: ${item.id}`,
        `- severity: ${item.severity}`,
        `- status: ${item.status}`,
        `- first seen task: ${item.firstSeenTask}`,
        `- source: ${item.source}`,
        `- files: ${files}`,
        `- rationale: ${item.rationale}`,
        `- recommended fix: ${item.recommendedFix}`,
        item.duplicateOf ? `- duplicate of: ${item.duplicateOf}` : null,
        item.resolutionNote ? `- note: ${item.resolutionNote}` : null
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    })
    .join("\n\n")}\n`;
}

export function rankDebtSeverity(severity: DebtSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}
