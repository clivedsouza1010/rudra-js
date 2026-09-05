import { describe, expect, it } from 'vitest';
import { classify, refusals, unstable, type AgentResponse } from './matrix.js';

const GOOD = `<!DOCTYPE html><html><head></head><body><main><h1>Shoe</h1><section data-rudra-slot="recommendations"><h2>Picked for you</h2></section></main><script>self.__next_f.push([1,"x"])</script></body></html>`;

const OTHER = GOOD.replace('<body><main>', '<body><div hidden=""></div><main>');

const response = (agent: string, overrides: Partial<AgentResponse> = {}): AgentResponse => ({
  agent,
  body: GOOD,
  contentEncoding: null,
  ...overrides,
});

describe('grouping responses into classes', () => {
  it('puts agents that got the same bytes in one row', () => {
    const classes = classify([response('googlebot'), response('chrome')]);

    expect(classes).toHaveLength(1);
    expect(classes[0]!.agents).toEqual(['googlebot', 'chrome']);
    expect(classes[0]!.bytes).toBe(GOOD.length);
  });

  it('splits agents that got different bytes', () => {
    const classes = classify([
      response('googlebot'),
      response('bingbot', { body: OTHER }),
      response('inspection', { body: OTHER }),
    ]);

    expect(classes.map((row) => row.agents)).toEqual([['googlebot'], ['bingbot', 'inspection']]);
    expect(classes[0]!.digest).not.toBe(classes[1]!.digest);
  });

  it('counts the visible document up to the hydration script, not the whole body', () => {
    const classes = classify([response('googlebot')]);

    expect(classes[0]!.visibleBytes).toBe(GOOD.indexOf('self.__next_f'));
    expect(classes[0]!.visibleBytes).toBeLessThan(classes[0]!.bytes);
  });

  it('treats a body with no hydration script as visible all through', () => {
    const plain = '<main><section data-rudra-slot="x"></section></main>';
    const classes = classify([response('curl', { body: plain })]);

    expect(classes[0]!.visibleBytes).toBe(plain.length);
  });

  it('carries what the checker found, per class', () => {
    const deferred = `<main></main><div hidden id="S:0"><section data-rudra-slot="x"></section></div><script>$RC("B:0","S:0")</script>`;
    const classes = classify([response('googlebot'), response('bingbot', { body: deferred })]);

    expect(classes[0]!.problems).toEqual([]);
    expect(classes[1]!.problems.length).toBeGreaterThan(0);
  });
});

describe('when the run must refuse rather than print', () => {
  const twoClasses = [response('googlebot'), response('bingbot', { body: OTHER })];

  it('accepts a clean pair of classes', () => {
    expect(refusals(twoClasses, classify(twoClasses))).toEqual([]);
  });

  it('refuses a page that came from the fallback, and names the agent', () => {
    const fallback = GOOD.replace('<main>', '<main data-rudra-source="fallback">');
    const responses = [response('googlebot', { body: fallback }), response('bingbot')];

    expect(refusals(responses, classify(responses))).toEqual([
      'the shop served the deterministic fallback for googlebot',
    ]);
  });

  it('refuses when every agent got the same response', () => {
    const responses = [response('googlebot'), response('bingbot')];

    expect(refusals(responses, classify(responses))).toEqual([
      'only one response class, so the bot split was not exercised',
    ]);
  });

  it('refuses when something compressed a reply we asked not to be compressed', () => {
    const responses = [
      response('googlebot', { contentEncoding: 'gzip' }),
      response('bingbot', { body: OTHER }),
    ];

    expect(refusals(responses, classify(responses))).toEqual([
      'googlebot came back gzip-encoded, so every byte count is the compressor’s',
    ]);
  });

  it('lets identity through, since that is what was asked for', () => {
    const responses = [
      response('googlebot', { contentEncoding: 'identity' }),
      response('bingbot', { body: OTHER }),
    ];

    expect(refusals(responses, classify(responses))).toEqual([]);
  });
});

describe('checking the run repeated itself', () => {
  it('passes when both passes agree', () => {
    const pass = [response('googlebot'), response('bingbot', { body: OTHER })];

    expect(unstable(pass, pass)).toEqual([]);
  });

  it('names an agent whose answer moved between passes', () => {
    const first = [response('googlebot'), response('bingbot', { body: OTHER })];
    const second = [response('googlebot', { body: OTHER }), response('bingbot', { body: OTHER })];

    expect(unstable(first, second)).toEqual([
      'googlebot answered differently on a second pass, so this run is not reproducible',
    ]);
  });

  it('names an agent that went missing', () => {
    const first = [response('googlebot'), response('bingbot')];

    expect(unstable(first, [response('googlebot')])).toEqual([
      'bingbot answered differently on a second pass, so this run is not reproducible',
    ]);
  });
});
