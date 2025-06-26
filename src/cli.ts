#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from './config';
import { parseLLMSTxt } from './parser';
import { uploadDocs } from './uploader';
import { syncStaleDocs } from './sync';

const program = new Command();

program
  .command('upload')
  .option('--api-key <apiKey>', 'Voiceflow KB API key')
  .option('--llms-url <llmsUrl>', 'llms.txt URL')
  .option('--force', 'Force upload all docs, ignoring hash')
  .option('--sync', 'After upload, remove docs from KB that are not in llms.txt')
  .action(async (opts) => {
    try {
      const config = getConfig({ apiKey: opts.apiKey, llmsUrl: opts.llmsUrl });
      if (!config.apiKey || !config.llmsUrl) {
        console.error(chalk.red('API key and llms.txt URL are required.'));
        process.exit(1);
      }
      console.log(chalk.blue('Parsing llms.txt...'));
      const docs = await parseLLMSTxt(config.llmsUrl);
      console.log(chalk.blue(`Found ${docs.length} docs. Uploading...`));
      const summary = await uploadDocs(config, docs, (progress, message) => {
        const pct = Math.round(progress * 100);
        console.log(chalk.green(`[${pct}%] ${message}`));
      }, opts.force);
      console.log(chalk.yellow('\n--- Upload Summary ---'));
      console.log(chalk.yellow(`Processed: ${summary.processed}`));
      console.log(chalk.yellow(`Uploaded: ${summary.uploaded}`));
      console.log(chalk.yellow(`Updated: ${summary.updated}`));
      console.log(chalk.yellow(`Not Fetched: ${summary.notFetched}`));
      console.log(chalk.yellow(`Errors: ${summary.errors}`));
      if (summary.notFetchedUrls.length > 0) {
        console.log(chalk.red('\nDocs not fetched (missing or unavailable):'));
        summary.notFetchedUrls.forEach(url => console.log(chalk.red(url)));
      }
      if (opts.sync) {
        console.log(chalk.blue('\nSyncing: Removing docs from KB not in llms.txt...'));
        const syncResult = await syncStaleDocs(config, docs);
        console.log(chalk.yellow(`Deleted from KB: ${syncResult.deleted.length}`));
        if (syncResult.deleted.length > 0) {
          syncResult.deleted.forEach(url => console.log(chalk.yellow(`  Deleted: ${url}`)));
        }
        if (syncResult.skipped.length > 0) {
          console.log(chalk.red(`Skipped (no documentID or error): ${syncResult.skipped.length}`));
          syncResult.skipped.forEach(url => console.log(chalk.red(`  Skipped: ${url}`)));
        }
      }
      console.log(chalk.green('Done!'));
      process.exit(0);
    } catch (e: any) {
      console.error(chalk.red('Error:'), e.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
