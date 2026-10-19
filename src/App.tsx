import React, { useEffect, useRef, useState } from 'react';
import '@tailwindcss/browser';
import './index.css';
import { useAppStore } from './store/useAppStore';
import { clearLegacyThemeCSS } from './utils/color';
import Sidebar from './components/layout/Sidebar';
import NotePanel from './components/notes/NotePanel';
import FloatingEye from './components/layout/FloatingEye';
import { Onboarding } from './onboarding/Onboarding';
import HydrationRecovery from './components/recovery/HydrationRecovery';
import RestoreDialogHost from './components/notes/RestoreDialogHost';
import DataTransferDialogHost from './components/notes/DataTransferDialogHost';
import { PluginPanelHost } from './components/plugins/PluginPanelHost';
import { useExtensionRegistry } from './components/extensions/extensionRegistry';
import { hidePersistWarningBanner, installPersistWarning, showPersistWarningBanner } from './store/persistWarning';
import { getWindowGeometry, useWindowGeometry } from './utils/windowGeometry';
import { centeredEyePosition, computeVisibleArea, hasDisplayInfo, sameVisibleArea } from './utils/visibleArea';
import { applyEdgeChanged, installWindowLayoutSync } from './store/windowLayoutSync';
import { createPluginLoader, injectExtensionScript, removeExtensionScripts } from './components/extensions/pluginLoader';
import { startThemeSync } from './theme';
import { ToastRegion } from './ui';
import { translate } from './i18n/translate';
import { useOpenWithFiles } from './notes/useOpenWithFiles';
import { pluginSync } from './store/pluginSyncHost';
import { applyRootAppearance, effectiveThemePrefs } from './theme/root';

// MAC-032: fired by window.api.stopEyeDropper() in electron/preload.cts (the name is mirrored there; the preload is sandboxed and
// cannot import it).
const CLICK_THROUGH_RESET_EVENT = 'kobar:click-through-reset';

// T-409: one loader for the window (it remembers which plugin scripts are injected).
const appPluginLoader = createPluginLoader({
  getInstalledExtensions: () => window.api.getInstalledExtensions(),
  getRegistry: () => window.KoBarExtensions,
  onInstalledList: (exts) => {
    const configMap: Record<string, boolean> = {};
    exts.forEach(e => { configMap[e.id] = e.enabled; });
    useAppStore.getState().setCurrentExtensionsConfig(configMap);
    // T-610: the Settings window's plugin list (id/name/version/enabled only; the sync module drops everything else).
    pluginSync.setInstalledList(exts);
  },
  injectScript: injectExtensionScript,
  removeScripts: removeExtensionScripts,
});

// Global flag: when true, the ghost-window logic won't steal focus
// Exported so ResizerHandle can set it during drags
export let isResizingGlobal = false;
// Imported by Sidebar, FloatingEye and useUnifiedResize; moving it out of App.tsx is a refactor, not a lint fix.
// eslint-disable-next-line react-refresh/only-export-components
export function setIsResizingGlobal(v: boolean) { isResizingGlobal = v; }

const App: React.FC = () => {
  const edgePosition = useAppStore(state => state.edgePosition);

  const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
  const isMiniMode = useAppStore(state => state.isMiniMode);
  const scheme = useAppStore(state => state.scheme);
  const accent = useAppStore(state => state.accent);
  const material = useAppStore(state => state.material);
  const density = useAppStore(state => state.density);
  const setIsTargetingMode = useAppStore(state => state.setIsTargetingMode);
  const design = useAppStore(state => state.design);
  const sidebarWidth = useAppStore(state => state.sidebarWidth);
  const setPinnedWindowHwnd = useAppStore(state => state.setPinnedWindowHwnd);
  const isMac = useAppStore(state => state.isMac);
  const orientation = useAppStore(state => state.orientation);
  const screenBounds = useAppStore(state => state.screenBounds);
  // T-322: the live window model (re-renders when main re-fits the window) and the usable screen area in window coordinates.
  const windowGeometry = useWindowGeometry();
  const visibleArea = computeVisibleArea(windowGeometry, screenBounds);
  // Without display information (macOS, or main gave no usable model) the docked bar keeps its previous CSS placement exactly.
  const legacyDock = isMac || !hasDisplayInfo(windowGeometry);
  // While a drag owns the wrapper's left/top (set on the DOM by Sidebar), the docked placement is held at its last value so a re-fit
  // re-render cannot overwrite the dragged position (React only writes style values that changed).
  const isDraggingGlobal = useAppStore(state => state.isDraggingGlobal);
  const [heldDockArea, setHeldDockArea] = useState(visibleArea);
  if (!isDraggingGlobal && !sameVisibleArea(heldDockArea, visibleArea)) setHeldDockArea(visibleArea);
  const dockArea = isDraggingGlobal ? heldDockArea : visibleArea;

  const customThemeColor = useAppStore(state => state.customThemeColor);

  const isHydrated = useAppStore(state => state.isHydrated);
  useOpenWithFiles(isHydrated);

  const activeExtensionPanelId = useAppStore(state => state.activeExtensionPanelId);
  const activeExtensionAnchorRect = useAppStore(state => state.activeExtensionAnchorRect);
  const extensionReloadTrigger = useAppStore(state => state.extensionReloadTrigger);
  // T-206: plugin roots remount on every data context switch (load / save / isolation toggle / delete).
  const dataContextId = useAppStore(state => state.dataContextId);
  const extensionsRegistry = useExtensionRegistry();

  // T-601: data-scheme / data-accent from the v26 fields. Until the store is hydrated the historical look (dark + amber)
  // is shown, and the persisted scheme (system / light / dark) is rendered once hydrated (T-608/R-02: shared with the Settings window,
  // src/theme/root.ts).
  const { scheme: themeScheme, accent: themeAccent, customAccent: themeCustomAccent } =
    effectiveThemePrefs(isHydrated, { scheme, accent, customThemeColor });
  useEffect(
    () => startThemeSync(document.documentElement, { scheme: themeScheme, accent: themeAccent, customAccent: themeCustomAccent }),
    [themeScheme, themeAccent, themeCustomAccent]
  );

  // v1 root attributes (data-theme = reverse mapping of the resolved accent; data-design),
  // data-material and data-density (T-602, v27), once the store is ready from disk. Until then the :root token defaults
  // apply (normal density, solid material).
  useEffect(() => {
    if (!isHydrated) return;
    applyRootAppearance(document.documentElement, { accent, customThemeColor, design, material, density });
    clearLegacyThemeCSS();
  }, [accent, customThemeColor, design, material, density, isHydrated]);

  // T-202: persistent warning when saving kobar-storage fails (once per failure streak).
  useEffect(() => {
    return installPersistWarning(
      (failure) => showPersistWarningBanner(useAppStore.getState().language, failure),
      hidePersistWarningBanner
    );
  }, []);

  // Load dynamic extensions. T-409: a full reload only when extensionFullReloadTrigger moved (see pluginLoader.ts);
  // otherwise only the enabled-set diff is injected or unloaded.
  useEffect(() => {
    if (!isHydrated) return;

    if (typeof window.api?.getInstalledExtensions === 'function') {
      void appPluginLoader.request(useAppStore.getState().extensionFullReloadTrigger);
    }

    return () => {
      // Intentionally avoiding removing scripts on unmount if it's just a re-render.
      // The reload trigger handles cleanup explicitly above.
    };
  }, [isHydrated, extensionReloadTrigger]);

  // T-410: the shell no longer cleans the KoBox folder; only the KoBox plugin calls window.api.cleanKoBox.
  // koBoxCleanupMode stays persisted (partialize) so the plugin can keep reading it.

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    if (window.api?.getScreenBounds) {
      window.api.getScreenBounds().then(bounds => {
        if (bounds) useAppStore.getState().setScreenBounds(bounds);
      }).catch(err => console.error('Failed to get screen bounds:', err));
    }
    if (window.api?.onEdgeChanged) {
      // T-322: on Windows only the bounds are taken (main's edge is always 'left' for the fitted window); see applyEdgeChanged.
      unsubs.push(window.api.onEdgeChanged((edge, bounds) => applyEdgeChanged(edge, bounds)));
    }
    if (window.api?.onPinnedWindowChanged) {
      unsubs.push(window.api.onPinnedWindowChanged((hwnd) => {
        setPinnedWindowHwnd(hwnd);
      }));
    }
    if (window.api?.onForceCenterMiniMode) {
      unsubs.push(window.api.onForceCenterMiniMode(() => {
        const screenBounds = useAppStore.getState().screenBounds;
        const isMac = useAppStore.getState().isMac;
        if (isMac) {
          // Vertically center it inside the visible screen bounds (Y=0 is top of screen)
          const visibleHeight = screenBounds?.height ?? getWindowGeometry().fallbackScreenHeight;
          useAppStore.getState().setMiniMode(true, { x: Math.floor(window.innerWidth / 2), y: Math.floor(visibleHeight / 2) });
        } else {
          // T-322: the centre of the usable screen area (work area) in window coordinates.
          useAppStore.getState().setMiniMode(true, centeredEyePosition(computeVisibleArea(getWindowGeometry(), screenBounds)));
        }
      }));
    }
    if (window.api?.onOpenSettings) {
      unsubs.push(window.api.onOpenSettings(() => {
        useAppStore.getState().setMiniMode(false);
        useAppStore.getState().openSettingsTab();
      }));
    }
    if (window.api?.onPinTargetingComplete) {
      unsubs.push(window.api.onPinTargetingComplete(() => {
        setIsTargetingMode(false);
      }));
    }


    // KoPlayer: Subscribe to media updates from the main process
    if (window.api?.onMediaUpdate) {
      unsubs.push(window.api.onMediaUpdate((data) => {
        // One setState per update so subscribers see a consistent media + source pair and render once.
        useAppStore.setState({
          currentMedia: data,
          currentMediaSourceApp: (data?.sourceAppId || '').toLowerCase(),
        });
      }));
    }

    // Video PiP: Subscribe to background-scanned video URL cache
    if (window.api?.onVideoUrlsUpdate) {
      unsubs.push(window.api.onVideoUrlsUpdate((urls) => {
        useAppStore.getState().setActiveVideoUrls(urls);
      }));
    }

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [setPinnedWindowHwnd, setIsTargetingMode]);

  // T-322: keep the bar and the mini-mode eye on screen when main re-fits the window to a display.
  useEffect(() => installWindowLayoutSync(), []);

  // Persist tracking across any possible re-renders without falling out of scope
  const lastIgnoreState = useRef<boolean | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // If we are currently resizing the UI, ALWAYS KEEP MOUSE EVENTS ACTIVE. 
      // Do not allow the OS to steal the mouseup event through the ghost window.
      if (isResizingGlobal) {
        if (lastIgnoreState.current !== false) {
          window.api?.setIgnoreMouseEvents(false);
          lastIgnoreState.current = false;
        }
        return;
      }

      const target = e.target as HTMLElement;
      
      // If the target or any of its parents has pointer-events-auto, it is a solid UI element.
      // Otherwise, we consider it a transparent part of the ghost window.
      const isSolid = target.closest('.pointer-events-auto') !== null;
      const isTransparent = !isSolid;

      // IPC Flood Protection: Only trigger Electron main process communication linearly on pure state boundary crossings
      if (isTransparent !== lastIgnoreState.current) {
        const isMacLocal = useAppStore.getState().isMac;
        if (isMacLocal) {
          requestAnimationFrame(() => {
            window.api?.setIgnoreMouseEvents(isTransparent);
          });
        } else {
          window.api?.setIgnoreMouseEvents(isTransparent);
        }
        lastIgnoreState.current = isTransparent;
      }
    };
    
    // MAC-032: window.api.stopEyeDropper() (electron/preload.cts) puts the window back to click-through and fires this event;
    // the cache must follow, so the next mousemove over a solid element sends `false` again.
    const handleClickThroughReset = () => {
      lastIgnoreState.current = true;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener(CLICK_THROUGH_RESET_EVENT, handleClickThroughReset);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener(CLICK_THROUGH_RESET_EVENT, handleClickThroughReset);
    };
  }, []);

  const sidebarPosition = useAppStore(state => state.sidebarPosition);
  const language = useAppStore(state => state.language);

  return (
    <>
      <div 
        className={`relative w-full h-full pointer-events-none flex ${
          sidebarPosition 
            ? 'items-start pt-[20px]' /* Free floating: default placement */
            : (orientation === 'horizontal'
                ? (edgePosition === 'top' ? 'items-start justify-center pt-0' : 'items-end justify-center pb-0')
                : (isMac 
                    ? (edgePosition === 'left' ? 'items-start justify-start pt-[20px]' : 'items-start justify-end pt-[20px]')
                    : 'items-start justify-center pt-[20px]'))
        }`}
        style={{
          transform: `translate(0px, 0px)`
        }}
      >
        <div 
          id="kobar-sidebar-wrapper"
          className={`relative pointer-events-auto shrink-0 transition-opacity duration-300 ${isMiniMode ? 'opacity-0 pointer-events-none invisible' : 'opacity-100 visible'}`}
          style={{ 
            width: orientation === 'horizontal' ? 'fit-content' : `${sidebarWidth}px`, 
            height: orientation === 'horizontal' ? `${sidebarWidth}px` : 'fit-content',
            zIndex: 30,
            ...(sidebarPosition 
              ? { position: 'absolute' as const, left: sidebarPosition.x, top: sidebarPosition.y } 
              : (orientation === 'horizontal'
                  ? (legacyDock
                      ? { 
                          position: 'absolute' as const, 
                          left: '50%', 
                          transform: 'translateX(-50%)', 
                          top: edgePosition === 'top' ? 0 : `${(screenBounds?.height ?? window.innerHeight) - sidebarWidth}px` 
                        }
                      : {
                          // T-322: centred on the usable screen area, docked to its top / bottom edge (window coordinates).
                          position: 'absolute' as const,
                          left: `${dockArea.centerX}px`,
                          transform: 'translateX(-50%)',
                          top: `${edgePosition === 'top' ? dockArea.top : dockArea.bottom - sidebarWidth}px`
                        })
                  : (legacyDock
                      ? {}
                      : {
                          // T-322: what 'justify-center pt-[20px]' did in the ghost window (centred on the screen, 20px below its top),
                          // now relative to the usable screen area, which no longer is centred in the window (taskbar left/top).
                          position: 'absolute' as const,
                          left: `${dockArea.centerX - sidebarWidth / 2}px`,
                          top: `${dockArea.top + 20}px`
                        }))
            )
          }}>
          <Sidebar />
          {!isMiniMode && (
            <>
              {isNotePanelOpen && edgePosition === 'left' && (
                <div className="absolute top-0 pointer-events-none" style={{ left: '100%', zIndex: 20 }}>
                  <NotePanel />
                </div>
              )}
              {isNotePanelOpen && edgePosition === 'right' && (
                <div className="absolute top-0 pointer-events-none" style={{ right: '100%', zIndex: 20 }}>
                  <NotePanel />
                </div>
              )}
              {isNotePanelOpen && edgePosition === 'top' && (
                <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none pt-2" style={{ top: '100%', zIndex: 20 }}>
                  <NotePanel />
                </div>
              )}
              {isNotePanelOpen && edgePosition === 'bottom' && (
                <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none pb-2" style={{ bottom: '100%', zIndex: 20 }}>
                  <NotePanel />
                </div>
              )}

              {/* Context-bound Popups */}
              
              {/* Dynamic Extensions Popups */}
              {activeExtensionPanelId && (() => {
                const panel = extensionsRegistry.getPanel(activeExtensionPanelId);
                if (!panel) return null;
                return (
                  // T-503: v1 plugin panels hardcode light-on-dark colors, so their root always resolves the dark
                  // scheme tokens. display: contents keeps the plugin's own layout untouched.
                  // R-15: the host wrapper (same dark scheme + display: contents) also moves the panel along the bar's free axis.
                  <PluginPanelHost key={`${activeExtensionPanelId}-${dataContextId}`} pluginId={activeExtensionPanelId} orientation={orientation} area={visibleArea}>
                    {panel.render({
                      onClose: () => useAppStore.setState({ activeExtensionPanelId: null }),
                      anchorRect: activeExtensionAnchorRect
                    })}
                  </PluginPanelHost>
                );
              })()}

            </>
          )}
        </div>
      </div>

      {isMiniMode && <FloatingEye />}

      <Onboarding />

      {/* T-152: recovery panel after a failed kobar-storage hydration (renders nothing otherwise) */}
      <HydrationRecovery />

      {/* T-615a: restore dialog opened by the Settings window's relayed backup.restore action */}
      <RestoreDialogHost />
      {/* T-615b: settings / notes export-import dialog opened by the Settings window's relayed data.* actions */}
      <DataTransferDialogHost />
      {/* T-624: informational messages (outcomes) are toasts; the eye bubble keeps only hints */}
      <ToastRegion dismissLabel={translate(language, 'tutorialBtnOk')} />
    </>
  );
};

export default App;
