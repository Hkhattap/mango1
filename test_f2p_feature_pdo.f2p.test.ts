/**
 * F2P Tests for Task: Processor Dependency Ordering
 * These tests FAIL on the original code and PASS on correct solutions.
 * HIDDEN from Claude during task execution.
 */

import { ProcessorRegistry } from '../src/core/registry';
import { Pipeline } from '../src/core/pipeline';
import { LruCache } from '../src/storage/cache';
import { MetricsCollector } from '../src/metrics/metrics';
import { StructuredLogger } from '../src/metrics/logger';
import { Processor, ProcessorRuntimeConfig, ProcessingContext, PipelineExecutionResult } from '../src/types';

// Mock processors for testing
const createMockProcessor = (id: string, processFn?: (context: ProcessingContext) => object): Processor => ({
  definition: {
    id,
    name: `Processor ${id}`,
    description: `Test processor ${id}`,
    supportsOverrides: true,
    dependencyIds: [],
  },
  validate: () => ({ valid: true, errors: [], warnings: [] }),
  process: async (context) => processFn ? processFn(context) : {},
});

function buildPipeline(processors: Processor[], configs: ProcessorRuntimeConfig[]): Pipeline {
  const logger = new StructuredLogger('test-proc-deps');
  const registry = new ProcessorRegistry(processors, logger);
  registry.loadRuntimeConfigs(configs);
  const cache = new LruCache<string, PipelineExecutionResult>(10);
  const metrics = new MetricsCollector();
  return new Pipeline(registry, cache, metrics, logger);
}

describe('F2P: Processor Dependency Ordering', () => {
  const logger = new StructuredLogger('test-proc-deps');

  /**
   * F2P-1: Simple linear dependency chain is respected
   *
   * When Processor B depends on Processor A, A must come before B.
   * In the original code, resolve() returns processors in 'order' sequence,
   * ignoring dependencyIds. The corrected code enforces topological order.
   *
   * Setup: A (order=20), B (order=10, depends on A)
   * Expected: [A, B] (A first, despite lower order value)
   */
  it('F2P-1: linear dependency chain is topologically sorted', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');

    const registry = new ProcessorRegistry([procA, procB], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 20,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 10,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(2);
    expect(resolved[0].config.id).toBe('procA');
    expect(resolved[1].config.id).toBe('procB');
  });

  /**
   * F2P-2: Circular dependency is detected and throws error
   *
   * If A depends on B and B depends on A, this is a circular dependency
   * and should throw an error. The original code doesn't check this.
   *
   * Expected: Error with "Circular dependency" message
   */
  it('F2P-2: circular dependencies are detected and rejected', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');

    const registry = new ProcessorRegistry([procA, procB], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: ['procB'],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    expect(() => registry.resolve()).toThrow(/[Cc]ircular/);
  });

  /**
   * F2P-3: Missing dependency is detected and throws error
   *
   * If Processor A depends on Processor B which doesn't exist,
   * resolve() should throw an error indicating the missing dependency.
   *
   * Expected: Error with "not available" or similar message
   */
  it('F2P-3: missing dependencies are detected and throw error', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: ['procB'],
        options: {},
      },
    ]);

    expect(() => registry.resolve()).toThrow(/(not available|not found|does not exist|missing)/i);
  });

  /**
   * F2P-4: Disabled dependency is treated as unavailable
   *
   * If a processor depends on a disabled processor,
   * the dependency cannot be satisfied.
   *
   * Expected: Error thrown (similar to missing dependency)
   */
  it('F2P-4: disabled processors cannot satisfy dependencies', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');

    const registry = new ProcessorRegistry([procA, procB], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: false,
        order: 10,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    expect(() => registry.resolve()).toThrow();
  });

  /**
   * F2P-5: Transitive dependencies are satisfied
   *
   * If A depends on B and B depends on C, then C, B, A is the correct order.
   *
   * Setup: A → B → C (where → means "depends on")
   * Expected order: [C, B, A]
   */
  it('F2P-5: transitive dependencies are properly ordered', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');
    const procC = createMockProcessor('procC');

    const registry = new ProcessorRegistry([procA, procB, procC], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: ['procB'],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procC'],
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(3);
    expect(resolved[0].config.id).toBe('procC');
    expect(resolved[1].config.id).toBe('procB');
    expect(resolved[2].config.id).toBe('procA');
  });

  /**
   * F2P-6: Diamond dependency pattern is handled correctly
   *
   * When A depends on both B and C, and both depend on D,
   * the correct order is D, then B and C, then A.
   *
   * Setup: A → {B, C}, B → D, C → D
   * Expected: D first, then B and C, then A
   */
  it('F2P-6: diamond dependency pattern is correctly ordered', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');
    const procC = createMockProcessor('procC');
    const procD = createMockProcessor('procD');

    const registry = new ProcessorRegistry([procA, procB, procC, procD], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: ['procB', 'procC'],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procD'],
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: ['procD'],
        options: {},
      },
      {
        id: 'procD',
        enabled: true,
        order: 40,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(4);

    const dIndex = resolved.findIndex((r) => r.config.id === 'procD');
    expect(dIndex).toBe(0);

    const bIndex = resolved.findIndex((r) => r.config.id === 'procB');
    const cIndex = resolved.findIndex((r) => r.config.id === 'procC');
    expect(bIndex > dIndex).toBe(true);
    expect(cIndex > dIndex).toBe(true);

    const aIndex = resolved.findIndex((r) => r.config.id === 'procA');
    expect(aIndex > bIndex).toBe(true);
    expect(aIndex > cIndex).toBe(true);
  });

  /**
   * F2P-7: Self-dependency is detected as circular
   *
   * A processor cannot depend on itself.
   * Expected: Circular dependency error
   */
  it('F2P-7: self-dependency is detected as circular', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    expect(() => registry.resolve()).toThrow(/[Cc]ircular/);
  });
});

// ─── Output Isolation ────────────────────────────────────────────────────────

describe('F2P: Processor Output Isolation', () => {
  const logger = new StructuredLogger('test-proc-deps');

  /**
   * F2P-8: Processor output is accessible via context.outputs
   *
   * After procA runs, procB should be able to read procA's output via
   * context.outputs['procA']. In the original code, context has no outputs
   * field, so this will be undefined.
   *
   * Expected: context.outputs['procA'] is defined when procB runs
   */
  it('F2P-8: processor output is accessible via context.outputs', async () => {
    let capturedOutputs: Record<string, unknown> | undefined;

    const procA = createMockProcessor('procA', () => ({
      output: { custom: { fromA: true } },
    }));

    const procB = createMockProcessor('procB', (context) => {
      capturedOutputs = { ...(context as any).outputs };
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: ['procA'], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(capturedOutputs).toBeDefined();
    expect(capturedOutputs!['procA']).toBeDefined();
  });

  /**
   * F2P-9: Dependent processor reads dependency output correctly
   *
   * procB depends on procA. When procB runs, it should read the correct
   * output values that procA produced via context.outputs.
   *
   * Expected: context.outputs['procA'].custom.token === 'secret-value'
   */
  it('F2P-9: dependent processor reads dependency output correctly', async () => {
    let outputSeenByB: unknown;

    const procA = createMockProcessor('procA', () => ({
      output: { custom: { token: 'secret-value' } },
    }));

    const procB = createMockProcessor('procB', (context) => {
      outputSeenByB = (context as any).outputs?.['procA'];
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: ['procA'], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(outputSeenByB).toBeDefined();
    expect((outputSeenByB as any)?.custom?.token).toBe('secret-value');
  });

  /**
   * F2P-10: context.outputs is empty for first processor
   *
   * The first processor in the chain has no dependencies that have run yet.
   * context.outputs should exist as an empty object, not be undefined.
   *
   * Expected: context.outputs is {} for the first processor
   */
  it('F2P-10: context.outputs is empty for first processor', async () => {
    let outputsSeenByA: unknown;

    const procA = createMockProcessor('procA', (context) => {
      outputsSeenByA = (context as any).outputs;
      return {};
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(outputsSeenByA).toBeDefined();
    expect(Object.keys(outputsSeenByA as object)).toHaveLength(0);
  });

  /**
   * F2P-11: Output isolation prevents processors from overwriting each other
   *
   * Each processor's output is stored under its own namespace in context.outputs.
   * This prevents later processors from overwriting earlier outputs via Object.assign.
   *
   * Expected: context.outputs['procA'] and context.outputs['procB'] both
   * preserve their full outputs without being overwritten
   */
  it('F2P-11: output isolation prevents processors from overwriting each other', async () => {
    const outputs: Record<string, Record<string, unknown>> = {};

    const procA = createMockProcessor('procA', () => ({
      output: { custom: { dataFromA: 'valueA' } },
    }));

    const procB = createMockProcessor('procB', (context) => {
      outputs['afterB'] = { ...(context as any).outputs } as Record<string, unknown>;
      return {
        output: { custom: { dataFromB: 'valueB' } },
      };
    });

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(outputs['afterB']['procA']).toBeDefined();
    expect((outputs['afterB']['procA'] as any)?.custom?.dataFromA).toBe('valueA');
  });

  /**
   * F2P-12: Multiple processor outputs are all accessible
   *
   * When procC depends on both procA and procB, it should be able to see
   * outputs from both in context.outputs. Outputs accumulate across the chain.
   *
   * Expected: context.outputs contains keys for both procA and procB
   */
  it('F2P-12: outputs from multiple processors are all accessible', async () => {
    let outputsSeenByC: Record<string, unknown> | undefined;

    const procA = createMockProcessor('procA', () => ({
      output: { custom: { fromA: 1 } },
    }));

    const procB = createMockProcessor('procB', () => ({
      output: { custom: { fromB: 2 } },
    }));

    const procC = createMockProcessor('procC', (context) => {
      outputsSeenByC = { ...(context as any).outputs };
      return {};
    });

    const pipeline = buildPipeline([procA, procB, procC], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
      { id: 'procC', enabled: true, order: 30, dependencyIds: ['procA', 'procB'], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(outputsSeenByC?.['procA']).toBeDefined();
    expect(outputsSeenByC?.['procB']).toBeDefined();
  });
});

// ─── Conditional Execution ───────────────────────────────────────────────────

describe('F2P: Conditional Execution', () => {
  const logger = new StructuredLogger('test-proc-deps');


  /**
   * F2P-13: Async condition returning false is properly awaited and skips processor
   *
   * Conditions can return a Promise<boolean>. The pipeline must await the condition
   * before deciding whether to execute the processor.
   *
   * Expected: Processor is skipped and result.skippedProcessors includes it
   */
  it('F2P-13: async condition returning false skips the processor', async () => {
    let procAExecuted = false;

    const procA = createMockProcessor('procA', () => {
      procAExecuted = true;
      return { output: { data: 'executed' } };
    });

    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: async () => false,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(procAExecuted).toBe(false);
    expect(result.skippedProcessors).toContain('procA');
  });

  /**
   * F2P-14: Processor with failing condition is skipped
   *
   * If a processor's condition returns false, it should not execute
   * and should not produce output. The skipped processor is tracked in result.
   *
   * Expected: Processor does not execute, and result.skippedProcessors includes it
   */
  it('F2P-14: processor with failing condition is skipped', async () => {
    let procAExecuted = false;

    const procA = createMockProcessor('procA', () => {
      procAExecuted = true;
      return { output: { data: 'executed' } };
    });

    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => false,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(procAExecuted).toBe(false);
    expect(result.skippedProcessors).toContain('procA');
  });

  /**
   * F2P-15: Dependent processor fails if required dependency is skipped
   *
   * If procA is skipped due to condition, and procB depends on procA
   * without a condition, procB should fail because its required dependency
   * is not available.
   *
   * Expected: Pipeline fails with error about missing dependency
   */
  it('F2P-15: dependent processor fails if required dependency is skipped', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => false,
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    await expect(pipeline.execute({ content: 'test' })).rejects.toThrow();
  });

  /**
   * F2P-16: Processor with condition skips itself when its dependency was skipped
   *
   * If procA is skipped (condition: false), and procB depends on procA and
   * has its own condition, procB should skip itself rather than fail.
   *
   * Expected: procB is in result.skippedProcessors, not an error
   */
  it('F2P-16: conditional processor skips itself when dependency is skipped', async () => {
    let procBExecuted = false;

    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => {
      procBExecuted = true;
      return { output: {} };
    });

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => false,
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        condition: () => true,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(procBExecuted).toBe(false);
    expect(result.skippedProcessors).toContain('procB');
  });

  /**
   * F2P-17: Result includes all skipped processor IDs
   *
   * The pipeline result must track which processors were skipped due to conditions.
   *
   * Expected: result.skippedProcessors is an array containing all skipped IDs
   */
  it('F2P-17: result includes all skipped processor IDs', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => ({ output: {} }));
    const procC = createMockProcessor('procC', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB, procC], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => false,
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: [],
        condition: () => true,
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: [],
        condition: () => false,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.skippedProcessors?.sort()).toEqual(['procA', 'procC']);
  });
});

// ─── Output Transformation ───────────────────────────────────────────────────

describe('F2P: Output Transformation', () => {
  const logger = new StructuredLogger('test-proc-deps');

  /**
   * F2P-18: Output is transformed before storing in context.outputs
   *
   * If a processor specifies an outputTransform, it should be applied to the
   * processor's output before storing in context.outputs. The original code
   * doesn't support this feature.
   *
   * Expected: Transformed output is stored, not the original output
   */
  it('F2P-18: output is transformed before storing in context.outputs', async () => {
    let outputStoredForA: unknown;

    const procA = createMockProcessor('procA', () => ({
      output: { original: 'data', sensitive: 'secret' },
    }));

    const procB = createMockProcessor('procB', (context) => {
      outputStoredForA = (context as any).outputs?.['procA'];
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        outputTransform: (output) => ({ original: (output as any).original }),
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(outputStoredForA).toEqual({ original: 'data' });
    expect((outputStoredForA as any)?.sensitive).toBeUndefined();
  });

  /**
   * F2P-19: Downstream processor receives transformed output
   *
   * The processor that reads a transformed output should see only the
   * transformed version, not the original output.
   *
   * Expected: Downstream processor can only access transformed fields
   */
  it('F2P-19: downstream processor receives transformed output', async () => {
    let fieldAAccessible = false;
    let fieldBAccessible = false;

    const procA = createMockProcessor('procA', () => ({
      output: { fieldA: 'keep', fieldB: 'remove' },
    }));

    const procB = createMockProcessor('procB', (context) => {
      const outputA = (context as any).outputs?.['procA'];
      fieldAAccessible = 'fieldA' in (outputA || {});
      fieldBAccessible = 'fieldB' in (outputA || {});
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        outputTransform: (output) => ({ fieldA: (output as any).fieldA }),
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(fieldAAccessible).toBe(true);
    expect(fieldBAccessible).toBe(false);
  });

  /**
   * F2P-20: Async transformation is properly awaited
   *
   * A transformation can be an async function. The pipeline must await
   * the transformation before storing the result.
   *
   * Expected: Async transformation resolves and result is correctly stored
   */
  it('F2P-20: async transformation is properly awaited', async () => {
    let transformExecuted = false;
    let outputStoredForA: unknown;

    const procA = createMockProcessor('procA', () => ({
      output: { value: 42 },
    }));

    const procB = createMockProcessor('procB', (context) => {
      outputStoredForA = (context as any).outputs?.['procA'];
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        outputTransform: async (output) => {
          transformExecuted = true;
          return { enriched: (output as any).value * 2 };
        },
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        options: {},
      },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(transformExecuted).toBe(true);
    expect((outputStoredForA as any)?.enriched).toBe(84);
  });

  /**
   * F2P-21: Multiple transformations chain correctly
   *
   * When procA transforms its output and procB depends on it (and also
   * transforms its output), procB should receive procA's transformed output
   * and transform it further.
   *
   * Expected: procC sees procB's transformed output (which was built from procA's transformed output)
   */
  it('F2P-21: multiple transformations chain correctly', async () => {
    let outputSeenByC: unknown;

    const procA = createMockProcessor('procA', () => ({
      output: { base: 10 },
    }));

    const procB = createMockProcessor('procB', (context) => {
      const inputFromA = (context as any).outputs?.['procA'];
      return { output: { result: (inputFromA as any)?.base * 2 } };
    });

    const procC = createMockProcessor('procC', (context) => {
      outputSeenByC = (context as any).outputs?.['procB'];
      return {};
    });

    const pipeline = buildPipeline([procA, procB, procC], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        outputTransform: (output) => ({ base: (output as any).base }),
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: ['procA'],
        outputTransform: (output) => ({ final: (output as any).result + 5 }),
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: ['procB'],
        options: {},
      },
    ]);

    await pipeline.execute({ content: 'test' });

    expect((outputSeenByC as any)?.final).toBe(25); // (10 * 2) + 5
  });
});

// ─── Runtime Processor Registration ──────────────────────────────────────────

describe('F2P: Runtime Processor Registration', () => {
  const logger = new StructuredLogger('test-proc-deps');

  /**
   * F2P-22: Processor can register a new processor mid-execution
   *
   * During execution, a processor should be able to register additional
   * processors with the pipeline. The original code doesn't support this.
   *
   * Expected: Newly registered processor is available and can be referenced
   */
  it('F2P-22: processor can register a new processor mid-execution', async () => {
    const procDef = createMockProcessor('procDynamic', () => ({ output: { dynamic: true } }));

    const procA = createMockProcessor('procA', (context) => {
      (context as any).registerProcessor?.(procDef, {
        id: 'procDynamic',
        enabled: true,
        order: 15,
        dependencyIds: [],
        options: {},
      });
      return {};
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.dynamicProcessors).toContain('procDynamic');
  });

  /**
   * F2P-23: Dynamically registered processor is topologically sorted
   *
   * When a processor is registered mid-execution with dependencies,
   * it must be topologically sorted into the execution order correctly.
   *
   * Expected: Dynamically registered processor executes in correct order relative to dependencies
   */
  it('F2P-23: dynamically registered processor is topologically sorted', async () => {
    const executionOrder: string[] = [];

    const procA = createMockProcessor('procA', (context) => {
      executionOrder.push('procA');
      const procDynamic = createMockProcessor('procDynamic', () => {
        executionOrder.push('procDynamic');
        return { output: {} };
      });
      (context as any).registerProcessor?.(procDynamic, {
        id: 'procDynamic',
        enabled: true,
        order: 25,
        dependencyIds: ['procA'],
        options: {},
      });
      return {};
    });

    const procB = createMockProcessor('procB', () => {
      executionOrder.push('procB');
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    const procDynamicIndex = executionOrder.indexOf('procDynamic');
    const procAIndex = executionOrder.indexOf('procA');
    expect(procDynamicIndex > procAIndex).toBe(true);
  });

  /**
   * F2P-24: Dynamically registered processor executes and produces output
   *
   * A processor registered mid-pipeline should execute and its output should
   * be available in context.outputs for later processors.
   *
   * Expected: Dynamically registered processor's output is in context.outputs
   */
  it('F2P-24: dynamically registered processor executes and produces output', async () => {
    let dynamicOutput: unknown;

    const procA = createMockProcessor('procA', (context) => {
      const procDynamic = createMockProcessor('procDynamic', () => ({
        output: { dynamicData: 'value' },
      }));
      (context as any).registerProcessor?.(procDynamic, {
        id: 'procDynamic',
        enabled: true,
        order: 15,
        dependencyIds: [],
        options: {},
      });
      return {};
    });

    const procB = createMockProcessor('procB', (context) => {
      dynamicOutput = (context as any).outputs?.['procDynamic'];
      return {};
    });

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(dynamicOutput).toBeDefined();
    expect((dynamicOutput as any)?.dynamicData).toBe('value');
  });

  /**
   * F2P-25: Result includes all dynamically registered processor IDs
   *
   * The pipeline result must track which processors were registered at runtime.
   *
   * Expected: result.dynamicProcessors contains all registered processor IDs
   */
  it('F2P-25: result includes all dynamically registered processor IDs', async () => {
    const procA = createMockProcessor('procA', (context) => {
      const procD = createMockProcessor('procD', () => ({ output: {} }));
      const procE = createMockProcessor('procE', () => ({ output: {} }));
      (context as any).registerProcessor?.(procD, {
        id: 'procD',
        enabled: true,
        order: 15,
        dependencyIds: [],
        options: {},
      });
      (context as any).registerProcessor?.(procE, {
        id: 'procE',
        enabled: true,
        order: 16,
        dependencyIds: [],
        options: {},
      });
      return {};
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.dynamicProcessors?.sort()).toEqual(['procD', 'procE']);
  });
});

// ─── Integration & Regression ────────────────────────────────────────────────

describe('F2P: Integration & Regression', () => {
  const logger = new StructuredLogger('test-proc-deps');

  /**
   * F2P-26: Complex pipeline with conditionals, transforms, and registrations works
   *
   * A realistic pipeline that combines conditional execution, output transformation,
   * and runtime registration should work correctly without deadlocks or infinite loops.
   *
   * Expected: Pipeline executes successfully with all features working together
   */
  it('F2P-26: complex pipeline with conditionals, transforms, and registrations works', async () => {
    const procA = createMockProcessor('procA', (context) => {
      const procDynamic = createMockProcessor('procDynamic', () => ({
        output: { injected: true },
      }));
      (context as any).registerProcessor?.(procDynamic, {
        id: 'procDynamic',
        enabled: true,
        order: 25,
        dependencyIds: [],
        options: {},
      });
      return { output: { initial: 'data' } };
    });

    const procB = createMockProcessor('procB', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => true,
        outputTransform: (output) => ({ transformed: (output as any).initial }),
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: [],
        condition: async () => true,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.skippedProcessors).toBeDefined();
    expect(result.dynamicProcessors).toContain('procDynamic');
  });

  /**
   * F2P-27: Original dependency ordering behavior is preserved
   *
   * When no new features (conditionals, transforms, registration) are used,
   * the pipeline should behave exactly like before.
   *
   * Expected: Basic topological sorting works unchanged
   */
  it('F2P-27: original dependency ordering behavior is preserved', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 20, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 10, dependencyIds: ['procA'], options: {} },
    ]);

    const registry = new ProcessorRegistry([procA, procB], logger);
    registry.loadRuntimeConfigs([
      { id: 'procA', enabled: true, order: 20, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 10, dependencyIds: ['procA'], options: {} },
    ]);

    const resolved = registry.resolve();
    expect(resolved[0].config.id).toBe('procA');
    expect(resolved[1].config.id).toBe('procB');
  });

  /**
   * F2P-28: Output isolation still prevents overwrites
   *
   * Output isolation should continue to work correctly even with new features.
   *
   * Expected: Isolated outputs prevent overwrites across the pipeline
   */
  it('F2P-28: output isolation still prevents overwrites', async () => {
    let outputsSeenByC: Record<string, unknown> | undefined;

    const procA = createMockProcessor('procA', () => ({
      output: { custom: { fromA: 'A' } },
    }));

    const procB = createMockProcessor('procB', () => ({
      output: { custom: { fromB: 'B' } },
    }));

    const procC = createMockProcessor('procC', (context) => {
      outputsSeenByC = { ...(context as any).outputs };
      return {};
    });

    const pipeline = buildPipeline([procA, procB, procC], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
      { id: 'procC', enabled: true, order: 30, dependencyIds: ['procA', 'procB'], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect((outputsSeenByC?.['procA'] as any)?.custom?.fromA).toBe('A');
    expect((outputsSeenByC?.['procB'] as any)?.custom?.fromB).toBe('B');
  });

  /**
   * F2P-29: Processor errors are caught and reported
   *
   * When a processor throws an error, it should be caught and reported
   * in the pipeline result without crashing the entire pipeline.
   *
   * Expected: Error is captured in result.errors or similar
   */
  it('F2P-29: processor errors are caught and reported', async () => {
    const procA = createMockProcessor('procA', () => {
      throw new Error('Test error');
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Test error');
  });
});
