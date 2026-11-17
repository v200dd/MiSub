<script setup>
    import { computed, onBeforeUnmount, ref, watch } from 'vue';
    import { api } from '../../../lib/http.js';
    import { useI18n } from '../../../i18n/index.js';

    const props = defineProps({
        editingSubscription: { type: Object, required: true },
        active: { type: Boolean, default: true },
    });
    const { t } = useI18n();
    const expanded = ref(false);
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref('');
    const search = ref('');
    const rows = ref([]);
    let nextId = 0;
    let controller;
    const makeRow = (from = '', to = '') => ({ id: nextId++, from, to });
    const savedCount = computed(
        () =>
            rows.value.filter((row) => row.from && row.to.trim() && row.from !== row.to.trim())
                .length
    );
    const visibleRows = computed(() => {
        const query = search.value.trim().toLowerCase();
        return rows.value.filter(
            (row) => !query || `${row.from} ${row.to}`.toLowerCase().includes(query)
        );
    });
    const sourceConfig = computed(() =>
        JSON.stringify({
            url: props.editingSubscription.url,
            customUserAgent: props.editingSubscription.customUserAgent,
            fetchProxy: props.editingSubscription.fetchProxy,
            plusAsSpace: props.editingSubscription.plusAsSpace,
            exclude: props.editingSubscription.exclude,
            operators: props.editingSubscription.operators,
            nodeTransform: props.editingSubscription.nodeTransform,
        })
    );
    const cancelLoad = () => {
        controller?.abort();
        controller = null;
        loading.value = false;
    };

    watch(
        () => [props.editingSubscription, props.active],
        () => {
            cancelLoad();
            const rules = props.editingSubscription.nodeRenames || [];
            rows.value = Array.isArray(rules)
                ? rules
                      .filter(
                          (rule) => typeof rule?.from === 'string' && typeof rule?.to === 'string'
                      )
                      .map((rule) => makeRow(rule.from, rule.to))
                : [];
            expanded.value = rows.value.length > 0;
            loaded.value = false;
            error.value = '';
            search.value = '';
        },
        { immediate: true }
    );

    watch(sourceConfig, () => {
        cancelLoad();
        loaded.value = false;
        error.value = '';
        rows.value = rows.value.filter((row) => row.to.trim());
    });

    watch(
        rows,
        () => {
            props.editingSubscription.nodeRenames = rows.value
                .filter((row) => row.from && row.to.trim() && row.from !== row.to.trim())
                .map((row) => ({ from: row.from, to: row.to.trim() }));
        },
        { deep: true }
    );

    const loadNodes = async () => {
        cancelLoad();
        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(() => requestController.abort(), 60000);
        loading.value = true;
        error.value = '';
        try {
            const data = await api.post(
                '/api/subscription_nodes',
                {
                    ...JSON.parse(sourceConfig.value),
                    userAgent: 'MiSub-Node-Preview/1.0',
                },
                { signal: requestController.signal }
            );
            if (controller !== requestController) return;
            if (!data?.success || data.subscriptions?.some((sub) => !sub.success)) {
                throw new Error(
                    data?.error ||
                        data?.subscriptions?.find((sub) => !sub.success)?.error ||
                        t('nodePreview.fetchFailed')
                );
            }
            const names = new Set(rows.value.map((row) => row.from));
            for (const node of data.nodes || []) {
                if (!node.name || names.has(node.name)) continue;
                names.add(node.name);
                rows.value.push(makeRow(node.name));
            }
            loaded.value = true;
        } catch (err) {
            if (controller !== requestController) return;
            error.value =
                err.name === 'AbortError'
                    ? t('settings.requestTimeout')
                    : err.message || t('nodePreview.loadFailed');
        } finally {
            clearTimeout(timeout);
            if (controller === requestController) {
                controller = null;
                loading.value = false;
            }
        }
    };

    const addRule = () => {
        search.value = '';
        rows.value.push(makeRow());
    };
    const removeRow = (row) => {
        rows.value = rows.value.filter((item) => item.id !== row.id);
    };
    onBeforeUnmount(cancelLoad);
</script>

<template>
    <section class="overflow-hidden border border-gray-200 dark:border-gray-700 misub-radius-md">
        <button
            type="button"
            class="flex w-full items-center justify-between gap-2 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:bg-gray-800/50 dark:text-gray-200"
            :aria-expanded="expanded"
            aria-controls="subscription-node-renames"
            @click="expanded = !expanded"
        >
            <span>{{ t('subscriptions.lineRenameTitle') }}</span>
            <span>{{
                savedCount
                    ? t('subscriptions.lineRenameCount', { count: savedCount })
                    : expanded
                      ? '−'
                      : '+'
            }}</span>
        </button>
        <div
            v-show="expanded"
            id="subscription-node-renames"
            class="space-y-3 border-t border-gray-200 p-4 dark:border-gray-700"
        >
            <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('subscriptions.lineRenameHint') }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    data-testid="load-rename-nodes"
                    :disabled="loading || !/^https?:\/\//i.test(editingSubscription.url || '')"
                    class="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-600 disabled:opacity-50 dark:bg-indigo-500/10 dark:text-indigo-400"
                    @click="loadNodes"
                >
                    {{
                        loading ? t('subscriptions.loadingNodes') : t('subscriptions.loadLineNames')
                    }}
                </button>
                <button
                    type="button"
                    data-testid="add-rename-rule"
                    class="rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-gray-600 dark:text-gray-300"
                    @click="addRule"
                >
                    {{ t('subscriptions.addLineRename') }}
                </button>
            </div>
            <p v-if="error" role="alert" class="text-xs text-red-600 dark:text-red-400">
                {{ error }}
            </p>
            <input
                v-if="rows.length"
                v-model="search"
                type="search"
                :placeholder="t('subscriptions.searchLineNames')"
                :aria-label="t('subscriptions.searchLineNames')"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <div v-if="rows.length" class="max-h-80 space-y-2 overflow-y-auto">
                <div
                    v-for="row in visibleRows"
                    :key="row.id"
                    data-testid="rename-row"
                    class="flex items-center gap-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50"
                >
                    <div class="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <label class="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                            {{ t('subscriptions.originalLineName') }}
                            <input
                                v-model="row.from"
                                :aria-label="t('subscriptions.originalLineName')"
                                :placeholder="t('subscriptions.originalLineName')"
                                class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                            />
                        </label>
                        <label class="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                            {{ t('subscriptions.customLineName') }}
                            <input
                                v-model="row.to"
                                :aria-label="t('subscriptions.customLineName')"
                                :placeholder="t('subscriptions.keepOriginalLineName')"
                                class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                            />
                        </label>
                    </div>
                    <button
                        type="button"
                        :aria-label="t('subscriptions.removeLineRename')"
                        :title="t('subscriptions.removeLineRename')"
                        class="shrink-0 rounded-lg p-2 text-gray-500 hover:text-red-500"
                        @click="removeRow(row)"
                    >
                        ×
                    </button>
                </div>
            </div>
            <p v-if="!rows.length" class="text-xs text-gray-500 dark:text-gray-400">
                {{ loaded ? t('subscriptions.noLineNames') : t('subscriptions.lineRenameEmpty') }}
            </p>
            <p v-else-if="!visibleRows.length" class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('subscriptions.noMatchingNodes') }}
            </p>
        </div>
    </section>
</template>
