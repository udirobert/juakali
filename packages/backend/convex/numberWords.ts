/**
 * Locale number-word tables for voice KPI parsing.
 *
 * Kenya-first: Swahili and English ship now. New markets add a table keyed
 * by the venture's locale; the parser tries digits first, then each table.
 * Keep tables to small counts (meetings, jobs) — large revenue figures are
 * spoken as digits everywhere.
 */

export type LocaleTable = Record<string, number>;

export const NUMBER_WORDS: Record<string, LocaleTable> = {
    en: {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
        sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
        thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
        eighty: 80, ninety: 90, hundred: 100,
    },
    sw: {
        moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5,
        sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
        kuminamoja: 11, kuminambili: 12, ishirini: 20,
        thelathini: 30, arobaini: 40, hamsini: 50,
        sitini: 60, sabini: 70, themanini: 80, tisini: 90, mia: 100,
    },
};

/** Default lookup order — venture locale first, then the rest. */
export const DEFAULT_LOCALE_ORDER = ["sw", "en"];
