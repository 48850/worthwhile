// contracts/topics.ts
//
// The fixed vocabulary the server classifies videos into, shared by the
// classifier (its prompt and output schema), the extension (on-device
// relevance and exclusions) and later the website (the interview).
//
//   TOPICS        what a video is about. The model picks 1-3 per video.
//   TOPIC_GROUPS  broader areas; an interest like "science" matches every
//                 topic in its group.
//   FORMATS       what kind of video it is (lecture, reaction, prank...).
//   JUNK          what makes a video junk. Junk is cut at every Range
//                 setting.
//
// Aliases are the words people use for each entry (in an interest, an
// exclusion, or the interview). They're matched after lower-casing and
// turning punctuation into spaces, as whole phrases.
//
// Changing an id changes what the server returns, so bump
// CLASSIFIER_VERSION in shared/classify.ts with it.

export type TopicGroupId =
  | 'science'
  | 'maths'
  | 'technology'
  | 'humanities'
  | 'arts'
  | 'music'
  | 'games'
  | 'sport'
  | 'lifestyle'
  | 'society'
  | 'entertainment';

export interface TopicGroup {
  id: TopicGroupId;
  label: string;
  aliases: string[];
}

export interface Topic {
  id: string;
  label: string;
  group: TopicGroupId;
  aliases: string[];
}

export const TOPIC_GROUPS: TopicGroup[] = [
  { id: 'science', label: 'Science', aliases: ['science', 'sciences', 'natural science', 'stem'] },
  { id: 'maths', label: 'Maths', aliases: [] }, // "maths" itself is the mathematics topic
  { id: 'technology', label: 'Technology', aliases: ['technology', 'tech'] },
  { id: 'humanities', label: 'Humanities', aliases: ['humanities'] },
  { id: 'arts', label: 'Arts', aliases: ['arts', 'the arts', 'art and culture'] },
  { id: 'music', label: 'Music', aliases: [] }, // "music" itself is the popular music topic
  { id: 'games', label: 'Games', aliases: ['games'] },
  { id: 'sport', label: 'Sport', aliases: [] }, // "sport" itself is the sport topic
  { id: 'lifestyle', label: 'Lifestyle', aliases: ['lifestyle'] },
  { id: 'society', label: 'Society', aliases: [] }, // "society" itself is the society topic
  { id: 'entertainment', label: 'Entertainment', aliases: ['entertainment'] },
];

export const TOPICS: Topic[] = [
  // Science
  { id: 'physics', label: 'Physics', group: 'science', aliases: ['physics', 'quantum', 'quantum physics', 'relativity', 'particle physics'] },
  { id: 'astronomy', label: 'Astronomy and space', group: 'science', aliases: ['astronomy', 'space', 'astrophysics', 'cosmology', 'spaceflight', 'space exploration', 'planets'] },
  { id: 'chemistry', label: 'Chemistry', group: 'science', aliases: ['chemistry'] },
  { id: 'biology', label: 'Biology', group: 'science', aliases: ['biology', 'evolution', 'genetics', 'ecology', 'microbiology'] },
  { id: 'medicine', label: 'Medicine and health science', group: 'science', aliases: ['medicine', 'health science', 'anatomy'] },
  { id: 'psychology', label: 'Psychology and neuroscience', group: 'science', aliases: ['psychology', 'neuroscience', 'the brain', 'cognitive science'] },
  { id: 'earth-science', label: 'Earth and climate', group: 'science', aliases: ['earth science', 'geology', 'climate', 'climate change', 'weather', 'oceans', 'oceanography', 'volcanoes'] },
  { id: 'engineering', label: 'Engineering', group: 'science', aliases: ['engineering', 'inventions', 'machines', 'manufacturing', 'how things work'] },
  { id: 'nature', label: 'Nature and wildlife', group: 'science', aliases: ['nature', 'wildlife', 'animals', 'nature documentaries', 'plants', 'marine life'] },

  // Maths
  { id: 'mathematics', label: 'Mathematics', group: 'maths', aliases: ['mathematics', 'maths', 'math', 'geometry', 'algebra', 'number theory', 'statistics', 'probability'] },

  // Technology
  { id: 'computing', label: 'Computing and programming', group: 'technology', aliases: ['computing', 'programming', 'coding', 'software', 'computer science', 'software engineering'] },
  { id: 'ai', label: 'Artificial intelligence', group: 'technology', aliases: ['ai', 'artificial intelligence', 'machine learning'] },
  { id: 'consumer-tech', label: 'Gadgets and consumer tech', group: 'technology', aliases: ['consumer tech', 'gadgets', 'tech reviews', 'phones', 'smartphones', 'pc building', 'computer hardware'] },
  { id: 'making', label: 'Electronics and making', group: 'technology', aliases: ['electronics', 'maker', 'making', 'diy electronics', 'robotics', '3d printing'] },
  { id: 'cars', label: 'Cars and motoring', group: 'technology', aliases: ['cars', 'automotive', 'motoring', 'motorsport', 'formula 1', 'f1', 'electric vehicles', 'evs'] },
  { id: 'aviation', label: 'Aviation', group: 'technology', aliases: ['aviation', 'planes', 'aircraft', 'flying'] },

  // Humanities
  { id: 'history', label: 'History', group: 'humanities', aliases: ['history', 'ancient history', 'military history', 'archaeology'] },
  { id: 'philosophy', label: 'Philosophy', group: 'humanities', aliases: ['philosophy', 'ethics', 'logic', 'stoicism'] },
  { id: 'literature', label: 'Literature and books', group: 'humanities', aliases: ['literature', 'books', 'reading', 'poetry', 'novels', 'writing', 'authors'] },
  { id: 'languages', label: 'Languages and linguistics', group: 'humanities', aliases: ['languages', 'linguistics', 'language learning', 'etymology'] },
  { id: 'geography', label: 'Geography and places', group: 'humanities', aliases: ['geography', 'maps', 'countries', 'geopolitics', 'cities', 'urbanism', 'urban planning'] },
  { id: 'religion', label: 'Religion and mythology', group: 'humanities', aliases: ['religion', 'mythology', 'theology'] },
  { id: 'economics', label: 'Economics', group: 'humanities', aliases: ['economics', 'the economy'] },
  { id: 'politics', label: 'Politics and current affairs', group: 'humanities', aliases: ['politics', 'current affairs', 'government', 'elections', 'policy'] },
  { id: 'law', label: 'Law and justice', group: 'humanities', aliases: ['law', 'legal', 'justice', 'courts'] },

  // Arts
  { id: 'theatre', label: 'Theatre', group: 'arts', aliases: ['theatre', 'theater', 'stage', 'plays', 'musicals', 'musical theatre', 'shakespeare', 'acting', 'broadway'] },
  { id: 'film', label: 'Film and filmmaking', group: 'arts', aliases: ['film', 'filmmaking', 'cinema', 'movies', 'film analysis', 'directing', 'screenwriting', 'cinematography'] },
  { id: 'tv', label: 'Television', group: 'arts', aliases: ['television', 'tv', 'tv shows', 'series'] },
  { id: 'animation', label: 'Animation', group: 'arts', aliases: ['animation', 'cartoons', 'anime'] },
  { id: 'visual-art', label: 'Visual art', group: 'arts', aliases: ['visual art', 'art', 'painting', 'drawing', 'illustration', 'art history', 'sculpture'] },
  { id: 'design', label: 'Design and architecture', group: 'arts', aliases: ['design', 'architecture', 'graphic design', 'typography', 'industrial design'] },
  { id: 'photography', label: 'Photography', group: 'arts', aliases: ['photography', 'cameras'] },
  { id: 'crafts', label: 'Crafts and restoration', group: 'arts', aliases: ['crafts', 'craft', 'woodworking', 'metalworking', 'restoration', 'handmade', 'blacksmithing', 'sewing', 'knitting'] },
  { id: 'horology', label: 'Watches and watchmaking', group: 'arts', aliases: ['horology', 'watches', 'watchmaking', 'independent watchmaking', 'clocks'] },
  { id: 'fashion', label: 'Fashion and style', group: 'arts', aliases: ['fashion', 'style', 'clothing'] },
  { id: 'dance', label: 'Dance', group: 'arts', aliases: ['dance', 'ballet'] },

  // Music
  { id: 'classical-music', label: 'Classical music', group: 'music', aliases: ['classical music', 'classical', 'orchestra', 'opera', 'conducting'] },
  { id: 'music', label: 'Popular music', group: 'music', aliases: ['music', 'popular music', 'songs', 'bands', 'albums', 'concerts', 'hip hop', 'rock', 'pop music', 'jazz'] },
  { id: 'music-making', label: 'Music theory and production', group: 'music', aliases: ['music theory', 'music production', 'instruments', 'guitar', 'piano', 'composing', 'songwriting'] },

  // Games
  { id: 'chess', label: 'Chess', group: 'games', aliases: ['chess'] },
  { id: 'board-games', label: 'Board games and puzzles', group: 'games', aliases: ['board games', 'tabletop', 'card games', 'puzzles', 'crosswords', 'rubiks cube'] },
  { id: 'video-games', label: 'Video games', group: 'games', aliases: ['video games', 'gaming', 'game design', 'speedrunning', 'esports'] },

  // Sport
  { id: 'sport', label: 'Sport', group: 'sport', aliases: ['sport', 'sports', 'football', 'soccer', 'basketball', 'cricket', 'tennis', 'olympics', 'athletics'] },
  { id: 'fitness', label: 'Fitness and training', group: 'sport', aliases: ['fitness', 'exercise', 'workouts', 'gym', 'running', 'yoga'] },
  { id: 'outdoors', label: 'Outdoors and adventure', group: 'sport', aliases: ['outdoors', 'adventure', 'hiking', 'climbing', 'camping', 'sailing', 'survival', 'expeditions'] },

  // Lifestyle
  { id: 'food', label: 'Food and cooking', group: 'lifestyle', aliases: ['food', 'cooking', 'recipes', 'baking', 'restaurants'] },
  { id: 'travel', label: 'Travel', group: 'lifestyle', aliases: ['travel', 'travelling', 'traveling'] },
  { id: 'home', label: 'Home, DIY and gardening', group: 'lifestyle', aliases: ['home', 'diy', 'home improvement', 'gardening', 'renovation'] },
  { id: 'personal-finance', label: 'Money and personal finance', group: 'lifestyle', aliases: ['personal finance', 'money', 'investing', 'finance', 'budgeting', 'stocks'] },
  { id: 'business', label: 'Business and entrepreneurship', group: 'lifestyle', aliases: ['business', 'entrepreneurship', 'startups', 'companies', 'marketing'] },
  { id: 'self-improvement', label: 'Self-improvement and productivity', group: 'lifestyle', aliases: ['self improvement', 'productivity', 'motivation', 'habits', 'self help'] },
  { id: 'wellbeing', label: 'Health and wellbeing', group: 'lifestyle', aliases: ['health', 'wellbeing', 'nutrition', 'diet', 'sleep', 'mental health'] },
  { id: 'family', label: 'Family and parenting', group: 'lifestyle', aliases: ['family', 'parenting'] },
  { id: 'beauty', label: 'Beauty and grooming', group: 'lifestyle', aliases: ['beauty', 'makeup', 'skincare', 'grooming'] },
  { id: 'pets', label: 'Pets', group: 'lifestyle', aliases: ['pets', 'dogs', 'cats'] },

  // Society
  { id: 'news', label: 'News', group: 'society', aliases: ['news', 'world news'] },
  { id: 'true-crime', label: 'True crime', group: 'society', aliases: ['true crime', 'crime'] },
  { id: 'internet-culture', label: 'Internet culture', group: 'society', aliases: ['internet culture', 'memes', 'influencers', 'youtubers', 'social media'] },
  { id: 'society', label: 'Society and culture', group: 'society', aliases: ['society', 'culture', 'social issues', 'sociology', 'anthropology'] },

  // Entertainment
  { id: 'comedy', label: 'Comedy', group: 'entertainment', aliases: ['comedy', 'stand up', 'standup', 'sketches', 'satire', 'humour', 'humor', 'funny videos'] },
  { id: 'celebrity', label: 'Celebrities and pop culture', group: 'entertainment', aliases: ['celebrities', 'celebrity', 'pop culture'] },
  { id: 'challenges', label: 'Challenges and stunts', group: 'entertainment', aliases: ['challenges', 'challenge videos', 'stunts', 'giveaways'] },
  { id: 'vlogs', label: 'Lifestyle vlogs', group: 'entertainment', aliases: ['vlogs', 'day in the life'] },
  { id: 'ambience', label: 'Ambience and relaxation', group: 'entertainment', aliases: ['ambience', 'asmr', 'sleep sounds', 'lofi', 'background music', 'relaxation'] },
  { id: 'kids', label: "Children's content", group: 'entertainment', aliases: ['kids', 'kids videos', 'childrens content', 'nursery rhymes'] },
];

export const TOPIC_IDS: string[] = TOPICS.map((t) => t.id);

/** What kind of video it is, regardless of topic. */
export const FORMATS = [
  'explainer',
  'lecture',
  'documentary',
  'analysis', // video essay, critique, breakdown
  'tutorial', // how-to, lesson
  'performance', // a full performance: concert, play, recital, game
  'interview',
  'podcast',
  'news-report',
  'review',
  'commentary', // a creator's opinion on something
  'vlog',
  'sketch', // comedy sketch, skit
  'gameplay',
  'music-video',
  'compilation',
  'reaction',
  'prank',
  'challenge',
  'list', // top-N, rankings
  'clip', // an excerpt of a longer show, stream or podcast
  'other',
] as const;
export type Format = (typeof FORMATS)[number];

/** Words for each format, for exclusions like "reaction videos" or "top 10 lists". */
export const FORMAT_ALIASES: Partial<Record<Format, string[]>> = {
  lecture: ['lectures', 'talks'],
  documentary: ['documentaries'],
  analysis: ['video essays', 'essays', 'breakdowns'],
  tutorial: ['tutorials', 'how to', 'how tos', 'lessons'],
  podcast: ['podcasts'],
  'news-report': ['news reports'],
  review: ['reviews', 'unboxings'],
  commentary: ['commentary', 'commentary channels', 'opinion videos'],
  vlog: ['vlogs'],
  sketch: ['sketches', 'skits'],
  gameplay: ['gameplay', 'lets plays', 'lets play'],
  'music-video': ['music videos'],
  compilation: ['compilations', 'compilation videos'],
  reaction: ['reactions', 'reaction videos', 'reaction content'],
  prank: ['pranks', 'prank videos'],
  challenge: ['challenges', 'challenge videos', 'stunts'],
  list: ['lists', 'listicles', 'rankings', 'top 10 lists', 'top ten lists', 'generic top 10 lists', 'top 10s'],
  clip: ['clips', 'podcast clips', 'stream clips', 'streamer clips'],
};

/** What makes a video junk. Junk is cut at every Range setting. */
export const JUNK = [
  'ragebait', // made to provoke outrage
  'engagement_bait', // fake giveaways, "comment X", manufactured suspense
  'ai_slop', // low-effort AI-generated voice, images or script
  'repost_farm', // other people's clips re-uploaded or stitched together
  'reaction_farm', // reacting to someone else's video while adding little
  'misleading_clickbait', // the title or thumbnail promises what the video doesn't deliver
  'scam_or_gambling', // get-rich schemes, crypto pumps, betting and casino promotions
  'drama_farming', // creator feuds, gossip and drama for its own sake
] as const;
export type JunkCategory = (typeof JUNK)[number];

/** Words for each junk category, for exclusions written in a user's own words. */
export const JUNK_ALIASES: Record<JunkCategory, string[]> = {
  ragebait: ['ragebait', 'rage bait', 'outrage', 'outrage bait'],
  engagement_bait: ['engagement bait', 'engagement farming'],
  ai_slop: ['ai slop', 'slop', 'ai generated slop', 'ai generated', 'ai generated content'],
  repost_farm: ['reposts', 'reuploads', 'repost channels', 'stolen clips'],
  reaction_farm: ['reaction farms', 'reaction channels'],
  misleading_clickbait: ['clickbait', 'clickbait titles', 'clickbait titles that overpromise', 'misleading titles'],
  scam_or_gambling: ['scams', 'gambling', 'betting', 'get rich', 'get rich quick', 'get rich content', 'hustle', 'hustle content', 'hustle culture', 'crypto schemes'],
  drama_farming: ['drama', 'gossip', 'drama and gossip', 'creator drama', 'youtube drama'],
};

/** Lower case, with anything that isn't a letter or digit turned into a single space. */
export function normaliseWords(text: string): string {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
