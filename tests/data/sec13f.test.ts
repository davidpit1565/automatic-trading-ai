import { describe, expect, it, vi } from 'vitest';
import { parseInformationTable, Sec13FSource, TOP_INVESTORS } from '../../src/core/data/sec13f';

const ATOM_FEED = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <accession-number>0001193125-26-352200</accession-number>
    <filing-date>2026-08-14</filing-date>
    <filing-type>13F-HR</filing-type>
  </entry>
</feed>`;

const INDEX_HTML = `<html><body>
  <a href="/Archives/edgar/data/1067983/000119312526352200/56757.xml">56757.xml</a>
  <a href="/Archives/edgar/data/1067983/000119312526352200/primary_doc.xml">primary_doc.xml</a>
</body></html>`;

function infoTable(issuerName: string, cusip: string, value: number, shares: number): string {
  return `<infoTable>
    <nameOfIssuer>${issuerName}</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>${cusip}</cusip>
    <value>${value}</value>
    <shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>`;
}

const HOLDINGS_XML = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  ${infoTable('APPLE INC', '037833100', 500_000_000, 2_000_000)}
  ${infoTable('SOME UNRELATED COMPANY INC', '999999999', 1_000_000, 5_000)}
</informationTable>`;

function sequentialFetch(responses: string[]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = responses[call];
    call++;
    if (body === undefined) throw new Error('no more mocked responses');
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe('Sec13FSource.fetchLatest (real-network shape, mocked here)', () => {
  it('walks feed -> filing index -> holdings XML and matches our own tracked symbols only', async () => {
    const source = new Sec13FSource({ fetchFn: sequentialFetch([ATOM_FEED, INDEX_HTML, HOLDINGS_XML]) });
    const result = await source.fetchLatest(TOP_INVESTORS[0]!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.investor).toBe('Berkshire Hathaway');
    expect(result.value.filedAt).toBe('2026-08-14');
    // Only AAPL matched — the unrelated company is real data from the filing
    // but isn't in our tracked universe, so it must not appear.
    expect(result.value.matched).toEqual([
      { issuerName: 'APPLE INC', cusip: '037833100', valueUsd: 500_000_000, shares: 2_000_000, symbol: 'AAPL' },
    ]);
  });

  it('aggregates a position split across several manager sub-accounts into one total', async () => {
    // A large filer reports one true position as several <infoTable> rows
    // (one per managing sub-account) — verified against a real Berkshire
    // filing, where AAPL appeared 11 times. Unaggregated, this would look
    // like several separate holdings instead of one.
    const splitHoldingsXml = `<informationTable>
      ${infoTable('APPLE INC', '037833100', 300_000_000, 1_000_000)}
      ${infoTable('APPLE INC', '037833100', 200_000_000, 500_000)}
    </informationTable>`;
    const source = new Sec13FSource({ fetchFn: sequentialFetch([ATOM_FEED, INDEX_HTML, splitHoldingsXml]) });
    const result = await source.fetchLatest(TOP_INVESTORS[0]!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched).toEqual([
      { issuerName: 'APPLE INC', cusip: '037833100', valueUsd: 500_000_000, shares: 1_500_000, symbol: 'AAPL' },
    ]);
  });

  it('errors cleanly when the feed has no 13F-HR entry at all', async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    const source = new Sec13FSource({ fetchFn: sequentialFetch([emptyFeed]) });
    const result = await source.fetchLatest(TOP_INVESTORS[0]!);
    expect(result.ok).toBe(false);
  });

  it('errors cleanly when the filing index has no non-cover-page XML document', async () => {
    const onlyCoverPage = `<html><body><a href="/Archives/edgar/data/1067983/x/primary_doc.xml">primary_doc.xml</a></body></html>`;
    const source = new Sec13FSource({ fetchFn: sequentialFetch([ATOM_FEED, onlyCoverPage]) });
    const result = await source.fetchLatest(TOP_INVESTORS[0]!);
    expect(result.ok).toBe(false);
  });

  it('retries a transient 503 from the feed endpoint and then succeeds', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchFn = (async () => {
      call++;
      if (call === 1) return new Response('', { status: 503 });
      const responses = [ATOM_FEED, INDEX_HTML, HOLDINGS_XML];
      return new Response(responses[call - 2]!, { status: 200 });
    }) as unknown as typeof fetch;
    const source = new Sec13FSource({ fetchFn });
    const promise = source.fetchLatest(TOP_INVESTORS[0]!);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    vi.useRealTimers();
  });

  it('does not retry a non-transient 404 and reports it immediately', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const source = new Sec13FSource({ fetchFn });
    const result = await source.fetchLatest(TOP_INVESTORS[0]!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('404');
  });
});

describe('parseInformationTable', () => {
  it('extracts every well-formed <infoTable> block', () => {
    const holdings = parseInformationTable(HOLDINGS_XML);
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toEqual({
      issuerName: 'APPLE INC',
      cusip: '037833100',
      valueUsd: 500_000_000,
      shares: 2_000_000,
    });
  });

  it('skips a block missing a required field rather than fabricating one', () => {
    const missingCusip = `<infoTable><nameOfIssuer>X CORP</nameOfIssuer><value>100</value>
      <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt></infoTable>`;
    expect(parseInformationTable(missingCusip)).toEqual([]);
  });

  it('returns an empty array for XML with no infoTable blocks', () => {
    expect(parseInformationTable('<informationTable></informationTable>')).toEqual([]);
  });
});
