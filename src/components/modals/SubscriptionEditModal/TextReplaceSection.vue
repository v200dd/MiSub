<script setup>
    import { computed, ref, watch } from 'vue';
    import { useI18n } from '../../../i18n/index.js';
    import {
        compileNodeNameReplacements,
        replaceNodeNameText,
    } from '../../../shared/node-name-replacements.js';

    const props = defineProps({
        editingSubscription: { type: Object, required: true },
        active: { type: Boolean, default: true },
    });
    const { t } = useI18n();
    const rows = ref([]);
    const sample = ref('');
    let nextId = 0;
    const newRow = (rule = {}) => ({
        id: nextId++,
        from: rule.from || '',
        to: rule.to || '',
        mode: rule.mode === 'whole' ? 'whole' : 'replace',
    });

    watch(
        () => [props.editingSubscription, props.active],
        () => {
            const saved = props.editingSubscription.nodeNameReplacements;
            rows.value = Array.isArray(saved)
                ? saved
                      .filter(
                          (rule) => typeof rule?.from === 'string' && typeof rule?.to === 'string'
                      )
                      .map(newRow)
                : [];
            if (!rows.value.length) rows.value.push(newRow());
            sample.value = '';
        },
        { immediate: true }
    );

    const rules = computed(() =>
        rows.value
            .filter((row) => row.from.trim())
            .map(({ from, to, mode }) => ({ from, to, mode }))
    );
    watch(rules, (value) => {
        props.editingSubscription.nodeNameReplacements = value;
    });
    const exampleName = computed(() => sample.value || t('subscriptions.textReplaceSample'));
    const exampleResult = computed(() =>
        replaceNodeNameText(exampleName.value, compileNodeNameReplacements(rules.value))
    );
    const removeRule = (id) => {
        rows.value = rows.value.filter((row) => row.id !== id);
        if (!rows.value.length) rows.value.push(newRow());
    };
</script>

<template>
    <section class="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div>
            <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {{ t('subscriptions.textReplaceTitle') }}
            </h4>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {{ t('subscriptions.textReplaceHint') }}
            </p>
        </div>
        <div
            v-for="row in rows"
            :key="row.id"
            data-testid="text-replace-row"
            class="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50"
        >
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="text-xs text-gray-500 dark:text-gray-400">
                    {{ t('subscriptions.textReplaceFind') }}
                    <input
                        v-model="row.from"
                        :aria-label="t('subscriptions.textReplaceFind')"
                        :placeholder="t('subscriptions.textReplaceFindPlaceholder')"
                        class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                    />
                </label>
                <label class="text-xs text-gray-500 dark:text-gray-400">
                    {{ t('subscriptions.textReplaceWith') }}
                    <input
                        v-model="row.to"
                        :aria-label="t('subscriptions.textReplaceWith')"
                        :placeholder="t('subscriptions.textReplaceWithPlaceholder')"
                        class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                    />
                </label>
            </div>
            <div class="flex items-center justify-between gap-2">
                <select
                    v-model="row.mode"
                    :aria-label="t('subscriptions.textReplaceMode')"
                    class="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                >
                    <option value="replace">{{ t('subscriptions.textReplacePart') }}</option>
                    <option value="whole">{{ t('subscriptions.textReplaceWhole') }}</option>
                </select>
                <button
                    type="button"
                    :aria-label="t('subscriptions.textReplaceRemove')"
                    class="shrink-0 rounded-lg px-2 py-2 text-xs text-gray-500 hover:text-red-500 dark:text-gray-400"
                    @click="removeRule(row.id)"
                >
                    {{ t('subscriptions.textReplaceRemove') }}
                </button>
            </div>
        </div>
        <button
            type="button"
            data-testid="add-text-replace"
            class="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
            @click="rows.push(newRow())"
        >
            {{ t('subscriptions.textReplaceAdd') }}
        </button>
        <div
            v-if="rules.length"
            class="space-y-2 rounded-lg border border-indigo-100 p-3 dark:border-indigo-500/20"
        >
            <label class="block text-xs text-gray-500 dark:text-gray-400">
                {{ t('subscriptions.textReplaceTry') }}
                <input
                    v-model="sample"
                    :aria-label="t('subscriptions.textReplaceTry')"
                    :placeholder="exampleName"
                    class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                />
            </label>
            <p class="break-words text-xs text-indigo-600 dark:text-indigo-400">
                {{ t('subscriptions.textReplaceResult')
                }}<span data-testid="text-replace-result">{{
                    exampleResult || t('subscriptions.textReplaceEmptyName')
                }}</span>
            </p>
        </div>
    </section>
</template>
