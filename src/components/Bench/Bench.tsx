import { Banner, Button } from '@openjammer/oj-ui';
import { useCanvasStore } from '../../store/canvasStore';
import { dismissPluginFault, usePluginFaultCards, type PluginFaultCard } from '../../store/pluginFaultStore';
import { setNodePluginLoadError } from '../../audio/executor/pluginLoadError';
import { getExecutor } from '../../audio/executor';
import './Bench.css';

function copy(card: PluginFaultCard): { title: string; message: string; action: string } {
    if (card.kind === 'NonFinite') return { title: `${card.pluginName} is sending noise we can't play.`, message: "We're replacing those blocks with silence, so you may hear gaps. It's still in the chain.", action: 'Bypass it' };
    if (card.kind === 'Crashed' && card.count >= 2) return { title: `${card.pluginName} has crashed twice.`, message: "It's benched — OpenJammer won't load it again until you say so. Your project keeps its place and its settings.", action: 'Un-bench it' };
    return { title: `${card.pluginName} stopped answering.`, message: 'We took it out of the chain and let its notes go. Everything else is still playing.', action: 'Bring it back' };
}

export function Bench() {
    const cards = usePluginFaultCards();
    const ghost = useCanvasStore((state) => state.ghostMode);
    if (cards.length === 0) return null;
    if (ghost) return <button className="plugin-bench__ghost" type="button" aria-label={`${cards.length} plugin reports`}>{cards.length}</button>;
    const visible = cards.slice(0, 3);
    return <aside className="plugin-bench" aria-label="Plugin reports">
        {visible.map((card) => { const words = copy(card); return <Banner key={card.id} tone="warning" title={words.title} message={words.message} actions={<><Button onClick={() => { setNodePluginLoadError(card.nodeId, false); try { getExecutor().resync(); } catch { /* no executor yet */ } dismissPluginFault(card.id); }}>{words.action}</Button><Button onClick={() => window.dispatchEvent(new CustomEvent('openjammer:toggle-devlog', { detail: { correlation: card.corr } }))}>Details</Button></>} />; })}
        {cards.length > 3 && <button type="button" className="plugin-bench__more" onClick={() => window.dispatchEvent(new CustomEvent('openjammer:open-browser'))}>{cards.length - 3} more — open the Browser</button>}
        <span className="sr-only" aria-live="polite">{cards.at(-1)?.pluginName} bypassed — audio continues.</span>
    </aside>;
}
