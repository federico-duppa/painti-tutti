// Word list lives server-side only: if it shipped to the browser, the
// impostor could open devtools and shortlist the possible words.

export interface WordCard {
  category: string;
  word: string;
}

const WORDS: Record<string, string[]> = {
  Animals: ['elephant', 'penguin', 'octopus', 'giraffe', 'snail', 'flamingo', 'hedgehog', 'shark'],
  Food: ['pizza', 'sushi', 'spaghetti', 'croissant', 'taco', 'watermelon', 'fried egg', 'burger'],
  'Office life': ['stapler', 'standup meeting', 'coffee machine', 'whiteboard', 'keyboard', 'video call', 'lunch break', 'deadline'],
  'Things with wheels': ['skateboard', 'shopping cart', 'unicycle', 'tractor', 'stroller', 'train', 'wheelchair', 'scooter'],
  Places: ['beach', 'library', 'airport', 'volcano', 'castle', 'supermarket', 'gym', 'desert island'],
  Activities: ['fishing', 'karaoke', 'yoga', 'barbecue', 'camping', 'bowling', 'gardening', 'surfing'],
  Fantasy: ['dragon', 'wizard', 'mermaid', 'ghost', 'unicorn', 'robot', 'alien', 'vampire'],
};

export function randomWordCard(rng: () => number = Math.random): WordCard {
  const categories = Object.keys(WORDS);
  const category = categories[Math.floor(rng() * categories.length)];
  const words = WORDS[category];
  const word = words[Math.floor(rng() * words.length)];
  return { category, word };
}
