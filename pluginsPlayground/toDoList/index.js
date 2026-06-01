(function() {
  "use strict";
  const React = window.React;
  const TRANSLATIONS = {
    en: {
      todoListHeader: "To-Do List",
      addTaskTitle: "Add Task",
      todoEmptyState: "All caught up! Add a task to start.",
      todoPlaceholder: "New task..."
    },
    tr: {
      todoListHeader: "Yapılacaklar Listesi",
      addTaskTitle: "Görev Ekle",
      todoEmptyState: "Hepsi tamam! Başlamak için bir görev ekleyin.",
      todoPlaceholder: "Yeni görev..."
    },
    de: {
      todoListHeader: "To-Do-Liste",
      addTaskTitle: "Aufgabe hinzufügen",
      todoEmptyState: "Alles erledigt!",
      todoPlaceholder: "Neue Aufgabe..."
    },
    fr: {
      todoListHeader: "Liste de tâches",
      addTaskTitle: "Ajouter une tâche",
      todoEmptyState: "Tout est fait ! Ajoutez une tâche pour commencer.",
      todoPlaceholder: "Nouvelle tâche..."
    },
    es: {
      todoListHeader: "Lista de tareas",
      addTaskTitle: "Añadir tarea",
      todoEmptyState: "¡Todo al día! Añade una tarea para empezar.",
      todoPlaceholder: "Nueva tarea..."
    },
    ru: {
      todoListHeader: "Список дел",
      addTaskTitle: "Добавить задачу",
      todoEmptyState: "Всё готово! Добавьте задачу, чтобы начать.",
      todoPlaceholder: "Новая задача..."
    },
    ja: {
      todoListHeader: "To-Do リスト",
      addTaskTitle: "タスクを追加",
      todoEmptyState: "すべて完了！タスクを追加して始めましょう。",
      todoPlaceholder: "新しいタスク..."
    },
    zh: {
      todoListHeader: "待办事项列表",
      addTaskTitle: "添加任务",
      todoEmptyState: "全部完成！添加一个任务开始吧。",
      todoPlaceholder: "新任务..."
    },
    ar: {
      todoListHeader: "قائمة المهام",
      addTaskTitle: "إضافة مهمة",
      todoEmptyState: "تم إنجاز كل شيء! أضف مهمة للبدء.",
      todoPlaceholder: "مهمة جديدة..."
    },
    hi: {
      todoListHeader: "टू-डू सूची",
      addTaskTitle: "कार्य जोड़ें",
      todoEmptyState: "सब पूरा हो गया! शुरू करने के लिए एक कार्य जोड़ें।",
      todoPlaceholder: "नया कार्य..."
    }
  };
  const TodoListPanel = (props) => {
    const { onClose, anchorRect } = props;
    const store = window.useAppStore();
    const edgePosition = store.edgePosition;
    const design = store.design;
    const isMac = store.isMac;
    const glassOpacity = store.glassOpacity;
    const screenBounds = store.screenBounds;
    const isSmartPositioning = store.isPopupSmartPositioning;
    const orientation = store.orientation;
    const sidebarPosition = store.sidebarPosition;
    const currentLang = store.language;
    const t = (key) => {
      const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS["en"];
      return langDict[key] || key;
    };
    const [todos, setTodos] = React.useState(() => {
      const saved = localStorage.getItem("kobar_plugin_todos");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          return [];
        }
      }
      return [];
    });
    React.useEffect(() => {
      localStorage.setItem("kobar_plugin_todos", JSON.stringify(todos));
    }, [todos]);
    const addTodo = () => {
      setTodos([{ id: Date.now().toString(), text: "", completed: false }, ...todos]);
    };
    const updateTodoText = (id, text) => {
      setTodos(todos.map((t2) => t2.id === id ? { ...t2, text } : t2));
    };
    const toggleTodo = (id) => {
      setTodos(todos.map((t2) => t2.id === id ? { ...t2, completed: !t2.completed } : t2));
    };
    const deleteTodo = (id) => {
      setTodos(todos.filter((t2) => t2.id !== id));
    };
    const reorderTodos = (startIndex, endIndex) => {
      const result = Array.from(todos);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      setTodos(result);
    };
    const [draggedItemIndex, setDraggedItemIndex] = React.useState(null);
    const popupRef = React.useRef(null);
    const getPopupStyle = () => {
      if (!anchorRect) return { display: "none" };
      const popupHeight = 300;
      const popupWidth = 320;
      const screenHeight = screenBounds?.height ?? 800;
      const screenWidth = screenBounds?.width ?? 1200;
      const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
      const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;
      const style = {
        position: "absolute",
        zIndex: 99999,
        backgroundColor: design === "style2" ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` : "var(--theme-surface)",
        borderColor: design === "style2" ? "rgba(255, 255, 255, 0.1)" : "var(--theme-border)",
        backdropFilter: design === "style2" ? isMac ? "blur(8px)" : "blur(20px)" : "none",
        WebkitBackdropFilter: design === "style2" ? isMac ? "blur(8px)" : "blur(20px)" : "none",
        willChange: "transform, opacity",
        transitionProperty: "opacity, transform, filter"
      };
      const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
      const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;
      if (orientation === "horizontal") {
        let adjustedLeft = anchorRect.left - offsetLeft + anchorRect.width / 2 - popupWidth / 2;
        const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
        const minLeft = screenXInViewport - offsetLeft + 20;
        if (adjustedLeft < minLeft) adjustedLeft = minLeft;
        if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
        if (!isSmartPositioning) {
          style.left = "50%";
          style.transform = "translateX(-50%)";
        } else {
          style.left = adjustedLeft;
        }
        if (edgePosition === "top") {
          style.top = "100%";
          style.marginTop = "12px";
        } else {
          style.bottom = "100%";
          style.marginBottom = "12px";
        }
      } else {
        let adjustedTop = anchorRect.top - offsetTop - 20 + anchorRect.height / 2 - popupHeight / 2;
        const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
        const minTop = screenYInViewport - offsetTop + 20;
        if (adjustedTop < minTop) adjustedTop = minTop;
        if (adjustedTop > maxTop) adjustedTop = maxTop;
        if (!isSmartPositioning) {
          style.top = "50%";
          style.transform = "translateY(-50%)";
        } else {
          style.top = adjustedTop;
        }
        if (edgePosition === "left") {
          style.left = "100%";
          style.marginLeft = "12px";
        } else {
          style.right = "100%";
          style.marginRight = "12px";
        }
      }
      return style;
    };
    const isSmartRef = React.useRef(isSmartPositioning);
    React.useEffect(() => {
      isSmartRef.current = isSmartPositioning;
    }, [isSmartPositioning]);
    React.useEffect(() => {
      const onDrag = (e) => {
        if (!popupRef.current || !anchorRect || !isSmartRef.current) return;
        const newX = e.detail.x;
        const newY = e.detail.y;
        const popupHeight = 300;
        const popupWidth = 320;
        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;
        if (orientation === "horizontal") {
          const screenWidth = screenBounds?.width ?? 1200;
          let adjustedLeft = anchorRect.left - newX + anchorRect.width / 2 - popupWidth / 2;
          const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
          const minLeft = screenXInViewport - newX + 20;
          if (adjustedLeft < minLeft) adjustedLeft = minLeft;
          if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
          popupRef.current.style.left = `${adjustedLeft}px`;
        } else {
          const screenHeight = screenBounds?.height ?? 800;
          let adjustedTop = anchorRect.top - newY - 20 + anchorRect.height / 2 - popupHeight / 2;
          const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
          const minTop = screenYInViewport - newY + 20;
          if (adjustedTop < minTop) adjustedTop = minTop;
          if (adjustedTop > maxTop) adjustedTop = maxTop;
          popupRef.current.style.top = `${adjustedTop}px`;
        }
      };
      document.addEventListener("kobar-drag", onDrag);
      return () => document.removeEventListener("kobar-drag", onDrag);
    }, [anchorRect, screenBounds, orientation]);
    const completedCount = todos.filter((t2) => t2.completed).length;
    const progress = todos.length === 0 ? 0 : completedCount / todos.length * 100;
    const handleDragStart = (e, index) => {
      setDraggedItemIndex(index);
      const row = e.currentTarget.closest(".todo-item");
      if (row && e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(row, 10, row.clientHeight / 2);
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index.toString());
      setTimeout(() => {
        if (row instanceof HTMLElement) {
          row.style.opacity = "0.4";
        }
      }, 0);
    };
    const handleDragEnter = (e, index) => {
      e.preventDefault();
      if (draggedItemIndex === null || draggedItemIndex === index) return;
      reorderTodos(draggedItemIndex, index);
      setDraggedItemIndex(index);
    };
    const handleDragEnd = (e) => {
      setDraggedItemIndex(null);
      const row = e.currentTarget.closest(".todo-item");
      if (row instanceof HTMLElement) {
        row.style.opacity = "1";
      }
    };
    return /* @__PURE__ */ window.React.createElement(
      "div",
      {
        ref: popupRef,
        className: "w-80 border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl",
        style: getPopupStyle()
      },
      /* @__PURE__ */ window.React.createElement("div", { className: "flex justify-between items-center p-4 pb-3 relative" }, /* @__PURE__ */ window.React.createElement("span", { className: "text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1 drag-region w-full" }, t("todoListHeader")), /* @__PURE__ */ window.React.createElement("span", { className: "absolute left-1/2 -translate-x-1/2 text-[10px] text-slate-400 font-bold tracking-wider pointer-events-none" }, completedCount, " / ", todos.length), /* @__PURE__ */ window.React.createElement("div", { className: "flex gap-1 shrink-0" }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: addTodo,
          className: "w-6 h-6 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-all no-drag-region",
          title: t("addTaskTitle")
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[16px]" }, "add")
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: onClose,
          className: "w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[16px]" }, "close")
      ))),
      /* @__PURE__ */ window.React.createElement("div", { className: "w-full h-[2px] bg-black/20" }, /* @__PURE__ */ window.React.createElement(
        "div",
        {
          className: "h-full bg-primary transition-all duration-300",
          style: { width: `${progress}%` }
        }
      )),
      /* @__PURE__ */ window.React.createElement("div", { className: "flex-1 p-2 max-h-80 overflow-y-auto custom-scrollbar flex flex-col gap-1" }, todos.length === 0 ? /* @__PURE__ */ window.React.createElement("div", { className: "text-center text-slate-500 text-sm mt-8 mb-8" }, t("todoEmptyState")) : todos.map((todo, index) => /* @__PURE__ */ window.React.createElement(
        "div",
        {
          key: todo.id,
          className: `todo-item flex items-center gap-2 p-2 rounded-lg transition-colors border border-transparent hover:border-white/5 
                                ${draggedItemIndex === index ? "opacity-40 scale-[0.98]" : "hover:bg-black/10"}`,
          onDragEnter: (e) => handleDragEnter(e, index),
          onDragEnd: handleDragEnd,
          onDragOver: (e) => e.preventDefault()
        },
        /* @__PURE__ */ window.React.createElement(
          "div",
          {
            draggable: true,
            onDragStart: (e) => handleDragStart(e, index),
            className: "opacity-0 group-hover:opacity-100 opacity-30 hover:opacity-100 flex items-center justify-center cursor-move no-drag-region shrink-0 text-slate-500 hover:text-white transition-opacity"
          },
          /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "drag_indicator")
        ),
        /* @__PURE__ */ window.React.createElement(
          "button",
          {
            onClick: () => toggleTodo(todo.id),
            className: `w-5 h-5 rounded-full border-2 flex items-center justify-center no-drag-region shrink-0 transition-colors
                                    ${todo.completed ? "border-primary bg-primary text-slate-900" : "border-slate-500 hover:border-slate-400"}`
          },
          todo.completed && /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "check")
        ),
        /* @__PURE__ */ window.React.createElement(
          "input",
          {
            type: "text",
            maxLength: 80,
            value: todo.text,
            onChange: (e) => updateTodoText(todo.id, e.target.value),
            placeholder: t("todoPlaceholder"),
            className: `flex-1 bg-transparent border-none outline-none text-sm transition-opacity no-drag-region
                                    ${todo.completed ? "text-slate-500 line-through opacity-60" : "text-slate-200 focus:text-white"}`
          }
        ),
        /* @__PURE__ */ window.React.createElement(
          "button",
          {
            onClick: () => deleteTodo(todo.id),
            className: "w-6 h-6 rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity no-drag-region focus:opacity-100 group-hover:opacity-100 shrink-0"
          },
          /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[16px]" }, "close")
        )
      )))
    );
  };
  window.KoBarExtensions.registerSidebarButton({
    id: "todolist-plugin-btn",
    icon: "format_list_bulleted",
    label: "To-Do List",
    onClick: (e, anchorRect) => {
      const store = window.useAppStore.getState();
      const isOpen = store.activeExtensionPanelId === "todolist-plugin-panel";
      store.closeAllUtilityPopups();
      if (!isOpen) {
        window.useAppStore.setState({
          activeExtensionPanelId: "todolist-plugin-panel",
          activeExtensionAnchorRect: anchorRect
        });
      } else {
        window.useAppStore.setState({
          activeExtensionPanelId: null,
          activeExtensionAnchorRect: null
        });
      }
    }
  });
  window.KoBarExtensions.registerPanel("todolist-plugin-panel", {
    id: "todolist-plugin-panel",
    render: (props) => window.React.createElement(TodoListPanel, props)
  });
})();
