import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { translate } from './translate';
import type { TranslationKeys } from '.';

/**
 * Returns the translate function and re-renders the component when the language changes.
 * Shares `translate` with `store.t` (plugin v1 contract, unchanged) so lookup and fallbacks stay identical.
 */
export function useT(): (key: TranslationKeys) => string {
    const language = useAppStore((s) => s.language);
    return useCallback((key: TranslationKeys) => translate(language, key), [language]);
}
