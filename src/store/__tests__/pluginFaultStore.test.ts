import { beforeEach, describe, expect, it } from 'vitest';
import { clearPluginFaultsForTests, reducePluginFault } from '../pluginFaultStore';

describe('plugin fault card state machine', () => {
    beforeEach(clearPluginFaultsForTests);
    const card = { id: 'n:NonFinite', nodeId: 'n', pluginName: 'Surge XT', kind: 'NonFinite' as const, count: 1 };
    it('keeps isolated NaN scrubs quiet', () => expect(reducePluginFault(card, 0)).toBeNull());
    it('speaks after eight scrubs in ten seconds', () => {
        for (let index = 0; index < 7; index++) expect(reducePluginFault(card, index * 100)).toBeNull();
        expect(reducePluginFault(card, 700)?.count).toBe(8);
    });
    it('counts two crashes into the benched state', () => {
        const crash = { ...card, id: 'n:Crashed', kind: 'Crashed' as const };
        expect(reducePluginFault(crash)?.count).toBe(1);
        expect(reducePluginFault(crash)?.count).toBe(2);
    });
});
