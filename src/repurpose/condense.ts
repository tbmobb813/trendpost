import Anthropic from '@anthropic-ai/sdk';

const MAX_PASSTHROUGH_CHARS = 60_000;
const CHUNK_CHARS = 8_000;
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const client = new Anthropic();

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

async function summarizeChunk(chunk: string, index: number, total: number): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      'You extract the key points from a piece of a longer transcript or article. Be concrete — names, claims, numbers, examples. No commentary, no "this section discusses...".',
    messages: [
      {
        role: 'user',
        content: `This is part ${index + 1} of ${total} of a longer source document. Extract its key points as a dense bullet list.\n\n${chunk}`,
      },
    ],
  });
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Passes short sources straight through. Long sources (a full-episode
// transcript can run 10-15k+ words) get split into chunks, each summarized
// independently, then concatenated into one condensed brief that later
// generation prompts use instead of the raw text — one level of map-reduce,
// not a recursive reducer, since a single video/article never needs more
// than that to fit comfortably in a generation prompt.
export async function condenseIfNeeded(text: string): Promise<string> {
  if (text.length <= MAX_PASSTHROUGH_CHARS) return text;

  const chunks = chunkText(text, CHUNK_CHARS);
  const summaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    summaries.push(await summarizeChunk(chunks[i], i, chunks.length));
  }
  return summaries.join('\n\n');
}
