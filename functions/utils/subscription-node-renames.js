import { parseNodeInfo } from '../modules/utils/geo-utils.js';
import { setNodeName } from './node-transformer.js';
import { setSsrNodeName } from './node-utils.js';

/** Apply literal, exact-name aliases once, without cascading or changing connection settings. */
export function applySubscriptionNodeRenames(nodes, rules) {
    if (!Array.isArray(rules) || rules.length === 0) return nodes;
    const names = new Map();
    for (const rule of rules) {
        if (typeof rule?.from !== 'string' || typeof rule?.to !== 'string') continue;
        const to = rule.to.trim();
        if (rule.from && to) names.set(rule.from, to);
    }
    if (names.size === 0) return nodes;

    return nodes.map((node) => {
        const info = typeof node === 'string' ? parseNodeInfo(node) : node;
        const name = names.get(info.name);
        if (!name || name === info.name) return node;
        const url =
            info.protocol === 'ssr'
                ? setSsrNodeName(info.url, name)
                : setNodeName(info.url, info.protocol, name);
        if (typeof node === 'string') return url;
        return { ...node, name, url, originalName: node.originalName || node.name };
    });
}
