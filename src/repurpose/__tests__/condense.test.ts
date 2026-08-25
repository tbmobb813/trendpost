// condense.ts constructs its Anthropic client at module load time, which
// happens as soon as this file's `import { condenseIfNeeded }` runs — and
// module imports are hoisted above plain statements in the compiled
// output, so a `const mockCreate = jest.fn()` declared "before" the
// jest.mock() call here would actually still be undefined when the
// factory executes. Routing through a global sidesteps that ordering
// entirely: the factory is self-contained (no captured outer variable),
// and test code reaches the same jest.fn() afterwards via the global.
jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  (globalThis as Record<string, unknown>).__anthropicMockCreate = create;
  return jest.fn().mockImplementation(() => ({ messages: { create } }));
});

import { condenseIfNeeded } from '../condense';

const mockCreate = (globalThis as Record<string, unknown>).__anthropicMockCreate as jest.Mock;

describe('condenseIfNeeded()', () => {
  beforeEach(() => mockCreate.mockReset());

  it('passes short text through unchanged, without calling the LLM', async () => {
    const short = 'A short piece of source text.';
    const result = await condenseIfNeeded(short);
    expect(result).toBe(short);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('chunks and summarizes long text, calling the LLM once per chunk', async () => {
    const long = 'x'.repeat(150_000); // well over the 60k passthrough threshold
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'summary of a chunk' }],
    });

    const result = await condenseIfNeeded(long);

    // 150k chars / 8k-char chunks = 19 chunks
    expect(mockCreate).toHaveBeenCalledTimes(19);
    expect(result).toContain('summary of a chunk');
    expect(result.length).toBeLessThan(long.length);
  });
});
