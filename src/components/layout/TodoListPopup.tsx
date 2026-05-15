import React, { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';

const TodoListPopup: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const todoListAnchorRect = useAppStore(state => state.todoListAnchorRect);
    const setIsTodoListOpen = useAppStore(state => state.setIsTodoListOpen);
    const design = useAppStore(state => state.design);
    const isMac = useAppStore(state => state.isMac);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const todos = useAppStore(state => state.todos);
    const addTodo = useAppStore(state => state.addTodo);
    const updateTodoText = useAppStore(state => state.updateTodoText);
    const toggleTodo = useAppStore(state => state.toggleTodo);
    const deleteTodo = useAppStore(state => state.deleteTodo);
    const reorderTodos = useAppStore(state => state.reorderTodos);
    const t = useAppStore(state => state.t);
    const screenBounds = useAppStore(state => state.screenBounds);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);

    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const getPopupStyle = (): React.CSSProperties => {
        if (!todoListAnchorRect) return { display: 'none' };
        
        const popupHeight = 300; // Expected approximate height
        const screenHeight = screenBounds?.height ?? 800;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;

        let adjustedTop = (todoListAnchorRect.top - offsetTop) - 20 + (todoListAnchorRect.height / 2) - (popupHeight / 2);

        const maxTop = (screenHeight - offsetTop) - popupHeight - 20;
        const minTop = -offsetTop + 20;

        if (adjustedTop < minTop) adjustedTop = minTop;
        if (adjustedTop > maxTop) adjustedTop = maxTop;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-surface)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        if (!isSmartPositioning) {
            style.top = '50%';
            style.transform = 'translateY(-50%)';
        } else {
            style.top = adjustedTop;
        }

        if (edgePosition === 'left') {
            style.left = '100%';
            style.marginLeft = '12px';
        } else {
            style.right = '100%';
            style.marginRight = '12px';
        }
        return style;
    };

    const isSmartRef = useRef(isSmartPositioning);
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !todoListAnchorRect || !isSmartRef.current) return;
            const newY = e.detail.y;
            const popupHeight = 300;
            const screenHeight = screenBounds?.height ?? 800;
            let adjustedTop = (todoListAnchorRect.top - newY) - 20 + (todoListAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = (screenHeight - newY) - popupHeight - 20;
            const minTop = -newY + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;
            popupRef.current.style.top = `${adjustedTop}px`;
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [todoListAnchorRect, screenBounds?.height]);

    const completedCount = todos.filter(t => t.completed).length;
    const progress = todos.length === 0 ? 0 : (completedCount / todos.length) * 100;

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedItemIndex(index);
        
        const row = (e.currentTarget as HTMLElement).closest('.todo-item');
        if (row && e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(row, 10, row.clientHeight / 2);
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        
        setTimeout(() => {
            if (row instanceof HTMLElement) {
                row.style.opacity = '0.4';
            }
        }, 0);
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        reorderTodos(draggedItemIndex, index);
        setDraggedItemIndex(index);
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        setDraggedItemIndex(null);
        const row = (e.currentTarget as HTMLElement).closest('.todo-item');
        if (row instanceof HTMLElement) {
            row.style.opacity = '1';
        }
    };

    return (
        <div
            ref={popupRef}
            className="w-80 border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl"
            style={getPopupStyle()}
        >
            <div className="flex justify-between items-center p-4 pb-3">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1 drag-region w-full">{t('todoListHeader')}</span>
                <div className="flex gap-1 shrink-0">
                    <button 
                        onClick={addTodo}
                        className="w-6 h-6 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-all no-drag-region"
                        title={t('addTaskTitle')}
                    >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                    <button 
                        onClick={() => setIsTodoListOpen(false)}
                        className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-[2px] bg-black/20">
                <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* List Container */}
            <div className="flex-1 p-2 max-h-80 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                {todos.length === 0 ? (
                    <div className="text-center text-slate-500 text-sm mt-8 mb-8">{t('todoEmptyState')}</div>
                ) : (
                    todos.map((todo, index) => (
                        <div 
                            key={todo.id}
                            className={`todo-item flex items-center gap-2 p-2 rounded-lg transition-colors border border-transparent hover:border-white/5 
                                ${draggedItemIndex === index ? 'opacity-40 scale-[0.98]' : 'hover:bg-black/10'}`}
                            onDragEnter={(e) => handleDragEnter(e, index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div 
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                className="opacity-0 group-hover:opacity-100 opacity-30 hover:opacity-100 flex items-center justify-center cursor-move no-drag-region shrink-0 text-slate-500 hover:text-white transition-opacity"
                            >
                                <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
                            </div>

                            <button
                                onClick={() => toggleTodo(todo.id)}
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center no-drag-region shrink-0 transition-colors
                                    ${todo.completed ? 'border-primary bg-primary text-slate-900' : 'border-slate-500 hover:border-slate-400'}`}
                            >
                                {todo.completed && <span className="material-symbols-outlined text-[14px]">check</span>}
                            </button>

                            <input
                                type="text"
                                maxLength={80}
                                value={todo.text}
                                onChange={(e) => updateTodoText(todo.id, e.target.value)}
                                placeholder={t('todoPlaceholder')}
                                className={`flex-1 bg-transparent border-none outline-none text-sm transition-opacity no-drag-region
                                    ${todo.completed ? 'text-slate-500 line-through opacity-60' : 'text-slate-200 focus:text-white'}`}
                            />

                            <button
                                onClick={() => deleteTodo(todo.id)}
                                className="w-6 h-6 rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity no-drag-region focus:opacity-100 group-hover:opacity-100 shrink-0"
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default TodoListPopup;
