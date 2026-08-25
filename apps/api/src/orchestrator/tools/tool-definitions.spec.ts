import { ORCHESTRATOR_TOOLS, TOOL_NAMES } from './tool-definitions';

type OrchestratorTool = (typeof ORCHESTRATOR_TOOLS)[number];
type FunctionTool = Extract<OrchestratorTool, { type: 'function' }>;

// ChatCompletionTool (this SDK version) is a union of function/custom tools -
// only function tools carry `.function`, so a bare .map(t => t.function...)
// doesn't typecheck without narrowing first. This project only ever builds
// function tools, so filtering (and asserting nothing gets dropped by it) is
// both the type-safe access pattern and a real correctness check.
function isFunctionTool(tool: OrchestratorTool): tool is FunctionTool {
  return tool.type === 'function';
}

describe('ORCHESTRATOR_TOOLS', () => {
  const functionTools = ORCHESTRATOR_TOOLS.filter(isFunctionTool);

  it('is built entirely from function tools - no custom tools slipped in', () => {
    expect(functionTools).toHaveLength(ORCHESTRATOR_TOOLS.length);
  });

  it('defines exactly one tool per TOOL_NAMES entry, with matching names', () => {
    const definedNames = functionTools.map((tool) => tool.function.name).sort();
    const expectedNames = Object.values(TOOL_NAMES).sort();

    expect(definedNames).toEqual(expectedNames);
  });

  it('has no duplicate tool names', () => {
    const names = functionTools.map((tool) => tool.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description, for the model to decide when to call it', () => {
    for (const tool of functionTools) {
      expect(tool.function.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('every required param name is an actual declared property, for every tool', () => {
    for (const tool of functionTools) {
      const params = tool.function.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const propertyNames = Object.keys(params.properties ?? {});

      for (const requiredName of params.required ?? []) {
        expect(propertyNames).toContain(requiredName);
      }
    }
  });

  it('get_practice_question has no difficulty param - nothing in the data model maps to it', () => {
    const tool = functionTools.find((t) => t.function.name === TOOL_NAMES.GET_PRACTICE_QUESTION);
    const params = tool!.function.parameters as { properties?: Record<string, unknown> };

    expect(params.properties).not.toHaveProperty('difficulty');
  });

  it('grade_answer takes only studentAnswer - grading reads the active question from session, not an id', () => {
    const tool = functionTools.find((t) => t.function.name === TOOL_NAMES.GRADE_ANSWER);
    const params = tool!.function.parameters as { properties?: Record<string, unknown> };

    expect(Object.keys(params.properties ?? {})).toEqual(['studentAnswer']);
  });
});
