import { AiHubPanel } from './AiHubPanel';
import { SettingsPanel } from './SettingsPanel';

// Register Settings Panel
if (window.KoBarExtensions.registerSettingsPanel) {
    window.KoBarExtensions.registerSettingsPanel('com.kobar.aihub', {
        id: 'com.kobar.aihub',
        render: () => window.React.createElement(SettingsPanel)
    });
}

// Register Main Extension Panel
if (window.KoBarExtensions.registerPanel) {
    window.KoBarExtensions.registerPanel('com.kobar.aihub.panel', {
        id: 'com.kobar.aihub.panel',
        render: (props) => window.React.createElement(AiHubPanel, props)
    });
}

// Register Sidebar Button
if (window.KoBarExtensions.registerSidebarButton) {
    window.KoBarExtensions.registerSidebarButton({
        id: 'com.kobar.aihub.btn',
        icon: 'smart_toy',
        label: 'AI Hub (Plugin)',
        onClick: (e, anchorRect) => {
            window.useAppStore.getState().closeAllUtilityPopups();
            window.useAppStore.setState({
                activeExtensionPanelId: 'com.kobar.aihub.panel',
                activeExtensionAnchorRect: anchorRect
            });
        }
    });
}
