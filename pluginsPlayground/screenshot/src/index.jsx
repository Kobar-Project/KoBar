import React, { useEffect } from 'react';
import { useScreenshotStore } from './useScreenshotStore';
import ScreenshotOverlay from './ScreenshotOverlay';
import AnnotationEditor from './AnnotationEditor';

const PluginRoot = () => {
    const phase = useScreenshotStore(s => s.phase);
    
    // Auto-close the panel when the screenshot session finishes or is cancelled
    useEffect(() => {
        if (phase === 'idle') {
            const appStore = window.useAppStore.getState();
            if (appStore.activeExtensionPanelId === 'screenshot-studio-panel') {
                window.useAppStore.setState({ activeExtensionPanelId: null });
            }
        }
    }, [phase]);

    // Render the overlays if not idle
    if (phase === 'idle') return null;

    return (
        <React.Fragment>
            <ScreenshotOverlay />
            <AnnotationEditor />
        </React.Fragment>
    );
};

// Register the Sidebar Button
window.KoBarExtensions.registerSidebarButton({
    id: 'screenshot-studio-plugin',
    icon: 'camera',
    label: 'Screenshot Studio',
    onClick: (e, anchorRect) => {
        // Trigger capture via IPC
        const store = useScreenshotStore.getState();
        store.setPhase('capturing');
        
        // Open the plugin panel to mount the Root component
        window.useAppStore.getState().closeAllUtilityPopups();
        window.useAppStore.setState({ 
            activeExtensionPanelId: 'screenshot-studio-panel',
            activeExtensionAnchorRect: anchorRect
        });
    }
});

// Register the Panel
window.KoBarExtensions.registerPanel('screenshot-studio-panel', {
    id: 'screenshot-studio-panel',
    render: (props) => React.createElement(PluginRoot, props)
});
