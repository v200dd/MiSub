const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

const visibleText = (text) => text.replace(INVISIBLE_CHARACTERS, '');

/** Compile literal text rules once for both the editor example and subscription output. */
export function compileNodeNameReplacements(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.flatMap((rule) => {
        if (typeof rule?.from !== 'string' || typeof rule?.to !== 'string') return [];
        const from = visibleText(rule.from);
        if (!from.trim()) return [];
        const pattern = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return [
            { pattern: new RegExp(pattern, 'giu'), to: rule.to, wholeName: rule.mode === 'whole' },
        ];
    });
}

export function replaceNodeNameText(name, rules) {
    let result = name;
    for (const rule of rules) {
        const visibleName = visibleText(result);
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(visibleName)) continue;
        rule.pattern.lastIndex = 0;
        result = rule.wholeName ? rule.to : visibleName.replace(rule.pattern, () => rule.to);
    }
    return result;
}
