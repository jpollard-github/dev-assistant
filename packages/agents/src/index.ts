import { z } from "@dev-assistant/shared";

export const agentRoles = [
  "coordinator",
  "coder",
  "reviewer",
  "test-runner",
  "coordinator-report"
] as const;
export const agentRoleSchema = z.enum(agentRoles);
export type AgentRole = (typeof agentRoles)[number];
export const advisoryAgentRoles = ["test-writer", "architecture-review", "technical-debt"] as const;
export const advisoryAgentRoleSchema = z.enum(advisoryAgentRoles);
export type AdvisoryAgentRole = (typeof advisoryAgentRoles)[number];

export interface JsonSchema {
  readonly $schema: string;
  readonly type: string;
  readonly title?: string;
  readonly description?: string;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly properties?: Record<string, unknown>;
  readonly items?: unknown;
  readonly minItems?: number;
}

const fileChangeSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["create", "update", "delete"])
});

export type FileChange = z.infer<typeof fileChangeSchema>;

const fileOperationSchema = z
  .object({
    path: z.string().min(1),
    changeType: z.enum(["create", "update", "delete"]),
    content: z.string().optional()
  })
  .superRefine((value, context) => {
    if ((value.changeType === "create" || value.changeType === "update") && value.content === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required for create and update operations"
      });
    }

    if (value.changeType === "delete" && value.content !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content must be omitted for delete operations"
      });
    }
  });

export type FileOperation = z.infer<typeof fileOperationSchema>;

export const coordinatorOutputSchema = z.object({
  summary: z.string().min(1),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        kind: z.enum(["analysis", "edit", "review", "test"])
      })
    )
    .min(1),
  requiresTests: z.boolean().default(true)
});

export type CoordinatorOutput = z.infer<typeof coordinatorOutputSchema>;

export const coderOutputSchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  diff: z.string().min(1),
  files: z.array(fileChangeSchema).default([]),
  operations: z.array(fileOperationSchema).default([]),
  commands: z.array(z.string().min(1)).default([])
});

export type CoderOutput = z.infer<typeof coderOutputSchema>;

export const reviewerOutputSchema = z.object({
  summary: z.string().min(1),
  approved: z.boolean(),
  findings: z.array(
    z.object({
      severity: z.enum(["low", "medium", "high"]),
      message: z.string().min(1),
      filePath: z.string().min(1).optional(),
      line: z.number().int().positive().optional()
    })
  )
});

export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

export const testRunnerOutputSchema = z.object({
  summary: z.string().min(1),
  passed: z.boolean(),
  commandResults: z.array(
    z.object({
      command: z.string().min(1),
      exitCode: z.number().int(),
      stdout: z.string(),
      stderr: z.string()
    })
  )
});

export type TestRunnerOutput = z.infer<typeof testRunnerOutputSchema>;

export const coordinatorReportOutputSchema = z.object({
  summary: z.string().min(1),
  outcome: z.enum(["completed", "blocked"]),
  changedFiles: z.array(z.string().min(1)).default([]),
  testsPassed: z.boolean().nullable(),
  followUps: z.array(z.string().min(1)).default([])
});

export type CoordinatorReportOutput = z.infer<typeof coordinatorReportOutputSchema>;

export const testWriterOutputSchema = z.object({
  summary: z.string().min(1),
  coverageGaps: z.array(z.string().min(1)).default([]),
  recommendedTests: z.array(
    z.object({
      filePath: z.string().min(1),
      testName: z.string().min(1),
      rationale: z.string().min(1)
    })
  ),
  files: z.array(fileChangeSchema).default([]),
  operations: z.array(fileOperationSchema).default([]),
  commands: z.array(z.string().min(1)).default([])
});

export type TestWriterOutput = z.infer<typeof testWriterOutputSchema>;

export const architectureReviewOutputSchema = z.object({
  summary: z.string().min(1),
  recommendations: z.array(
    z.object({
      severity: z.enum(["low", "medium", "high"]),
      area: z.enum(["boundaries", "coupling", "dependency-direction", "migration-risk"]),
      message: z.string().min(1),
      filePath: z.string().min(1).optional()
    })
  )
});

export type ArchitectureReviewOutput = z.infer<typeof architectureReviewOutputSchema>;

export const technicalDebtOutputSchema = z.object({
  summary: z.string().min(1),
  items: z.array(
    z.object({
      title: z.string().min(1),
      priority: z.enum(["must-fix", "should-fix", "nice-to-have"]),
      files: z.array(z.string().min(1)).default([]),
      rationale: z.string().min(1),
      recommendedFix: z.string().min(1)
    })
  )
});

export type TechnicalDebtOutput = z.infer<typeof technicalDebtOutputSchema>;

export interface AgentOutputMap {
  coordinator: CoordinatorOutput;
  coder: CoderOutput;
  reviewer: ReviewerOutput;
  "test-runner": TestRunnerOutput;
  "coordinator-report": CoordinatorReportOutput;
}

export interface AdvisoryAgentOutputMap {
  "test-writer": TestWriterOutput;
  "architecture-review": ArchitectureReviewOutput;
  "technical-debt": TechnicalDebtOutput;
}

export const agentOutputSchemas = {
  coordinator: coordinatorOutputSchema,
  coder: coderOutputSchema,
  reviewer: reviewerOutputSchema,
  "test-runner": testRunnerOutputSchema,
  "coordinator-report": coordinatorReportOutputSchema
} as const;

export const advisoryAgentOutputSchemas = {
  "test-writer": testWriterOutputSchema,
  "architecture-review": architectureReviewOutputSchema,
  "technical-debt": technicalDebtOutputSchema
} as const;

export const advisoryAgentOutputJsonSchemas: Record<AdvisoryAgentRole, JsonSchema> = {
  "test-writer": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "TestWriterOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "coverageGaps", "recommendedTests", "files", "operations", "commands"],
    properties: {
      summary: { type: "string", minLength: 1 },
      coverageGaps: {
        type: "array",
        items: { type: "string", minLength: 1 }
      },
      recommendedTests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["filePath", "testName", "rationale"],
          properties: {
            filePath: { type: "string", minLength: 1 },
            testName: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 }
          }
        }
      },
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "changeType"],
          properties: {
            path: { type: "string", minLength: 1 },
            changeType: { type: "string", enum: ["create", "update", "delete"] }
          }
        }
      },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "changeType"],
          properties: {
            path: { type: "string", minLength: 1 },
            changeType: { type: "string", enum: ["create", "update", "delete"] },
            content: { type: "string" }
          }
        }
      },
      commands: {
        type: "array",
        items: { type: "string", minLength: 1 }
      }
    }
  },
  "architecture-review": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ArchitectureReviewOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: {
      summary: { type: "string", minLength: 1 },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "area", "message"],
          properties: {
            severity: { type: "string", enum: ["low", "medium", "high"] },
            area: {
              type: "string",
              enum: ["boundaries", "coupling", "dependency-direction", "migration-risk"]
            },
            message: { type: "string", minLength: 1 },
            filePath: { type: "string", minLength: 1 }
          }
        }
      }
    }
  },
  "technical-debt": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "TechnicalDebtOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "items"],
    properties: {
      summary: { type: "string", minLength: 1 },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "priority", "files", "rationale", "recommendedFix"],
          properties: {
            title: { type: "string", minLength: 1 },
            priority: { type: "string", enum: ["must-fix", "should-fix", "nice-to-have"] },
            files: {
              type: "array",
              items: { type: "string", minLength: 1 }
            },
            rationale: { type: "string", minLength: 1 },
            recommendedFix: { type: "string", minLength: 1 }
          }
        }
      }
    }
  }
};

export function parseAgentOutput<TRole extends AgentRole>(
  role: TRole,
  value: unknown
): AgentOutputMap[TRole] {
  switch (role) {
    case "coordinator":
      return coordinatorOutputSchema.parse(value) as AgentOutputMap[TRole];
    case "coder":
      return coderOutputSchema.parse(value) as AgentOutputMap[TRole];
    case "reviewer":
      return reviewerOutputSchema.parse(value) as AgentOutputMap[TRole];
    case "test-runner":
      return testRunnerOutputSchema.parse(value) as AgentOutputMap[TRole];
    case "coordinator-report":
      return coordinatorReportOutputSchema.parse(value) as AgentOutputMap[TRole];
  }
}

export function formatSchemaErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

export function parseAdvisoryAgentOutput<TRole extends AdvisoryAgentRole>(
  role: TRole,
  value: unknown
): AdvisoryAgentOutputMap[TRole] {
  switch (role) {
    case "test-writer":
      return testWriterOutputSchema.parse(value) as AdvisoryAgentOutputMap[TRole];
    case "architecture-review":
      return architectureReviewOutputSchema.parse(value) as AdvisoryAgentOutputMap[TRole];
    case "technical-debt":
      return technicalDebtOutputSchema.parse(value) as AdvisoryAgentOutputMap[TRole];
  }
}

export const agentOutputJsonSchemas: Record<AgentRole, JsonSchema> = {
  coordinator: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "CoordinatorOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "steps", "requiresTests"],
    properties: {
      summary: { type: "string", minLength: 1 },
      requiresTests: { type: "boolean" },
      steps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "description", "kind"],
          properties: {
            id: { type: "string", minLength: 1 },
            description: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["analysis", "edit", "review", "test"] }
          }
        }
      }
    }
  },
  coder: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "CoderOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "rationale", "diff", "files", "operations", "commands"],
    properties: {
      summary: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
      diff: { type: "string", minLength: 1 },
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "changeType"],
          properties: {
            path: { type: "string", minLength: 1 },
            changeType: { type: "string", enum: ["create", "update", "delete"] }
          }
        }
      },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "changeType"],
          properties: {
            path: { type: "string", minLength: 1 },
            changeType: { type: "string", enum: ["create", "update", "delete"] },
            content: { type: "string" }
          }
        }
      },
      commands: {
        type: "array",
        items: { type: "string", minLength: 1 }
      }
    }
  },
  reviewer: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ReviewerOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "approved", "findings"],
    properties: {
      summary: { type: "string", minLength: 1 },
      approved: { type: "boolean" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "message"],
          properties: {
            severity: { type: "string", enum: ["low", "medium", "high"] },
            message: { type: "string", minLength: 1 },
            filePath: { type: "string", minLength: 1 },
            line: { type: "integer", minimum: 1 }
          }
        }
      }
    }
  },
  "test-runner": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "TestRunnerOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "passed", "commandResults"],
    properties: {
      summary: { type: "string", minLength: 1 },
      passed: { type: "boolean" },
      commandResults: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["command", "exitCode", "stdout", "stderr"],
          properties: {
            command: { type: "string", minLength: 1 },
            exitCode: { type: "integer" },
            stdout: { type: "string" },
            stderr: { type: "string" }
          }
        }
      }
    }
  },
  "coordinator-report": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "CoordinatorReportOutput",
    type: "object",
    additionalProperties: false,
    required: ["summary", "outcome", "changedFiles", "testsPassed", "followUps"],
    properties: {
      summary: { type: "string", minLength: 1 },
      outcome: { type: "string", enum: ["completed", "blocked"] },
      changedFiles: {
        type: "array",
        items: { type: "string", minLength: 1 }
      },
      testsPassed: {
        type: ["boolean", "null"]
      },
      followUps: {
        type: "array",
        items: { type: "string", minLength: 1 }
      }
    }
  }
};

export * from "./quality.js";
