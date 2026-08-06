// Citations for the formation curriculum. Split from curriculum.ts to keep
// both files under the 500-line house limit.
//
// Every URL below was fetched and returned 200 at the time of writing, and
// every paragraph number was checked against the fetched text, not against
// memory. A citation with url: null means no live authoritative English link
// could be verified; the document is named honestly instead of linked wrongly.
// (The USCCB site sits behind a bot challenge that serves a "checking
// connection" page to non-browsers, so its pages could not be verified live.)
//
// Citations ground what the curriculum already says in universal or national
// sources. They never speak for a diocese or a parish: on policyGap modules
// the local written policy still governs, exactly as the banner says.

export interface Citation {
    source: string; // document name, e.g. 'General Instruction of the Roman Missal'
    ref: string | null; // locus within it, e.g. 'no. 73'
    gloss: string; // what this reference establishes for the section
    url: string | null; // verified link, or null for an honest unlinked citation
}

// The English GIRM on vatican.va includes the adaptations for the dioceses of
// the United States. Paragraphs 43, 73, 160, and 280 were each checked
// against this text.
const GIRM =
    'https://www.vatican.va/roman_curia/congregations/ccdds/documents/rc_con_ccdds_doc_20030317_ordinamento-messale_en.html';
const GIRM_NAME = 'General Instruction of the Roman Missal';

export const CITATIONS: Record<string, Citation[]> = {
    doorkeeperOrder: [
        {
            source: 'Ministeria Quaedam',
            ref: 'Paul VI, motu proprio, 15 August 1972, norms II-IV',
            gloss: 'Ended the minor orders, porter among them, and kept only the lay ministries of lector and acolyte. This is the document behind "the order is gone; the work is not." Latin text.',
            url: 'https://www.vatican.va/content/paul-vi/la/motu_proprio/documents/hf_p-vi_motu-proprio_19720815_ministeria-quaedam.html',
        },
    ],
    doorkeeperLaity: [
        {
            source: 'Lumen Gentium',
            ref: 'no. 31',
            gloss: 'The laity share by baptism in the priestly, prophetic, and kingly work of Christ. Welcoming at the door is that mission itself, not borrowed clergy work.',
            url: 'https://www.vatican.va/archive/hist_councils/ii_vatican_council/documents/vat-ii_const_19641121_lumen-gentium_en.html',
        },
    ],
    beforeMassGreeting: [
        {
            source: 'Sacrosanctum Concilium',
            ref: 'no. 14',
            gloss: 'Full, conscious, and active participation by all the people is "the aim to be considered before all else." The greeting at the door is where it starts.',
            url: 'https://www.vatican.va/archive/hist_councils/ii_vatican_council/documents/vat-ii_const_19631204_sacrosanctum-concilium_en.html',
        },
    ],
    seatingPostures: [
        {
            source: GIRM_NAME,
            ref: 'no. 43',
            gloss: 'The assembly stands together for the Gospel and kneels together for the Eucharistic Prayer. Walking someone up the aisle then interrupts what the common posture is doing.',
            url: GIRM,
        },
    ],
    collectionGifts: [
        {
            source: GIRM_NAME,
            ref: 'no. 73',
            gloss: 'Money brought by the faithful or collected in the church is received with the gifts and put in a suitable place away from the Eucharistic table.',
            url: GIRM,
        },
    ],
    communionProcession: [
        {
            source: GIRM_NAME,
            ref: 'no. 160',
            gloss: 'The faithful approach as a rule in a procession. Pacing the rows is how an usher keeps it one.',
            url: GIRM,
        },
    ],
    communionLowGluten: [
        {
            source: 'Congregation for the Doctrine of the Faith, circular letter on low-gluten breads and mustum',
            ref: '24 July 2003, A-B',
            gloss: 'Low-gluten hosts are valid matter under set conditions, and a person who cannot receive the Host at all may receive from the chalice alone.',
            url: 'https://www.vatican.va/roman_curia/congregations/cfaith/documents/rc_con_cfaith_doc_20030724_pane-senza-glutine_en.html',
        },
    ],
    communionFallenHost: [
        {
            source: GIRM_NAME,
            ref: 'no. 280',
            gloss: 'A host that falls is picked up reverently. Guarding the spot until a minister comes is the usher\'s share of that reverence.',
            url: GIRM,
        },
        {
            source: 'Redemptionis Sacramentum',
            ref: 'no. 93',
            gloss: 'The communion-plate is retained so that no host or fragment falls. The same care is why a fallen Host is never stepped past.',
            url: 'https://www.vatican.va/roman_curia/congregations/ccdds/documents/rc_con_ccdds_doc_20040423_redemptionis-sacramentum_en.html',
        },
    ],
    difficultDignity: [
        {
            source: 'Code of Canon Law',
            ref: 'can. 1221',
            gloss: 'Entry to a church is to be free and open during the time of sacred celebrations. The open door is the law of the Church, not the usher\'s discretion.',
            url: 'https://www.vatican.va/archive/cod-iuris-canonici/eng/documents/cic_lib4-cann1205-1243_en.html',
        },
    ],
    safeEnvironmentCharter: [
        {
            source: 'Charter for the Protection of Children and Young People',
            ref: 'USCCB, 2002, revised 2018',
            gloss: 'The national charter behind every diocesan safe environment program: required training, background checks, and reporting. Your diocese\'s program is the one that governs you.',
            url: null,
        },
    ],
};
