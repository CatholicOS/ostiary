// Usher formation curriculum. Single source of truth, served by GET /api/formation.
//
// Content lives here rather than in D1 so a pastor can review it as a diff and
// so a bad edit is revertable. Modules flagged policyGap describe general
// practice only: the local written policy governs, and the UI renders a
// standing banner saying so. Nothing here cites a specific diocesan policy,
// because no diocesan policy document was read while writing it.
//
// Sections that rest on a magisterial or liturgical source carry citations
// (see curriculum-citations.ts, where every link and paragraph number is
// verified). Citations point at universal or national documents only; they do
// not fill the policy gaps above.

import { CITATIONS, type Citation } from './curriculum-citations';

export interface CheckQuestion {
    q: string;
    options: string[];
    answer: number;
    why: string;
}

export interface ModuleSection {
    heading: string;
    body: string[];
    citations?: Citation[];
}

export interface FormationModule {
    slug: string;
    ord: number;
    title: string;
    minutes: number;
    summary: string;
    policyGap?: boolean;
    sections: ModuleSection[];
    check: CheckQuestion[];
}

export const CURRICULUM: FormationModule[] = [
    {
        slug: 'doorkeeper',
        ord: 1,
        title: 'Who the Doorkeeper Is',
        minutes: 10,
        summary: 'Where the ministry comes from, and what it is actually for.',
        sections: [
            {
                heading: 'An old job',
                body: [
                    'Until 1972 the Latin Church ordained men to the minor order of ostiarius, the porter. He held the keys, opened and shut the doors, and rang the bell. The order is gone; the work is not. You are what is left of it.',
                    'That matters because it tells you the work is liturgical, not logistical. You are not building security. You are opening a door.',
                ],
                citations: CITATIONS.doorkeeperOrder,
            },
            {
                heading: 'Hospitality as ministry',
                body: [
                    'Scripture is blunt about this. Romans 12:13 tells the Church to practice hospitality. Hebrews 13:2 warns that some have entertained angels without knowing it. Matthew 25:35 puts the whole thing in the mouth of Christ: I was a stranger and you welcomed me.',
                    'None of that is decoration. It means the person you cannot place, who is dressed wrong, who came in late and smells like the street, is the one the passage is about.',
                ],
                citations: CITATIONS.doorkeeperLaity,
            },
            {
                heading: 'The first face',
                body: [
                    'For a visitor, you are the parish. Whatever happens in the next hour gets read through the ten seconds you spent at the door.',
                    'Learn names. Use them. A parish where the usher knows your name is a parish people come back to.',
                ],
            },
        ],
        check: [
            {
                q: 'A visitor arrives who is clearly unhoused and carrying bags. What is the ministry?',
                options: [
                    'Direct them to the parish office after Mass',
                    'Welcome and seat them like any other person arriving',
                    'Ask them to leave the bags outside',
                ],
                answer: 1,
                why: 'Matthew 25:35 is not conditional. Seat them. If a genuine safety issue arises later, that is a different module.',
            },
            {
                q: 'The ministry of usher is best described as:',
                options: ['Building security', 'Crowd control', 'Liturgical hospitality'],
                answer: 2,
                why: 'It descends from a minor order attached to the liturgy. Safety is part of it, but it is not the frame.',
            },
        ],
    },
    {
        slug: 'before-mass',
        ord: 2,
        title: 'Before Mass',
        minutes: 12,
        summary: 'The thirty minutes that decide whether the next sixty go well.',
        sections: [
            {
                heading: 'Arrive early',
                body: [
                    'Thirty minutes before the Mass you are assigned to. Not fifteen. The work that prevents problems all happens before the first person walks in.',
                ],
            },
            {
                heading: 'The walk-through',
                body: [
                    'Walk the whole church. Doors unlocked and propped as needed. Lights and fans on. Worship aids, hymnals, and bulletins stocked at every entrance. Aisles clear. Nothing blocking an exit.',
                    'Look at the floor. Cords, mats, and kneelers left down are the most common way somebody gets hurt in a church.',
                ],
            },
            {
                heading: 'Know what is different today',
                body: [
                    'Check with the sacristan before every Mass. A baptism, a second collection, a visiting celebrant, a funeral following, a procession, a full choir moving the seating: any of these change what you do.',
                    'If reserved seating is needed for a family or a group, place it before anybody arrives, not while they are standing there.',
                ],
            },
            {
                heading: 'Then go stand at the door',
                body: [
                    'Ten minutes out, stop working and start greeting. Face the door. Make eye contact. Hand people what they need without being asked.',
                ],
                citations: CITATIONS.beforeMassGreeting,
            },
        ],
        check: [
            {
                q: 'How early should an usher arrive for an assigned Mass?',
                options: ['10 minutes', '30 minutes', 'Before the entrance hymn'],
                answer: 1,
                why: 'The preventive work takes about twenty minutes and has to finish before the assembly arrives.',
            },
            {
                q: 'Who should you check with about anything unusual happening at this Mass?',
                options: ['The sacristan', 'The choir director', 'Nobody, the bulletin covers it'],
                answer: 0,
                why: 'The sacristan knows about the baptism, the visiting celebrant, and the second collection before you do.',
            },
        ],
    },
    {
        slug: 'seating',
        ord: 3,
        title: 'Seating the Assembly',
        minutes: 12,
        summary: 'Latecomers, families, visitors, and reading an access need before it becomes a problem.',
        sections: [
            {
                heading: 'When not to seat anyone',
                body: [
                    'Do not walk anyone up the aisle during the proclamation of the Gospel, the homily, or the Eucharistic Prayer. Hold them at the back, quietly, and seat them at the next natural break.',
                    'Tell them why in four words: I will seat you shortly. Then actually do it. People forgive waiting. They do not forgive being forgotten at the back of a church.',
                ],
                citations: CITATIONS.seatingPostures,
            },
            {
                heading: 'Families with small children',
                body: [
                    'Offer the aisle end, and offer it early, so a parent can leave with a crying child without climbing over six people.',
                    'Never signal that a noisy child is a problem. If a parent takes a child out, catch their eye on the way back in and welcome them back.',
                ],
            },
            {
                heading: 'Reading an access need',
                body: [
                    'Watch how people come through the door. Someone using a cane or a walker, someone moving slowly, someone scanning for a rail: offer an aisle seat near the back before they have to ask for it.',
                    'Ask, do not assume. "Would an aisle seat be easier?" is right. Taking somebody by the arm is not. Never touch a wheelchair without permission; it is treated as part of the person.',
                    'If someone needs the hearing loop, communion brought to the pew, or a low-gluten host, you need to know today who to tell. Find out at your next meeting, not in the moment.',
                ],
            },
        ],
        check: [
            {
                q: 'A couple arrives during the homily. What do you do?',
                options: [
                    'Seat them immediately in the nearest pew',
                    'Hold them at the back and seat them at the next break',
                    'Let them find their own seats',
                ],
                answer: 1,
                why: 'Walking people up the aisle during the homily distracts the whole assembly. Hold, then seat.',
            },
            {
                q: 'Someone arrives using a wheelchair. What is the right first move?',
                options: [
                    'Take the handles and push them to the wheelchair space',
                    'Ask where they would like to sit and whether they want help',
                    'Point at the accessible section and go back to the door',
                ],
                answer: 1,
                why: 'A wheelchair is treated as part of the person. You ask before you touch it, every time.',
            },
        ],
    },
    {
        slug: 'collection',
        ord: 4,
        title: 'The Collection',
        minutes: 10,
        policyGap: true,
        summary: 'Procedure and custody. Your parish policy governs the specifics.',
        sections: [
            {
                heading: 'The two-person rule',
                body: [
                    'From the moment the baskets leave the assembly until the offering is secured, at least two people are with it at all times, and neither of them is alone with it at any point.',
                    'This protects the money. More importantly it protects you. An usher who is never alone with the offering can never be accused of anything.',
                ],
            },
            {
                heading: 'Taking up the collection',
                body: [
                    'Move at the pace the assembly sets, not faster. Start at the front or the back consistently so the assembly knows what is coming.',
                    'A second collection is announced. If you did not hear it announced, ask before you take it.',
                ],
                citations: CITATIONS.collectionGifts,
            },
            {
                heading: 'Custody',
                body: [
                    'The offering goes directly from the procession to wherever your parish secures it. It does not go into a sacristy corner, a car, or anybody home.',
                    'Counting is a separate ministry with its own team and its own rules. Ushers do not count.',
                ],
            },
            {
                heading: 'What this module does not tell you',
                body: [
                    'Where your parish secures the offering, who has access, what the deposit schedule is, and who to call if something is wrong are all local and are deliberately not written here.',
                    'Your coordinator fills that in. If it is blank at your parish, that gap is the finding.',
                ],
            },
        ],
        check: [
            {
                q: 'You are carrying the offering and your partner steps away to take a call. What do you do?',
                options: [
                    'Continue to the secure location alone',
                    'Stop, and wait until a second person is with you',
                    'Leave it in the sacristy and find them',
                ],
                answer: 1,
                why: 'Never alone with the offering, not even briefly. The rule exists to make you unaccusable.',
            },
            {
                q: 'Who counts the collection?',
                options: ['The ushers who took it up', 'A separate counting team', 'The captain'],
                answer: 1,
                why: 'Separating collection from counting is the whole control. Ushers do not count.',
            },
        ],
    },
    {
        slug: 'communion',
        ord: 5,
        title: 'The Communion Procession',
        minutes: 12,
        policyGap: true,
        summary: 'Directing rows, communion to those who cannot come forward, and what to do if a Host is dropped.',
        sections: [
            {
                heading: 'Pacing',
                body: [
                    'Release rows so the lines stay full but never crowded. Watch the ministers, not the clock. If a line is emptying, release faster; if people are stacking up in the aisle, slow down.',
                    'Use your hand, low and open. Not a beckon across the church, and not a voice.',
                ],
                citations: CITATIONS.communionProcession,
            },
            {
                heading: 'People who cannot come forward',
                body: [
                    'Know before Mass which pews have someone who needs communion brought to them, and know which minister is assigned to bring it. If nobody is assigned, that is something you fix before Mass, not during it.',
                    'Do not make the person signal for themselves in front of the assembly if it can be arranged beforehand.',
                ],
            },
            {
                heading: 'Low-gluten hosts and the chalice',
                body: [
                    'Some parishes reserve a low-gluten host in a separate pyx, and some offer the Precious Blood from a separate chalice for those who cannot receive the Host at all. These are different provisions and a person may need one, the other, or both.',
                    'Learn what your parish actually offers and where the person should go. Getting this wrong means somebody either does not receive or gets sick.',
                ],
                citations: CITATIONS.communionLowGluten,
            },
            {
                heading: 'If a Host is dropped',
                body: [
                    'Stay where it is. Do not let anyone step there. Signal the nearest priest, deacon, or extraordinary minister and let them handle it.',
                    'Do not pick it up yourself unless your parish has trained you to, and do not make a scene. Stand, guard the spot, get a minister.',
                ],
                citations: CITATIONS.communionFallenHost,
            },
        ],
        check: [
            {
                q: 'A Host falls to the floor during the procession. Your first action:',
                options: [
                    'Pick it up and consume it',
                    'Stand over the spot so nobody steps on it and signal a minister',
                    'Cover it with a worship aid and continue',
                ],
                answer: 1,
                why: 'Guard the spot, get a minister. Handling it yourself is only correct if your parish has trained you to.',
            },
            {
                q: 'A parishioner tells you before Mass they have celiac disease. What do you need to know?',
                options: [
                    'Nothing, that is between them and the priest',
                    'Whether your parish reserves a low-gluten host, offers a separate chalice, or neither',
                    'Which pew they are sitting in',
                ],
                answer: 1,
                why: 'They are two different provisions. Knowing which your parish actually has is the usher\'s job.',
            },
        ],
    },
    {
        slug: 'emergencies',
        ord: 6,
        title: 'Emergencies',
        minutes: 14,
        policyGap: true,
        summary: 'Medical episodes, evacuation, and the judgment call about interrupting Mass.',
        sections: [
            {
                heading: 'Know these four things cold',
                body: [
                    'Where the AED is. Where the first aid kit is. Where every exit is, including the ones the assembly does not use. The street address of the church, said out loud, because you will be asked for it on the phone and people forget it under stress.',
                ],
            },
            {
                heading: 'Medical episode',
                body: [
                    'One usher goes to the person. One usher calls 911 and does not hang up. One usher goes outside to meet the ambulance and bring them in by the fastest door. That is three people and it should be assigned before Mass, not sorted out in the aisle.',
                    'Clear space around the person. Do not crowd. If there is a physician or nurse in the assembly, most parishes know who they are; that is worth knowing in advance too.',
                ],
            },
            {
                heading: 'Evacuation',
                body: [
                    'Ushers open doors and direct, they do not lead a stampede. Take your assigned door, hold it, and keep people moving through it steadily.',
                    'Check the pews behind you on the way out. Somebody with limited mobility, or asleep, or in a side chapel, is the person a fast evacuation leaves behind.',
                ],
            },
            {
                heading: 'Interrupting Mass',
                body: [
                    'A medical emergency or a credible threat interrupts Mass. Almost nothing else does. A disruption, an argument, a phone, a fire alarm you are confident is false: handle it without stopping the liturgy.',
                    'When it does need to stop, the celebrant stops it. You get his attention; you do not announce it yourself.',
                ],
            },
            {
                heading: 'What this module does not tell you',
                body: [
                    'Your parish emergency plan, AED location, evacuation assignments, and who calls the pastor are local. This module does not invent them. Your coordinator fills them in.',
                ],
            },
        ],
        check: [
            {
                q: 'Someone collapses during Mass. How many ushers does the response need, at minimum?',
                options: ['One', 'Two', 'Three, assigned before Mass'],
                answer: 2,
                why: 'One with the person, one on the phone, one meeting the ambulance. Assigning it in the moment costs minutes.',
            },
            {
                q: 'Who stops the Mass?',
                options: ['The head usher', 'The celebrant', 'Whoever sees the emergency'],
                answer: 1,
                why: 'You get his attention. He stops it. An usher announcing from the aisle turns one emergency into two.',
            },
        ],
    },
    {
        slug: 'difficult-situations',
        ord: 7,
        title: 'Difficult Situations',
        minutes: 12,
        summary: 'Disruption, dignity, and the situations that go wrong slowly.',
        sections: [
            {
                heading: 'The general rule',
                body: [
                    'Go quietly, go in pairs, go early. Almost every situation that becomes a scene became one because somebody waited until it was loud and then responded loudly.',
                    'Speak to the person, not about them. Low voice, close, private. Never across a pew.',
                ],
            },
            {
                heading: 'Dignity is not optional',
                body: [
                    'Somebody who is intoxicated, or unwell, or unhoused, is not automatically a problem to be removed. The question is never who they are, it is whether the behavior in this moment is preventing the assembly from praying.',
                    'If a person does need to step outside, one usher goes with them and stays with them. You do not put somebody on the sidewalk and shut the door.',
                ],
                citations: CITATIONS.difficultDignity,
            },
            {
                heading: 'Photography, solicitation, and custody',
                body: [
                    'Nobody photographs a baptism or a wedding from the sanctuary steps unless the parish arranged it. Redirect them politely to where they can stand.',
                    'Nobody sells or solicits on parish property without the pastor\'s permission, including for causes that sound obviously good.',
                    'Custody disputes are the one situation where you do not improvise. If someone claims a right to take a child, you get the pastor and you call the police if anyone tries to remove a child over an objection. You do not adjudicate it.',
                ],
            },
            {
                heading: 'Media',
                body: [
                    'A reporter asking questions gets one sentence: the pastor or the parish office handles that. Then you get the pastor. No usher speaks for the parish, ever, however easy the question sounds.',
                ],
            },
        ],
        check: [
            {
                q: 'Someone becomes disruptive during Mass. What is the approach?',
                options: [
                    'Two ushers, quietly, early, speaking directly to the person',
                    'One usher, firmly, so the assembly sees it handled',
                    'Wait and see whether it resolves itself',
                ],
                answer: 0,
                why: 'Pairs, quiet, early. Loud and late is how a situation becomes a scene.',
            },
            {
                q: 'A reporter asks you about something that happened at the parish. You say:',
                options: [
                    'What you personally witnessed',
                    'That the pastor or parish office handles that, then get the pastor',
                    'No comment, and walk away',
                ],
                answer: 1,
                why: 'No usher speaks for the parish. Hand it up, politely, without being rude to the reporter.',
            },
        ],
    },
    {
        slug: 'safe-environment',
        ord: 8,
        title: 'Safe Environment and Boundaries',
        minutes: 12,
        policyGap: true,
        summary: 'The rules that are not yours to interpret.',
        sections: [
            {
                heading: 'This module is a pointer, not a policy',
                body: [
                    'Every diocese in the United States runs a safe environment program with its own required training, background check, reporting chain, and renewal schedule. Yours governs. Nothing written here replaces it or counts as completing it.',
                    'If you have not completed your diocese\'s safe environment requirement, you are not finished with this module no matter what this app records.',
                ],
                citations: CITATIONS.safeEnvironmentCharter,
            },
            {
                heading: 'Never alone with a minor',
                body: [
                    'Not in a sacristy, not in a car, not in a hallway, not in a side room. If a child needs help, you help in view of other adults, or you get another adult first.',
                    'This is not about suspicion of you. It is a structure that makes the parish safe and makes false accusation impossible, and it only works if it is absolute.',
                ],
            },
            {
                heading: 'Reporting',
                body: [
                    'If you see or suspect abuse or neglect, you report it. In many states volunteers in ministry are mandated reporters; your diocese will tell you whether you are one.',
                    'You report to civil authorities and to the diocesan reporting line. Reporting to the pastor is not a substitute for either, and no one at the parish can tell you not to report.',
                ],
            },
            {
                heading: 'What this module does not tell you',
                body: [
                    'Your diocese\'s program name, its reporting phone number, the renewal interval, and whether your state names you a mandated reporter are all local and are not written here. Your coordinator fills them in. A blank here is a real gap, not a formatting problem.',
                ],
            },
        ],
        check: [
            {
                q: 'A child needs help finding a parent and the sacristy is empty. What do you do?',
                options: [
                    'Take them into the sacristy to wait, it is quieter',
                    'Stay in view of other adults, or get a second adult first',
                    'Walk them to the parking lot to look',
                ],
                answer: 1,
                why: 'Never alone with a minor, without exception. The rule protects the child and it protects you.',
            },
            {
                q: 'You suspect abuse. Telling the pastor is:',
                options: [
                    'Sufficient, he handles it from there',
                    'Not a substitute for reporting to civil authorities and the diocesan line',
                    'Required before anything else',
                ],
                answer: 1,
                why: 'The report goes to civil authorities and the diocese. Nobody at the parish can stand between you and that.',
            },
        ],
    },
];

export function moduleBySlug(slug: string): FormationModule | undefined {
    return CURRICULUM.find((m) => m.slug === slug);
}
