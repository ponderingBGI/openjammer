import { useEditingContextStore } from '../../store/editingContextStore';

export function DragGhostLayer() {
    const preview = useEditingContextStore((state) => state.clipDragPreview);
    if (!preview) return <div className="arrangement-drag-ghost-layer" aria-hidden="true" />;
    return (
        <div className="arrangement-drag-ghost-layer" aria-hidden="true">
            <div
                className="arrangement-drag-ghost"
                data-drag-ghost
                data-clip-id={preview.clipId}
                data-hovered-track-id={preview.hoveredTrackId}
                data-copy={preview.copy ? 'true' : 'false'}
                style={{ width: preview.width, height: preview.height, transform: `translate3d(${preview.x - preview.width / 2}px, ${preview.y - preview.height / 2}px, 0)` }}
            />
        </div>
    );
}
