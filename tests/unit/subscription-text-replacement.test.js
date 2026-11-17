import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import TextReplaceSection from '../../src/components/modals/SubscriptionEditModal/TextReplaceSection.vue';
import { createI18n } from '../../src/i18n/index.js';
import {
    compileNodeNameReplacements,
    replaceNodeNameText,
} from '../../src/shared/node-name-replacements.js';
import { applySubscriptionNodeRenames } from '../../functions/utils/subscription-node-renames.js';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';
import {
    generateCombinedNodeList,
    buildSubscriptionNodeCacheKey,
} from '../../functions/services/subscription-service.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';

vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const replace = (name, rules) => replaceNodeNameText(name, compileNodeNameReplacements(rules));
const tgRule = [{ from: 'tg', to: '专线', mode: 'replace' }];

describe('plain text rules', () => {
    it('replaces every occurrence regardless of case and preserves unmatched names', () => {
        expect(replace('香港 Tg 01 / tG', tgRule)).toBe('香港 专线 01 / 专线');
        expect(replace('日本 02', tgRule)).toBe('日本 02');
    });

    it('matches invisible characters in the source and pasted search text without a cleanup rule', () => {
        const hidden = [...'TG:@MiaChatChannel'].join('\u200b');
        expect(replace(`香港 01 ${hidden}`, [{ from: 'TG:@MiaChatChannel', to: '' }])).toBe(
            '香港 01 '
        );
        expect(replace('香港 t\u200bg 01', tgRule)).toBe('香港 专线 01');
        expect(replace('TG:@MiaChatChannel', [{ from: hidden, to: '我的频道' }])).toBe('我的频道');
        expect(replace('日\u200b本 01', tgRule)).toBe('日\u200b本 01');
    });

    it('treats search patterns and replacement symbols as literal text', () => {
        expect(replace('HK [.*] 01', [{ from: '[.*]', to: '$1 {name}' }])).toBe('HK $1 {name} 01');
        expect(replace('HK 01', [{ from: '.*', to: 'all' }])).toBe('HK 01');
        expect(replace('A\\B (01)', [{ from: '\\B (', to: '?$&[' }])).toBe('A?$&[01)');
    });

    it('supports entire-name replacement and applies multiple rules in order', () => {
        expect(replace('香港 TG 01', [{ from: 'tg', to: '自定义线路', mode: 'whole' }])).toBe(
            '自定义线路'
        );
        expect(replace('日本 02', [{ from: 'tg', to: '自定义线路', mode: 'whole' }])).toBe(
            '日本 02'
        );
        expect(replace('HK tg', [...tgRule, { from: 'HK', to: '香港' }])).toBe('香港 专线');
    });

    it('ignores invalid and empty searches, including only invisible characters', () => {
        expect(
            replace('香港 TG', [
                null,
                { from: '', to: 'x' },
                { from: '\u200b', to: 'x' },
                { from: ' ', to: 'x' },
                { from: 'tg' },
            ])
        ).toBe('香港 TG');
        expect(replace('香港 TG', null)).toBe('香港 TG');
    });
});

describe('plain text subscription processing', () => {
    const lines = ['香港 t\u200bg 01', '日本 TG 02', '美国 03'].map(
        (name, i) =>
            `trojan://secret@edge${i}.example.com:443?security=tls#${encodeURIComponent(name)}`
    );
    const sub = {
        id: 'source-text',
        url: 'https://example.com/sub',
        enabled: true,
        nodeNameReplacements: tgRule,
    };
    const output = (current, storage) =>
        generateCombinedNodeList(
            { storage },
            { enableFlagEmoji: false, enableAccessLog: false },
            'ClashMeta',
            [current],
            '',
            { enableSubscriptions: false }
        );
    const preview = (current, storage) =>
        fetchSubscriptionNodes(
            current.url,
            current.name,
            'MiSub',
            null,
            false,
            '',
            null,
            false,
            false,
            current.enableNodeCache,
            storage,
            current
        );

    it('renames all matching lines consistently in preview and generated output', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(lines.join('\n')))
        );
        const fetched = await preview(sub);
        const generated = (await output(sub)).trim().split('\n');
        expect(fetched.nodes.map((node) => node.name)).toEqual([
            '香港 专线 01',
            '日本 专线 02',
            '美国 03',
        ]);
        expect(generated).toEqual(fetched.nodes.map((node) => node.url));
        generated.forEach((url, i) => expect(url.split('#')[0]).toBe(lines[i].split('#')[0]));
        expect((await preview({ ...sub, nodeNameReplacements: [] })).nodes[1].name).toBe(
            '日本 TG 02'
        );
    });

    it('can edit and remove text rules while upstream is unavailable without modifying the cache', async () => {
        const entries = new Map();
        const storage = {
            get: async (key) => entries.get(key),
            put: async (key, value) => entries.set(key, value),
        };
        const current = { ...sub, enableNodeCache: true };
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(lines.join('\n')))
        );
        await output(current, storage);
        const cached = entries.get(buildSubscriptionNodeCacheKey(current));
        expect(cached.nodes).toEqual(lines);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('Forbidden', { status: 403 }))
        );
        for (const replacements of [tgRule, [{ from: 'tg', to: '新名字', mode: 'whole' }], []]) {
            const changed = { ...current, nodeNameReplacements: replacements };
            const fetched = await preview(changed, storage);
            expect(fetched.fromCache).toBe(true);
            expect((await output(changed, storage)).trim().split('\n')).toEqual(
                fetched.nodes.map((node) => node.url)
            );
        }
        expect(cached.nodes).toEqual(lines);
    });

    it.each(['vmess', 'ssr', 'trojan'])(
        'writes text replacement and deletion into %s names',
        (protocol) => {
            const encode = (text) => Buffer.from(text).toString('base64');
            const url =
                protocol === 'vmess'
                    ? `vmess://${encode(JSON.stringify({ v: '2', ps: 'HK TG', add: 'example.com', port: '443', id: '11111111-1111-4111-8111-111111111111' }))}`
                    : protocol === 'ssr'
                      ? `ssr://${encode(`example.com:443:origin:aes-128-cfb:plain:${encode('secret')}/?remarks=${encode('HK TG')}`)}`
                      : 'trojan://secret@example.com:443#HK%20TG';
            const [changed] = applySubscriptionNodeRenames([url], [], tgRule);
            expect(parseNodeInfo(changed).name).toBe('HK 专线');
            const [deleted] = applySubscriptionNodeRenames([url], [], [{ from: 'TG', to: '' }]);
            expect(parseNodeInfo(deleted).name.trim()).toBe('HK');
            const [cleared] = applySubscriptionNodeRenames([url], [], [{ from: 'HK TG', to: '' }]);
            if (protocol === 'vmess')
                expect(JSON.parse(Buffer.from(cleared.slice(8), 'base64').toString()).ps).toBe('');
            else if (protocol === 'ssr')
                expect(
                    new URLSearchParams(
                        Buffer.from(cleared.slice(6), 'base64').toString().split('/?')[1]
                    ).get('remarks')
                ).toBe('');
            else expect(cleared.endsWith('#')).toBe(true);
        }
    );
});

describe('text replacement editor', () => {
    const mountEditor = (subscription = {}) => {
        const editingSubscription = reactive({ url: 'https://example.com/sub', ...subscription });
        const wrapper = mount(TextReplaceSection, {
            props: { editingSubscription },
            global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] },
        });
        return { editingSubscription, wrapper };
    };

    it('accepts just tg, previews results and allows deletion and entire-name mode', async () => {
        const { wrapper, editingSubscription } = mountEditor();
        await wrapper.get('[aria-label="查找文字"]').setValue('tg');
        await wrapper.get('[aria-label="替换为"]').setValue('专线');
        expect(editingSubscription.nodeNameReplacements).toEqual(tgRule);
        expect(wrapper.get('[data-testid="text-replace-result"]').text()).toBe(
            '香港 01 专线:@MiaChatChannel'
        );
        await wrapper.get('[aria-label="试一下线路名称（可选）"]').setValue('香港 t\u200bg 01');
        expect(wrapper.get('[data-testid="text-replace-result"]').text()).toBe('香港 专线 01');
        await wrapper.get('[aria-label="替换方式"]').setValue('whole');
        expect(wrapper.get('[data-testid="text-replace-result"]').text()).toBe('专线');
        await wrapper.get('[aria-label="替换方式"]').setValue('replace');
        await wrapper.get('[aria-label="替换为"]').setValue('');
        expect(editingSubscription.nodeNameReplacements[0].to).toBe('');
        expect(wrapper.get('[data-testid="text-replace-result"]').text()).toBe('香港  01');
        await wrapper.get('[aria-label="移除规则"]').trigger('click');
        expect(editingSubscription.nodeNameReplacements).toEqual([]);
        wrapper.unmount();
    });

    it('restores saved rules and supports multiple rules without mixing subscriptions', async () => {
        const { wrapper } = mountEditor({ nodeNameReplacements: tgRule });
        expect(wrapper.get('[aria-label="查找文字"]').element.value).toBe('tg');
        await wrapper.get('[data-testid="add-text-replace"]').trigger('click');
        expect(wrapper.findAll('[data-testid="text-replace-row"]')).toHaveLength(2);
        const next = reactive({
            url: 'https://example.com/other',
            nodeNameReplacements: [{ from: 'JP', to: '日本', mode: 'whole' }],
        });
        await wrapper.setProps({ editingSubscription: next });
        await flushPromises();
        expect(wrapper.findAll('[data-testid="text-replace-row"]')).toHaveLength(1);
        expect(wrapper.get('[aria-label="查找文字"]').element.value).toBe('JP');
        expect(next.nodeNameReplacements).toEqual([{ from: 'JP', to: '日本', mode: 'whole' }]);
        wrapper.unmount();
    });

    it('persists replacement rules on save while isolating edits from store data', () => {
        const updateSubscription = vi.fn();
        const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription });
        forms.openAdd();
        expect(forms.editingSubscription.value.nodeNameReplacements).toEqual([]);
        const sub = { id: 'source', url: 'https://example.com/sub', nodeNameReplacements: tgRule };
        forms.openEdit(sub);
        forms.editingSubscription.value.nodeNameReplacements[0].to = '我的线路';
        expect(sub.nodeNameReplacements[0].to).toBe('专线');
        forms.handleSave();
        expect(updateSubscription).toHaveBeenCalledWith(
            expect.objectContaining({
                nodeNameReplacements: [{ from: 'tg', to: '我的线路', mode: 'replace' }],
            })
        );
    });
});
