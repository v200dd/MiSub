import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySubscriptionNodeRenames } from '../../functions/utils/subscription-node-renames.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';
import { handleSubscriptionNodesRequest } from '../../functions/modules/subscription/preview-handler.js';
import {
    buildSubscriptionNodeCacheKey,
    generateCombinedNodeList,
} from '../../functions/services/subscription-service.js';

const original = '香港 [01].*';
const renamed = '我的专线 $1 {name} / # 🚀';
const trojan = `trojan://secret@edge.example.com:443?security=tls&sni=example.com#${encodeURIComponent(original)}`;
const encode = (text) => Buffer.from(text).toString('base64');
const vmessConfig = {
    v: '2',
    ps: original,
    add: 'vmess.example.com',
    port: '443',
    id: '11111111-1111-4111-8111-111111111111',
    aid: '0',
    net: 'ws',
    tls: 'tls',
};
const vmess = `vmess://${encode(JSON.stringify(vmessConfig))}`;
const ssr = `ssr://${encode(`ssr.example.com:443:origin:aes-128-cfb:plain:${encode('secret')}/?remarks=${encode(original)}&obfsparam=${encode('example.com')}`)}`;
const rules = [{ from: original, to: renamed }];

const subscription = (overrides = {}) => ({
    id: 'source-a',
    name: '机场 A',
    url: 'https://example.com/sub',
    enabled: true,
    nodeRenames: rules,
    ...overrides,
});
const output = (sub, storage) =>
    generateCombinedNodeList(
        { storage },
        { enableFlagEmoji: false, enableAccessLog: false },
        'ClashMeta',
        [sub],
        '',
        { enableSubscriptions: false }
    );
const preview = (sub, storage) =>
    fetchSubscriptionNodes(
        sub.url,
        sub.name,
        'MiSub',
        sub.customUserAgent,
        false,
        sub.exclude,
        sub.fetchProxy,
        false,
        false,
        sub.enableNodeCache,
        storage,
        sub
    );

afterEach(() => vi.unstubAllGlobals());

describe('literal subscription line names', () => {
    it.each([
        ['trojan', trojan],
        [
            'vless',
            `vless://11111111-1111-4111-8111-111111111111@edge.example.com:443?type=ws#${encodeURIComponent(original)}`,
        ],
        [
            'ss',
            `ss://${encode('aes-128-gcm:secret')}@ss.example.com:8388#${encodeURIComponent(original)}`,
        ],
        ['vmess', vmess],
        ['ssr', ssr],
    ])('writes literal Unicode names into %s connection URLs', (protocol, url) => {
        const [result] = applySubscriptionNodeRenames([url], rules);
        expect(parseNodeInfo(result).name).toBe(renamed);
        expect(parseNodeInfo(result).server).toBe(parseNodeInfo(url).server);
        expect(parseNodeInfo(result).port).toBe(parseNodeInfo(url).port);
        if (protocol === 'vmess') {
            expect(JSON.parse(Buffer.from(result.slice(8), 'base64').toString())).toEqual({
                ...vmessConfig,
                ps: renamed,
            });
        } else if (protocol === 'ssr') {
            const before = Buffer.from(url.slice(6), 'base64').toString();
            const after = Buffer.from(result.slice(6), 'base64').toString();
            expect(after.split('/?')[0]).toBe(before.split('/?')[0]);
            expect(new URLSearchParams(after.split('/?')[1]).get('obfsparam')).toBe(
                encode('example.com')
            );
        } else {
            expect(result.split('#')[0]).toBe(url.split('#')[0]);
        }
    });

    it('matches entire names, does not cascade, and ignores blank/invalid rules', () => {
        const nodes = [
            'trojan://secret@edge.example.com:443#HK',
            'trojan://secret@edge.example.com:443#HK2',
        ];
        const result = applySubscriptionNodeRenames(nodes, [
            { from: 'HK', to: 'A' },
            { from: 'A', to: 'B' },
            { from: 'HK2', to: ' ' },
            null,
        ]);
        expect(parseNodeInfo(result[0]).name).toBe('A');
        expect(result[1]).toBe(nodes[1]);
        expect(applySubscriptionNodeRenames(nodes, null)).toBe(nodes);
    });

    it('keeps preview and generated output consistent and scopes names to each source', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(trojan))
        );
        const sub = subscription();
        const fetched = await preview(sub);
        const generated = await output(sub);
        expect(fetched.nodes[0].name).toBe(renamed);
        expect(fetched.nodes[0].originalName).toBe(original);
        expect(generated.trim()).toBe(fetched.nodes[0].url);
        expect(parseNodeInfo((await output(subscription({ nodeRenames: [] }))).trim()).name).toBe(
            original
        );
    });

    it('runs source operators before aliases consistently in preview and output', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(trojan))
        );
        const sub = subscription({
            operators: [
                {
                    type: 'rename',
                    enabled: true,
                    params: { template: { enabled: true, template: 'Processed' } },
                },
            ],
            nodeRenames: [{ from: 'Processed', to: '专用线路' }],
        });
        expect((await preview(sub)).nodes[0].name).toBe('专用线路');
        expect(parseNodeInfo((await output(sub)).trim()).name).toBe('专用线路');
    });

    it('matches names consistently when plus signs are treated as spaces', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('trojan://secret@edge.example.com:443#HK+01'))
        );
        const sub = subscription({
            plusAsSpace: true,
            nodeRenames: [{ from: 'HK 01', to: '香港专线' }],
        });
        const fetched = await fetchSubscriptionNodes(
            sub.url,
            sub.name,
            'MiSub',
            null,
            false,
            '',
            null,
            false,
            true,
            false,
            null,
            sub
        );
        expect(fetched.nodes[0].name).toBe('香港专线');
        expect(parseNodeInfo((await output(sub)).trim()).name).toBe('香港专线');
    });

    it('retains pre-alias cache URLs so renaming and restoring work during upstream failures', async () => {
        const entries = new Map();
        const storage = {
            get: async (key) => entries.get(key),
            put: async (key, value) => entries.set(key, value),
        };
        const sub = subscription({ enableNodeCache: true });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(trojan))
        );
        await output(sub, storage);
        const cached = entries.get(buildSubscriptionNodeCacheKey(sub));
        expect(parseNodeInfo(cached.nodes[0]).name).toBe(original);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('Forbidden', { status: 403 }))
        );
        for (const nodeRenames of [rules, [{ from: original, to: '再次改名' }], []]) {
            const current = { ...sub, nodeRenames };
            const expected = nodeRenames[0]?.to || original;
            expect(parseNodeInfo((await output(current, storage)).trim()).name).toBe(expected);
            const fetched = await preview(current, storage);
            expect(fetched.fromCache).toBe(true);
            expect(fetched.nodes[0].name).toBe(expected);
        }
    });

    it('loads names using the draft URL, proxy, UA and processing rules without applying saved aliases', async () => {
        const fetchMock = vi.fn(async () => new Response(trojan));
        vi.stubGlobal('fetch', fetchMock);
        const request = new Request('https://misub.example.com/api/subscription_nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: 'https://example.com/draft',
                fetchProxy: 'https://proxy.example.com/api?url=',
                customUserAgent: 'clash.meta',
                nodeRenames: rules,
            }),
        });
        const response = await handleSubscriptionNodesRequest(request, {});
        const data = await response.json();
        expect(data.nodes[0].name).toBe(original);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.hostname).toBe('proxy.example.com');
        expect(url.searchParams.get('url')).toBe('https://example.com/draft');
        expect(url.searchParams.get('ua')).toBe('clash.meta');
    });
});
