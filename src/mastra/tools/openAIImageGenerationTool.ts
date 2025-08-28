import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), 'yamaki', '.mastra', 'output', 'images');
const DEFAULT_MAX_PROMPT_CHARS = 1200; // 過剰入力を避けるため保守的に短縮
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 600;

function normalizeAndTruncatePrompt(input: string, maxChars = DEFAULT_MAX_PROMPT_CHARS): string {
  const normalized = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const suffix = ' …';
  return normalized.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const openAIImageGenerationTool = createTool({
  id: 'openai-image-generate',
  description: 'Generate an image using OpenAI Images API with OPENAI_API_KEY.',
  inputSchema: z.object({
    prompt: z.string().min(1).describe('Image description prompt'),
    size: z.enum(['512x512', '768x768', '1024x1024']).default('1024x1024').describe('Output image size'),
    mimeType: z.enum(['image/png', 'image/jpeg']).default('image/png').describe('Output MIME type'),
  }),
  outputSchema: z.object({
    url: z.string().optional(),
    dataUrl: z.string().optional(),
    base64: z.string(),
    filePath: z.string().optional(),
    mimeType: z.string(),
    usedPrompt: z.string(),
  }),
  execute: async ({ context }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const { prompt, size, mimeType } = context;

    const initialPrompt = normalizeAndTruncatePrompt(prompt, DEFAULT_MAX_PROMPT_CHARS);

    const endpoint = 'https://api.openai.com/v1/images/generations';

    async function requestWithRetry(promptText: string) {
      let lastErrorText = '';
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const body: Record<string, unknown> = {
          model: 'gpt-image-1',
          prompt: promptText,
          size,
          n: 1,
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        const text = await res.text();
        if (res.ok) {
          try {
            return JSON.parse(text);
          } catch {
            throw new Error(`OpenAI Image API invalid JSON response: ${text.slice(0, 500)}...`);
          }
        }

        lastErrorText = text;

        // レートリミット/一時障害 → バックオフ再試行
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter)
            ? Math.max(0, Math.floor(retryAfter * 1000))
            : Math.floor(BASE_BACKOFF_MS * Math.pow(2, attempt) * (1 + Math.random() * 0.2));
          await sleep(delay);
          continue;
        }

        // 入力過長など → 一度だけさらに短縮して再試行
        if (
          res.status === 400 &&
          /context|length|too\s+long|maximum/i.test(text)
        ) {
          const shorter = normalizeAndTruncatePrompt(prompt, 600);
          if (shorter !== promptText) {
            promptText = shorter;
            continue;
          }
        }

        // それ以外は打ち切り
        throw new Error(`OpenAI Image API error: ${res.status} ${res.statusText} - ${text}`);
      }
      throw new Error(`OpenAI Image API error (retries exhausted): ${lastErrorText.slice(0, 500)}...`);
    }

    const data = await requestWithRetry(initialPrompt);

    // OpenAI Images API default response example:
    // { data: [ { url: 'https://...' } ] }  or  { data: [ { b64_json: '...' } ] }
    // まずはURLを優先し、無ければb64_jsonを利用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first: any = (data as any)?.data?.[0];
    let base64: string | undefined;
    let remoteUrl: string | undefined = first?.url;
    if (!remoteUrl && typeof first?.b64_json === 'string') {
      base64 = first.b64_json;
    }

    // URLが返ってきた場合は取得してbase64化
    if (remoteUrl) {
      const imgRes = await fetch(remoteUrl);
      if (!imgRes.ok) {
        throw new Error(`Failed to fetch image from returned URL: ${imgRes.status} ${imgRes.statusText}`);
      }
      const arrayBuffer = await imgRes.arrayBuffer();
      base64 = Buffer.from(arrayBuffer).toString('base64');
    }

    if (!base64) {
      throw new Error(`Cannot locate image data in OpenAI response: ${JSON.stringify(data).slice(0, 500)}...`);
    }

    // Ensure output dir exists
    await mkdir(OUTPUT_DIR, { recursive: true });

    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const fileName = `image_${Date.now()}.${ext}`;
    const filePath = join(OUTPUT_DIR, fileName);

    await writeFile(filePath, Buffer.from(base64, 'base64'));

    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      url: `file://${filePath}`,
      dataUrl,
      base64,
      filePath,
      mimeType,
      usedPrompt: initialPrompt,
    };
  },
});
