import axios from 'axios';
import crypto from 'crypto';
import { Config, LLMSDocItem } from './types';
import { getDocHash, setDocHash } from './db';
import { getApiBaseUrl } from './config';
import { safeGetText } from './safe-http';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function uploadWithRetry(url: string, body: any, headers: any, maxRetries = 3): Promise<any> {
  let attempt = 0;
  let delay = 1000;
  while (attempt < maxRetries) {
    try {
      return await axios.post(url, body, { headers });
    } catch (e: any) {
      if (e.response && e.response.status === 429) {
        // Rate limit hit, wait and retry
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
        attempt++;
      } else {
        throw e;
      }
    }
  }
  throw new Error('Rate limit exceeded after retries');
}

interface UploadSummary {
  processed: number;
  uploaded: number;
  updated: number;
  errors: number;
  notFetched: number;
  notFetchedUrls: string[];
}

export async function uploadDocs(
  config: Config,
  docs: { title: string; url: string; topic: string }[],
  onProgress?: (progress: number, message: string) => void,
  force?: boolean
): Promise<UploadSummary> {
  let processed = 0;
  let uploaded = 0;
  let updated = 0;
  let errors = 0;
  let notFetched = 0;
  const notFetchedUrls: string[] = [];
  const KB_UPLOAD_URL = `${getApiBaseUrl()}/v1/knowledge-base/docs/upload/table`;
  for (const doc of docs) {
    onProgress?.(processed / docs.length, `Fetching ${doc.title}`);
    const mdUrl = doc.url + '.md';
    let content: string;
    try {
      content = await safeGetText(mdUrl, { allowHttp: true, allowHttps: true });
    } catch (e: any) {
      notFetched++;
      notFetchedUrls.push(mdUrl);
      onProgress?.((++processed) / docs.length, `Doc not fetched: ${doc.title}`);
      continue;
    }
    const hash = hashContent(content);
    const prevHash = getDocHash(doc.url);
    if (!force && prevHash === hash) {
      onProgress?.((++processed) / docs.length, `Skipped (no change): ${doc.title}`);
      continue;
    }
    const isUpdate = !!prevHash;
    // Ensure url is the source URL (without .md)
    const item: LLMSDocItem = {
      title: doc.title,
      content,
      url: doc.url, // already without .md from parser
      topic: doc.topic,
    };
    const body = {
      data: {
        name: doc.title,
        schema: {
          searchableFields: ['title', 'content'],
          metadataFields: ['topic','title','url'],
        },
        items: [item],
      },
    };
    const params = [
      'overwrite=true',
      'markdownConversion=false',
      'llmGeneratedQ=false',
      'llmPrependContext=true',
      'llmContentSummarization=false',
    ].join('&');
    try {
      const uploadRes = await uploadWithRetry(`${KB_UPLOAD_URL}?${params}`, body, {
        Authorization: config.apiKey,
        'Content-Type': 'application/json',
      });
      const documentID = uploadRes?.data?.data?.documentID;
      if (!documentID) {
        console.warn(`Warning: No documentID returned for ${doc.title}`);
      }
      setDocHash(doc.url, hash, documentID);
      if (isUpdate) {
        updated++;
        onProgress?.((++processed) / docs.length, `Updated: ${doc.title}`);
      } else {
        uploaded++;
        onProgress?.((++processed) / docs.length, `Uploaded: ${doc.title}`);
      }
    } catch (e: any) {
      errors++;
      onProgress?.((++processed) / docs.length, `Error uploading: ${doc.title}`);
    }
  }
  return {
    processed: docs.length,
    uploaded,
    updated,
    errors,
    notFetched,
    notFetchedUrls,
  };
}
