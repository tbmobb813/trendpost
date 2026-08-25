import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';

export interface VerifyResult {
  ok: boolean;
  message: string;
}

// Every function here makes exactly one cheap, read-only, real call to the
// platform to confirm the supplied credentials work — it never persists,
// logs, or echoes back the credentials themselves. Error messages come from
// the platform's own API response text, which is safe to surface (it's
// never the secret itself, just what the platform said about it).

export async function verifyAnthropic(apiKey: string): Promise<VerifyResult> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true, message: 'Connected — API key valid.' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function verifyTwitter(
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string
): Promise<VerifyResult> {
  try {
    const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });
    const me = await client.v2.me();
    return { ok: true, message: `Connected as @${me.data.username}.` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function verifyLinkedin(accessToken: string, personUrn: string): Promise<VerifyResult> {
  try {
    const res = await fetch('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { ok: false, message: `LinkedIn returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { id?: string };
    if (personUrn.replace('urn:li:person:', '') !== body.id) {
      return {
        ok: false,
        message: `Token is valid, but the Person URN doesn't match — LinkedIn says your id is "${body.id}".`,
      };
    }
    return { ok: true, message: 'Connected — token and Person URN match.' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function verifyFacebook(accessToken: string, pageId: string): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}?fields=name&access_token=${encodeURIComponent(accessToken)}`
    );
    const body = (await res.json()) as { name?: string; error?: { message?: string } };
    if (!res.ok || body.error) return { ok: false, message: body.error?.message ?? `Facebook returned ${res.status}` };
    return { ok: true, message: `Connected to page "${body.name}".` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function verifyInstagram(accessToken: string, accountId: string): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}?fields=username&access_token=${encodeURIComponent(accessToken)}`
    );
    const body = (await res.json()) as { username?: string; error?: { message?: string } };
    if (!res.ok || body.error) return { ok: false, message: body.error?.message ?? `Instagram returned ${res.status}` };
    return { ok: true, message: `Connected as @${body.username}.` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
