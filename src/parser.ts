import { safeGetText } from './safe-http';

interface ParsedDoc {
  title: string;
  url: string;
  topic: string;
}

export async function parseLLMSTxt(llmsUrl: string): Promise<ParsedDoc[]> {
  const data = await safeGetText(llmsUrl, { allowHttp: false, allowHttps: true });
  const lines = data.split('\n');
  let topic = '';
  const docs: ParsedDoc[] = [];
  const topicRegex = /^##\s+(.+)/;
  const docRegex = /^- \[(.+?)\]\((https?:\/\/[^)]+\.md)\)(?::\s*(.*))?/;

  for (const line of lines) {
    const topicMatch = line.match(topicRegex);
    if (topicMatch) {
      topic = topicMatch[1].trim();
      continue;
    }
    const docMatch = line.match(docRegex);
    if (docMatch) {
      const title = docMatch[1].trim();
      let url = docMatch[2].trim();
      // Remove .md extension for direct URL
      if (url.endsWith('.md')) url = url.slice(0, -3);
      docs.push({ title, url, topic });
    }
  }
  return docs;
}
