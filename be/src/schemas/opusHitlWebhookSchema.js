export const opusHitlWebhookSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Opus HITL Webhook Payload",
  type: "object",
  required: [
    "execution_id",
    "workflow_id",
    "inputs",
    "callback",
    "expected_output_schema",
  ],
  properties: {
    execution_id: { type: "string", minLength: 1 },
    workflow_id: { type: "string", minLength: 1 },
    workflow_name: { type: "string" },
    inputs: {
      type: "object",
      required: ["review_node"],
      properties: {
        review_node: {
          type: "object",
          required: ["value"],
          properties: {
            // `value` shape varies by OPUS version + upstream node type:
            //   - Integration guide (canonical): { node_id, node_type, inputs, outputs, process, schema: {inputs, outputs} }
            //   - Older / observed:              { node_execution_id, input, output, input_schema, output_schema, process }
            //   - Degenerate (code-node demo):   the upstream node's output dict directly
            // We accept any object here; buildHitlTaskFromWebhook is tolerant of all three.
            value: { type: "object", additionalProperties: true },
            type: { type: "object" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    callback: {
      type: "object",
      required: ["url", "token", "token_header"],
      properties: {
        url: { type: "string", format: "uri" },
        token: { type: "string", minLength: 1 },
        token_header: { type: "string", minLength: 1 },
      },
      additionalProperties: true,
    },
    expected_output_schema: {
      type: "object",
      required: ["schema"],
      properties: {
        schema: {
          type: "object",
          minProperties: 1,
          additionalProperties: { $ref: "#/$defs/variableDef" },
        },
        variable_addition_allowed: { type: "boolean" },
      },
      additionalProperties: true,
    },
  },
  $defs: {
    variableDef: {
      type: "object",
      required: ["id", "variable_name", "allowed_types"],
      properties: {
        id: { type: "string" },
        variable_name: { type: "string" },
        display_name: { type: "string" },
        description: { type: ["string", "null"] },
        is_nullable: { type: ["boolean", "null"] },
        allowed_types: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string" },
              type_definition: {},
              type_definition_enforced: { type: ["boolean", "null"] },
            },
            additionalProperties: true,
          },
        },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};
