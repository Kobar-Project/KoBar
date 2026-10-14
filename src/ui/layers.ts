// Stack of open overlay layers (Popover, Menu, Dialog). One shared document listener routes Esc and outside presses
// to the topmost layer only, so a single Esc closes "popover, then dialog, then panel" in order.

/** "panel": non-modal PanelShell; it only takes Esc while on top and never closes on outside presses. */
export type LayerKind = 'popover' | 'dialog' | 'panel';

export interface Layer {
    kind: LayerKind;
    /** True when the node belongs to this layer (its content and, for popovers, the trigger). */
    contains: (node: Node) => boolean;
    /** Esc while this layer is on top. Esc is consumed even without a handler (a modal layer swallows it). */
    onEscape?: () => void;
    /** Pointer press outside the layer while it is on top. */
    onOutsidePress?: (event: PointerEvent) => void;
    /** A dialog opened above this popover: it must close. */
    onForceClose?: () => void;
}

/** Elements under this attribute (e.g. the toast region) never count as an outside press or a focus escape. */
export const LAYER_IGNORE_ATTR = 'data-kb-layer-ignore';

const stack: Layer[] = [];

function isIgnored(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;
    return Boolean(el?.closest(`[${LAYER_IGNORE_ATTR}]`));
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    event.preventDefault();
    event.stopPropagation();
    top.onEscape?.();
}

function onPointerDown(event: PointerEvent): void {
    const top = stack[stack.length - 1];
    const target = event.target;
    if (!top || !(target instanceof Node)) return;
    if (top.contains(target) || isIgnored(target)) return;
    top.onOutsidePress?.(event);
}

/** Pushes a layer on top of the stack; returns the function that removes it. */
export function registerLayer(layer: Layer): () => void {
    if (layer.kind === 'dialog') {
        for (const open of stack.slice()) if (open.kind === 'popover') open.onForceClose?.();
    }
    stack.push(layer);
    if (stack.length === 1) {
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
    }
    return () => {
        const index = stack.indexOf(layer);
        if (index >= 0) stack.splice(index, 1);
        if (stack.length === 0) {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown, true);
        }
    };
}

/** True when the node is inside a layer stacked above `layer`, or inside an ignored region. */
export function isInLayerAbove(layer: Layer, node: Node): boolean {
    if (isIgnored(node)) return true;
    const index = stack.indexOf(layer);
    if (index < 0) return false;
    return stack.slice(index + 1).some((above) => above.contains(node));
}

/** Number of open layers (tests and diagnostics). */
export function openLayerCount(): number {
    return stack.length;
}
