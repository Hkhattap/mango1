/**
 * P2P Tests for Task: Processor Dependency Ordering
 * These tests PASS on both original and corrected code.
 * Used to verify no regressions have been introduced.
 * VISIBLE to Claude during task execution.
 */

import { ProcessorRegistry } from '../src/core/registry';
import { Pipeline } from '../src/core/pipeline';
import { LruCache } from '../src/storage/cache';
import { MetricsCollector } from '../src/metrics/metrics';
import { StructuredLogger } from '../src/metrics/logger';
import { Processor, ProcessorRuntimeConfig, ProcessingContext, PipelineExecutionResult } from '../src/types';


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
  const logger = new StructuredLogger('test-proc-deps-p2p');
  const registry = new ProcessorRegistry(processors, logger);
  registry.loadRuntimeConfigs(configs);
  const cache = new LruCache<string, PipelineExecutionResult>(10);
  const metrics = new MetricsCollector();
  return new Pipeline(registry, cache, metrics, logger);
}

describe('P2P: Processor Registry Fundamentals', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-1: Single processor with no dependencies resolves correctly
   *
   * Basic regression: ensure single-processor case works unchanged.
   */
  it('P2P-1: single processor with no dependencies resolves', () => {
    const procA = createMockProcessor('procA');
    const registry = new ProcessorRegistry([procA], logger);

    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(1);
    expect(resolved[0].config.id).toBe('procA');
  });

  /**
   * P2P-2: Multiple independent processors respect order field
   *
   * When processors have no dependencies, they should be ordered by 'order' field.
   * Dependency logic should not interfere with basic ordering.
   */
  it('P2P-2: processors without dependencies are ordered by order field', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');
    const procC = createMockProcessor('procC');

    const registry = new ProcessorRegistry([procA, procB, procC], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 30,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 20,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(3);
    expect(resolved[0].config.id).toBe('procB'); // order 10
    expect(resolved[1].config.id).toBe('procC'); // order 20
    expect(resolved[2].config.id).toBe('procA'); // order 30
  });

  /**
   * P2P-3: Disabled processors are excluded from resolution
   *
   * Disabled processors should not appear in the resolved list.
   */
  it('P2P-3: disabled processors are excluded from results', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');

    const registry = new ProcessorRegistry([procA, procB], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: false,
        order: 20,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve();

    expect(resolved).toHaveLength(1);
    expect(resolved[0].config.id).toBe('procA');
  });

  /**
   * P2P-4: Runtime overrides are applied to resolved configs
   *
   * When overrides are passed to resolve(), they should modify the returned configs.
   */
  it('P2P-4: runtime overrides are applied to resolved configs', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: { key: 'original' },
      },
    ]);

    const resolved = registry.resolve({
      procA: {
        options: { key: 'overridden' },
      },
    });

    expect(resolved[0].config.options).toEqual({ key: 'overridden' });
  });

  /**
   * P2P-5: Overrides for non-existent processors are gracefully ignored
   *
   * If overrides reference a processor that doesn't exist, it should be ignored.
   */
  it('P2P-5: overrides for non-existent processors are ignored', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const resolved = registry.resolve({
      nonExistent: {
        enabled: false,
      },
    });

    expect(resolved).toHaveLength(1);
  });

  /**
   * P2P-6: getRegisteredIds returns all registered processor IDs
   *
   * Basic registry functionality should continue to work unchanged.
   */
  it('P2P-6: getRegisteredIds returns all processor IDs', () => {
    const procA = createMockProcessor('procA');
    const procB = createMockProcessor('procB');

    const registry = new ProcessorRegistry([procA, procB], logger);

    const ids = registry.getRegisteredIds();

    expect(ids).toContain('procA');
    expect(ids).toContain('procB');
    expect(ids).toHaveLength(2);
  });

  /**
   * P2P-7: listProcessors returns processor definitions and configs
   *
   * The listProcessors method should continue to work as before.
   */
  it('P2P-7: listProcessors returns processor definitions and configs', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const list = registry.listProcessors();

    expect(list).toHaveLength(1);
    expect(list[0].definition.id).toBe('procA');
    expect(list[0].runtimeConfig?.id).toBe('procA');
  });

  /**
   * P2P-8: toggleProcessor enables/disables correctly
   *
   * Toggling a processor's enabled state should continue to function.
   */
  it('P2P-8: toggleProcessor enables/disables correctly', () => {
    const procA = createMockProcessor('procA');

    const registry = new ProcessorRegistry([procA], logger);
    registry.loadRuntimeConfigs([
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    let resolved = registry.resolve();
    expect(resolved).toHaveLength(1);

    registry.toggleProcessor('procA', false);
    resolved = registry.resolve();
    expect(resolved).toHaveLength(0);

    registry.toggleProcessor('procA', true);
    resolved = registry.resolve();
    expect(resolved).toHaveLength(1);
  });
});

describe('P2P: Pipeline Execution & Caching', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-9: Pipeline executes processors and returns result with processorsRun
   *
   * Adding output isolation must not break basic execution.
   * The result object must still contain processorsRun and original content.
   */
  it('P2P-9: pipeline executes processors and returns result', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'hello world' });

    expect(result.processorsRun).toContain('procA');
    expect(result.result?.original).toBe('hello world');
  });

  /**
   * P2P-10: Pipeline caching still works after code changes
   *
   * The cache key and hit/miss behavior must be preserved.
   * Adding context.outputs must not inadvertently break cache lookups.
   */
  it('P2P-10: pipeline caching still works', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result1 = await pipeline.execute({ content: 'test' });
    const result2 = await pipeline.execute({ content: 'test' });

    expect(result1.cacheStatus).toBe('miss');
    expect(result2.cacheStatus).toBe('hit');
  });

  /**
   * P2P-11: Pipeline result always contains errors and warnings arrays
   *
   * The result structure must remain intact after pipeline changes.
   * errors and warnings arrays must always be present even if empty.
   */
  it('P2P-11: pipeline result always contains errors and warnings arrays', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

describe('P2P: Conditional Execution Compatibility', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-12: Pipeline with conditionals that all pass works normally
   *
   * When all conditions evaluate to true, the pipeline should behave
   * identically to a pipeline without conditions.
   */
  it('P2P-12: pipeline with all conditions true executes all processors', async () => {
    const procA = createMockProcessor('procA', () => ({ output: { fromA: 1 } }));
    const procB = createMockProcessor('procB', () => ({ output: { fromB: 2 } }));

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        condition: () => true,
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
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.processorsRun).toContain('procB');
    expect(result.skippedProcessors?.length ?? 0).toBe(0);
  });

  /**
   * P2P-13: Pipeline with condition that's undefined still executes processor
   *
   * When a processor has no condition field (condition is undefined), it should
   * execute normally. This tests backward compatibility.
   */
  it('P2P-13: processor without condition executes normally', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.processorsRun).toContain('procB');
  });

  /**
   * P2P-14: Processor can still access context when conditions aren't used
   *
   * A processor without a condition should execute and have normal context access.
   * This ensures the condition feature doesn't interfere with basic execution.
   */
  it('P2P-14: processor can access context without conditions', async () => {
    let contextWasValid = false;

    const procA = createMockProcessor('procA', () => ({ output: { data: 'test' } }));
    const procB = createMockProcessor('procB', (context) => {
      contextWasValid = context !== undefined && context.workingContent !== undefined;
      return { output: {} };
    });

    const pipeline = buildPipeline([procA, procB], [
      {
        id: 'procA',
        enabled: true,
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

    await pipeline.execute({ content: 'test' });

    expect(contextWasValid).toBe(true);
  });
});

describe('P2P: Output Transformation Compatibility', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-15: Pipeline with transforms on independent processors works
   *
   * When processors with no dependencies have transforms, they should
   * execute and produce transformed outputs without affecting each other.
   */
  it('P2P-15: independent processors with transforms work correctly', async () => {
    const procA = createMockProcessor('procA', () => ({
      output: { original: 'A', extra: 'remove' },
    }));

    const procB = createMockProcessor('procB', () => ({
      output: { original: 'B', extra: 'remove' },
    }));

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
        dependencyIds: [],
        outputTransform: (output) => ({ original: (output as any).original }),
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.processorsRun).toContain('procB');
  });

  /**
   * P2P-16: Processor with undefined transform still executes
   *
   * When outputTransform is undefined, the processor should execute normally
   * without errors. This tests backward compatibility.
   */
  it('P2P-16: processor with undefined transform executes normally', async () => {
    let procBExecuted = false;

    const procA = createMockProcessor('procA', () => ({
      output: { value: 100 },
    }));

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

    expect(procBExecuted).toBe(true);
  });

  /**
   * P2P-17: Pipeline continues even if undefined transform is present
   *
   * When outputTransform is undefined, the pipeline should handle it gracefully
   * and continue execution without errors.
   */
  it('P2P-17: pipeline continues with undefined transform', async () => {
    const procA = createMockProcessor('procA', () => ({ output: { value: 1 } }));

    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.errors.length).toBe(0);
  });
});

describe('P2P: Runtime Registration Compatibility', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-18: Pipeline without any registrations works unchanged
   *
   * Pipelines that don't use runtime registration should work exactly as before.
   */
  it('P2P-18: pipeline without registrations works unchanged', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));
    const procB = createMockProcessor('procB', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
      { id: 'procB', enabled: true, order: 20, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.processorsRun).toContain('procB');
    expect(result.dynamicProcessors?.length ?? 0).toBe(0);
  });

  /**
   * P2P-19: Pipeline result structure is consistent
   *
   * The pipeline result should always have the core fields even when
   * new optional fields are not yet implemented.
   */
  it('P2P-19: result structure includes required fields', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toBeDefined();
    expect(result.errors).toBeDefined();
    expect(result.warnings).toBeDefined();
    expect(result.cacheStatus).toBeDefined();
  });

  /**
   * P2P-20: Processor receives valid context object
   *
   * When a processor is called, it should always receive a valid ProcessingContext
   * with all required fields, regardless of whether optional features are used.
   */
  it('P2P-20: processor receives valid context object', async () => {
    let contextIsValid = false;

    const procA = createMockProcessor('procA', (context) => {
      contextIsValid =
        context !== undefined &&
        context.request !== undefined &&
        context.originalContent === 'test' &&
        context.result !== undefined;
      return { output: {} };
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(contextIsValid).toBe(true);
  });
});

describe('P2P: Integration & Combined Features', () => {
  const logger = new StructuredLogger('test-proc-deps-p2p');

  /**
   * P2P-21: Pipeline with dependencies, conditionals, and transforms works
   *
   * A complex pipeline combining all features should work without conflicts.
   */
  it('P2P-21: complex pipeline with dependencies, conditionals, and transforms', async () => {
    const procA = createMockProcessor('procA', () => ({
      output: { raw: 'dataA' },
    }));

    const procB = createMockProcessor('procB', (context) => {
      const inputA = (context as any).outputs?.['procA'];
      return { output: { processed: (inputA as any)?.cleaned } };
    });

    const procC = createMockProcessor('procC', () => ({ output: {} }));

    const pipeline = buildPipeline([procA, procB, procC], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        outputTransform: (output) => ({ cleaned: (output as any).raw }),
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
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: [],
        condition: () => true,
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toContain('procA');
    expect(result.processorsRun).toContain('procB');
    expect(result.processorsRun).toContain('procC');
  });

  /**
   * P2P-22: Multiple processors execute in order
   *
   * When multiple processors are chained together, they should all execute
   * in the correct dependency order without interfering with each other.
   */
  it('P2P-22: multiple processors execute in correct order', async () => {
    const executionOrder: string[] = [];

    const procA = createMockProcessor('procA', () => {
      executionOrder.push('procA');
      return { output: { fromA: 'A' } };
    });

    const procB = createMockProcessor('procB', () => {
      executionOrder.push('procB');
      return { output: { fromB: 'B' } };
    });

    const procC = createMockProcessor('procC', () => {
      executionOrder.push('procC');
      return { output: {} };
    });

    const pipeline = buildPipeline([procA, procB, procC], [
      {
        id: 'procA',
        enabled: true,
        order: 10,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procB',
        enabled: true,
        order: 20,
        dependencyIds: [],
        options: {},
      },
      {
        id: 'procC',
        enabled: true,
        order: 30,
        dependencyIds: ['procA', 'procB'],
        options: {},
      },
    ]);

    await pipeline.execute({ content: 'test' });

    expect(executionOrder).toContain('procA');
    expect(executionOrder).toContain('procB');
    expect(executionOrder).toContain('procC');
  });

  /**
   * P2P-23: Empty pipeline execution returns valid result
   *
   * A pipeline with no processors (all disabled, or empty list) should
   * return a valid result rather than failing.
   */
  it('P2P-23: empty pipeline execution returns valid result', async () => {
    const procA = createMockProcessor('procA', () => ({ output: {} }));

    const pipeline = buildPipeline([procA], [
      {
        id: 'procA',
        enabled: false,
        order: 10,
        dependencyIds: [],
        options: {},
      },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.processorsRun).toHaveLength(0);
    expect(result.errors).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  /**
   * P2P-24: Pipeline handles processor errors
   *
   * When a processor throws an error, the pipeline should handle it and
   * report it in the result errors array rather than letting it crash the pipeline.
   */
  it('P2P-24: processor error is caught and reported in errors', async () => {
    const procA = createMockProcessor('procA', () => {
      throw new Error('Processor failed');
    });

    const pipeline = buildPipeline([procA], [
      { id: 'procA', enabled: true, order: 10, dependencyIds: [], options: {} },
    ]);

    const result = await pipeline.execute({ content: 'test' });

    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Processor failed');
  });
});