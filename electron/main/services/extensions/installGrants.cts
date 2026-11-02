// CNL: the app-wide install grants (electron/lib/installGrants.cts). Granted by the Settings window relay
// (windows/settingsSync.cts), consumed by the GitHub install handler (services/extensions/install.cts).
import { createInstallGrants } from '../../../lib/installGrants.cjs';

export const installGrants = createInstallGrants();
