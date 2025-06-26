import axios from 'axios';
import { Config } from './types';
import { getAllDocHashes, deleteDocHash } from './db';
import { getApiBaseUrl } from './config';

export async function syncStaleDocs(config: Config, currentDocs: { url: string }[]): Promise<{ deleted: string[]; skipped: string[] }> {
  const currentUrls = new Set(currentDocs.map(d => d.url));
  const allDbDocs = getAllDocHashes();
  const deleted: string[] = [];
  const skipped: string[] = [];
  const KB_DELETE_BASE = `${getApiBaseUrl()}/v1/knowledge-base/docs`;
  for (const dbDoc of allDbDocs) {
    if (!currentUrls.has(dbDoc.url)) {
      if (!dbDoc.documentID) {
        skipped.push(dbDoc.url);
        continue;
      }
      try {
        await axios.delete(`${KB_DELETE_BASE}/${dbDoc.documentID}`, {
          headers: { Authorization: config.apiKey },
        });
        deleteDocHash(dbDoc.url);
        deleted.push(dbDoc.url);
      } catch (e: any) {
        skipped.push(dbDoc.url);
      }
    }
  }
  return { deleted, skipped };
}
