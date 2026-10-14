import { enTable, getLocaleTable } from './index';
import type { TranslationKeys } from './index';

/**
 * Pure translate: language table first, then English, then the key itself.
 * `store.t` (plugin v1 contract) delegates to this, so the behaviour is shared.
 */
export function translate(language: string | undefined, key: TranslationKeys): string {
    const lang = language || 'tr';
    return getLocaleTable(lang)?.[key] || enTable[key] || key;
}
