import type { FeedbackType } from '../types/index.js';

/**
 * The eight feedback tags from the extension, unchanged.
 *
 * The product requires exactly one tag per rating — an untagged 👍 tells the
 * team nothing about *why* a draft worked. They live server-side rather than in
 * the widget so the model can offer the same wording in chat, and so phase 2
 * can serve them from the backend without touching the interface.
 */
export const FEEDBACK_TAGS: Record<FeedbackType, readonly string[]> = {
    like: [
        'Strong funder alignment',
        'Clear impact + metrics',
        'Used my context well',
        'Well framed for this audience',
    ],
    dislike: ['Too generic', 'Weak alignment', 'Missing impact or metrics', "Tone didn't fit"],
};

export function isFeedbackTag(type: FeedbackType, tag: string): boolean {
    return FEEDBACK_TAGS[type].includes(tag);
}
