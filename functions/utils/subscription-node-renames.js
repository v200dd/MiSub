import { parseNodeInfo } from '../modules/utils/geo-utils.js';
import { setNodeName } from './node-transformer.js';
import { setSsrNodeName } from './node-utils.js';
import {
    compileNodeNameReplacements,
    replaceNodeNameText,
} from '../../src/shared/node-name-replacements.js';

/** Apply exact aliases once, then ordered literal text rules, preserving connection settings. */
export function applySubscriptionNodeRenames(nodes, rules, textRules) {
    const replacements = compileNodeNameReplacements(textRules);
    const names = new Map();
    for (const rule of Array.isArray(rules) ? rules : []) {
        if (typeof rule?.from !== 'string' || typeof rule?.to !== 'string') continue;
        const to = rule.to.trim();
        if (rule.from && to) names.set(rule.from, to);
    }
    if (names.size === 0 && replacements.length === 0) return nodes;

    return nodes.map((node) => {
        const info = typeof node === 'string' ? parseNodeInfo(node) : node;
        const name = replaceNodeNameText(names.get(info.name) ?? info.name, replacements);
        if (name === info.name) return node;
        const url =
            info.protocol === 'ssr'
                ? setSsrNodeName(info.url, name)
                : setNodeName(info.url, info.protocol, name);
        if (typeof node === 'string') return url;
        return {
            ...node,
            name: name || parseNodeInfo(url).name,
            url,
            originalName: node.originalName || node.name,
        };
    });
}
