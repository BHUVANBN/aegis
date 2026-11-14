import { DefaultAzureCredential } from '@azure/identity';

export interface ResourceGraphClient {
  /** Runs a KQL query across the given subscriptions, following pagination; rows are plain objects. */
  query(kql: string, subscriptions: string[]): Promise<Record<string, unknown>[]>;
}

const ENDPOINT =
  'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01';
const MAX_PAGES = 20;

/** Real client: uses the managed identity (or developer `az login`) via DefaultAzureCredential. Fixed host => no SSRF surface. */
export class AzureResourceGraphClient implements ResourceGraphClient {
  private cred = new DefaultAzureCredential();

  async query(kql: string, subscriptions: string[]): Promise<Record<string, unknown>[]> {
    if (subscriptions.length === 0) throw new Error('No subscription ids supplied for Resource Graph query');
    const token = await this.cred.getToken('https://management.azure.com/.default');
    if (!token) throw new Error('Could not acquire an Azure management token');
    const rows: Record<string, unknown>[] = [];
    let skipToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptions,
          query: kql,
          options: {
            resultFormat: 'objectArray',
            $top: 1000,
            ...(skipToken ? { $skipToken: skipToken } : {}),
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new Error(
          `Resource Graph HTTP ${res.status}${res.status === 403 ? ' (missing Reader permission?)' : ''}: ${text}`,
        );
      }
      const body = (await res.json()) as { data?: Record<string, unknown>[]; $skipToken?: string };
      rows.push(...(body.data ?? []));
      skipToken = body.$skipToken;
      if (!skipToken) return rows;
    }
    throw new Error(`Resource Graph result exceeded ${MAX_PAGES} pages`);
  }
}
