import { createHash } from 'node:crypto';
import { DEFERRAL_PROBLEMS, PLACEMENT_PROBLEMS, checkCrawlable } from './check-crawlable.js';

export interface AgentResponse {
  agent: string;
  body: string;
  contentEncoding: string | null;
}

export interface ResponseClass {
  agents: string[];
  bytes: number;
  digest: string;
  problems: string[];
  visibleBytes: number;
}

const HYDRATION_MARKER = 'self.__next_f';

export function classify(responses: AgentResponse[]): ResponseClass[] {
  const byDigest = new Map<string, ResponseClass>();

  for (const response of responses) {
    const digest = createHash('sha256').update(response.body).digest('hex');
    const already = byDigest.get(digest);
    if (already) {
      already.agents.push(response.agent);
      continue;
    }

    const marker = response.body.indexOf(HYDRATION_MARKER);
    byDigest.set(digest, {
      agents: [response.agent],
      bytes: Buffer.byteLength(response.body),
      digest,
      problems: checkCrawlable(response.body),
      visibleBytes: Buffer.byteLength(
        marker === -1 ? response.body : response.body.slice(0, marker),
      ),
    });
  }

  return [...byDigest.values()];
}

export function refusals(responses: AgentResponse[], classes: ResponseClass[]): string[] {
  const reasons: string[] = [];

  for (const response of responses) {
    if (response.body.includes('data-rudra-source="fallback"')) {
      reasons.push(`the shop served the deterministic fallback for ${response.agent}`);
    }
  }

  if (classes.length < 2) {
    reasons.push('only one response class, so the bot split was not exercised');
  }

  for (const response of responses) {
    const encoding = response.contentEncoding;
    if (encoding !== null && encoding !== 'identity') {
      reasons.push(
        `${response.agent} came back ${encoding}-encoded, so every byte count is the compressor’s`,
      );
    }
  }

  return reasons;
}

export function unstable(first: AgentResponse[], second: AgentResponse[]): string[] {
  const reasons: string[] = [];
  for (const [index, response] of first.entries()) {
    const again = second[index];
    if (again === undefined || again.body !== response.body) {
      reasons.push(
        `${response.agent} answered differently on a second pass, so this run is not reproducible`,
      );
    }
  }
  return reasons;
}

const PAGE_PATH = '/product/RJ-00001?shopper=S-0001';

const AGENTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
];

function shortName(agent: string): string {
  const match = /Googlebot\/2\.1|bingbot\/2\.0|Google-InspectionTool\/1\.0|Chrome\/[\d.]+/.exec(
    agent,
  );
  return match ? match[0] : agent.slice(0, 24);
}

export async function collect(origin: string): Promise<AgentResponse[]> {
  const responses: AgentResponse[] = [];
  for (const agent of AGENTS) {
    const response = await fetch(`${origin}${PAGE_PATH}`, {
      headers: { 'user-agent': agent, 'accept-encoding': 'identity' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${shortName(agent)} got ${response.status}`);
    responses.push({
      agent: shortName(agent),
      body: await response.text(),
      contentEncoding: response.headers.get('content-encoding'),
    });
  }
  return responses;
}

export function renderTable(classes: ResponseClass[]): string {
  const lines = [
    '| Agents | Body bytes | sha256 | Slot in position | Nothing hides it | Visible document | Never read |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of classes) {
    const misplaced = row.problems.some((problem) => PLACEMENT_PROBLEMS.includes(problem));
    const deferred = row.problems.some((problem) => DEFERRAL_PROBLEMS.includes(problem));
    const share = Math.round((1 - row.visibleBytes / row.bytes) * 100);
    lines.push(
      `| ${row.agents.join(', ')} | ${row.bytes} | \`${row.digest.slice(0, 12)}\` | ` +
        `${misplaced ? 'no' : 'yes'} | ${deferred ? 'no' : 'yes'} | ${row.visibleBytes} bytes | ${share}% |`,
    );
  }
  return lines.join('\n');
}
