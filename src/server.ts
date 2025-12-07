import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from './config';
import { parseLLMSTxt } from './parser';
import { uploadDocs } from './uploader';
import { createTask, updateTaskStatus, getTask } from './db';
import { syncStaleDocs } from './sync';

import { URL } from 'url';
const app = express();
app.disable('x-powered-by'); // Security: Disable X-Powered-By header
app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/upload', async (req: Request, res: Response) => {
  const { apiKey, llmsUrl, force, sync } = req.body;
  // SSRF prevention: restrict allowed llmsUrl hosts
  if (!isAllowedUrl(llmsUrl)) {
    return res.status(400).json({ error: 'Provided llmsUrl is not allowed.' });
  }
  const taskId = uuidv4();
  createTask({
    id: taskId,
    status: 'pending',
    progress: 0,
    startedAt: Date.now(),
  });
  res.json({ taskId });
  (async () => {
    try {
      console.log(`[${taskId}] Parsing llms.txt...`);
      updateTaskStatus(taskId, 'in_progress', 0, 'Parsing llms.txt');
      const config = getConfig({ apiKey, llmsUrl });
      const docs = await parseLLMSTxt(config.llmsUrl);
      console.log(`[${taskId}] Found ${docs.length} docs. Uploading...`);
      let lastProgress = 0;
      const summary = await uploadDocs(config, docs, (progress, message) => {
        lastProgress = progress;
        const pct = Math.round(progress * 100);
        console.log(`[${taskId}] [${pct}%] ${message}`);
        updateTaskStatus(taskId, 'in_progress', pct, message);
      }, force);
      console.log(`[${taskId}] --- Upload Summary ---`);
      console.log(`[${taskId}] Processed: ${summary.processed}`);
      console.log(`[${taskId}] Uploaded: ${summary.uploaded}`);
      console.log(`[${taskId}] Updated: ${summary.updated}`);
      console.log(`[${taskId}] Not Fetched: ${summary.notFetched}`);
      console.log(`[${taskId}] Errors: ${summary.errors}`);
      if (summary.notFetchedUrls.length > 0) {
        console.log(`[${taskId}] Docs not fetched (missing or unavailable):`);
        summary.notFetchedUrls.forEach(url => console.log(`[${taskId}]   ${url}`));
      }
      let syncResult = undefined;
      if (sync) {
        console.log(`[${taskId}] Syncing: Removing docs from KB not in llms.txt...`);
        updateTaskStatus(taskId, 'in_progress', 100, 'Syncing stale docs...');
        syncResult = await syncStaleDocs(config, docs);
        console.log(`[${taskId}] --- Sync Summary ---`);
        console.log(`[${taskId}] Deleted from KB: ${syncResult.deleted.length}`);
        if (syncResult.deleted.length > 0) {
          syncResult.deleted.forEach(url => console.log(`[${taskId}]   Deleted: ${url}`));
        }
        if (syncResult.skipped.length > 0) {
          console.log(`[${taskId}] Skipped (no documentID or error): ${syncResult.skipped.length}`);
          syncResult.skipped.forEach(url => console.log(`[${taskId}]   Skipped: ${url}`));
        }
      }
      console.log(`[${taskId}] Done!`);
      updateTaskStatus(taskId, 'done', 100, 'Done', Date.now());
    } catch (e: any) {
      console.error(`[${taskId}] Error:`, e.message);
      updateTaskStatus(taskId, 'error', 100, e.message, Date.now());
    }
  })();
});

// @ts-expect-error Express/TS overload quirk
app.get('/status/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
