// Synthetic v1 plugin fixture for the e2e smoke test (tests/e2e/smoke.spec.ts).
// It only uses the v1 contract (window.KoBarExtensions / window.React) and touches no window.api feature.
const ext = window.KoBarExtensions;
const React = window.React;

ext.registerSidebarButton({
    id: 'e2e-smoke-plugin',
    icon: 'science',
    label: 'E2E Smoke',
    onClick: () => {},
});

ext.registerPanel('e2e-smoke-plugin', {
    id: 'e2e-smoke-plugin',
    render: () => React.createElement('div', { 'data-testid': 'e2e-smoke-panel' }, 'E2E Smoke'),
});
