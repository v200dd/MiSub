import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import NodeRenameSection from '../../src/components/modals/SubscriptionEditModal/NodeRenameSection.vue';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';
import { createI18n } from '../../src/i18n/index.js';
import { api } from '../../src/lib/http.js';

vi.mock('../../src/lib/http.js', () => ({ api: { post: vi.fn() } }));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast: vi.fn() }) }));

function editor(subscription = {}) {
    const editingSubscription = reactive({ url: 'https://example.com/sub', ...subscription });
    const wrapper = mount(NodeRenameSection, {
        props: { editingSubscription },
        global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] },
    });
    return { wrapper, editingSubscription };
}

describe('subscription line rename editor', () => {
    it('loads distinct names, records only edits, and restores the original when cleared', async () => {
        api.post.mockResolvedValueOnce({
            success: true,
            nodes: [{ name: '香港 01' }, { name: '香港 01' }, { name: '日本 01' }],
        });
        const { wrapper, editingSubscription } = editor({
            fetchProxy: 'https://proxy.example.com/?url=',
            customUserAgent: 'clash.meta',
            plusAsSpace: true,
        });
        await wrapper.get('[aria-controls="subscription-node-renames"]').trigger('click');
        await wrapper.get('[data-testid="load-rename-nodes"]').trigger('click');
        await flushPromises();
        expect(api.post).toHaveBeenLastCalledWith(
            '/api/subscription_nodes',
            expect.objectContaining({
                url: editingSubscription.url,
                fetchProxy: editingSubscription.fetchProxy,
                customUserAgent: 'clash.meta',
                plusAsSpace: true,
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(wrapper.findAll('[data-testid="rename-row"]')).toHaveLength(2);
        expect(editingSubscription.nodeRenames).toEqual([]);
        const nameInput = wrapper.get('[aria-label="新线路名称"]');
        await nameInput.setValue('我的香港');
        expect(editingSubscription.nodeRenames).toEqual([{ from: '香港 01', to: '我的香港' }]);
        await nameInput.setValue('');
        expect(editingSubscription.nodeRenames).toEqual([]);
        wrapper.unmount();
    });

    it('edits saved rules, supports manual names and removes a rule', async () => {
        const { wrapper, editingSubscription } = editor({
            nodeRenames: [{ from: 'HK', to: '香港' }],
        });
        expect(wrapper.get('[aria-label="新线路名称"]').element.value).toBe('香港');
        await wrapper.get('[data-testid="add-rename-rule"]').trigger('click');
        const row = wrapper.findAll('[data-testid="rename-row"]')[1];
        await row.get('[aria-label="原线路名称"]').setValue('JP');
        await row.get('[aria-label="新线路名称"]').setValue('日本专线');
        expect(editingSubscription.nodeRenames).toHaveLength(2);
        await wrapper.get('[aria-label="移除改名规则"]').trigger('click');
        expect(editingSubscription.nodeRenames).toEqual([{ from: 'JP', to: '日本专线' }]);
        wrapper.unmount();
    });

    it('shows upstream errors and leaves existing edits intact', async () => {
        api.post.mockResolvedValueOnce({
            success: true,
            subscriptions: [{ success: false, error: 'HTTP 403: Forbidden' }],
            nodes: [],
        });
        const { wrapper, editingSubscription } = editor({
            nodeRenames: [{ from: 'HK', to: '香港' }],
        });
        await wrapper.get('[data-testid="load-rename-nodes"]').trigger('click');
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toContain('HTTP 403');
        expect(editingSubscription.nodeRenames).toEqual([{ from: 'HK', to: '香港' }]);
        wrapper.unmount();
    });

    it('ignores a late response after switching subscriptions', async () => {
        let resolve;
        api.post.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        const { wrapper } = editor();
        await wrapper.get('[aria-controls="subscription-node-renames"]').trigger('click');
        await wrapper.get('[data-testid="load-rename-nodes"]').trigger('click');
        const nextSub = reactive({
            url: 'https://example.com/other',
            nodeRenames: [{ from: 'JP', to: '日本' }],
        });
        await wrapper.setProps({ editingSubscription: nextSub });
        resolve({ success: true, nodes: [{ name: 'Old source' }] });
        await flushPromises();
        expect(wrapper.findAll('[data-testid="rename-row"]')).toHaveLength(1);
        expect(nextSub.nodeRenames).toEqual([{ from: 'JP', to: '日本' }]);
        wrapper.unmount();
    });

    it('keeps edits isolated until save and persists names when saving a subscription', () => {
        const updateSubscription = vi.fn();
        const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription });
        forms.openAdd();
        expect(forms.editingSubscription.value.nodeRenames).toEqual([]);
        const sub = {
            id: 'source',
            url: 'https://example.com/sub',
            nodeRenames: [{ from: 'HK', to: '香港' }],
        };
        forms.openEdit(sub);
        forms.editingSubscription.value.nodeRenames[0].to = '专线';
        expect(sub.nodeRenames[0].to).toBe('香港');
        forms.handleSave();
        expect(updateSubscription).toHaveBeenCalledWith(
            expect.objectContaining({ nodeRenames: [{ from: 'HK', to: '专线' }] })
        );
    });
});
