const ADJECTIVES = [
  'BLUE', 'RED', 'GOLD', 'SILK', 'WILD', 'LOUD', 'DRY', 'SOUR', 'SLY', 'BOLD',
  'DARK', 'PINK', 'LAZY', 'JOLLY', 'ODD', 'RASH', 'SALTY', 'TIPSY', 'CRISP', 'ROGUE',
];

const NOUNS = [
  'FOX', 'OWL', 'BEAR', 'WOLF', 'CRAB', 'GOAT', 'DUCK', 'LYNX', 'HAWK', 'TOAD',
  'MOOSE', 'SEAL', 'MOLE', 'SWAN', 'RAM', 'YAK', 'NEWT', 'CROW', 'FROG', 'BAT',
];

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateRoomCode(isTaken) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = `${randomOf(ADJECTIVES)}${randomOf(NOUNS)}`;
    if (!isTaken(code)) return code;
  }
  // Extremely unlikely fallback if the small combo space is exhausted.
  return `${randomOf(ADJECTIVES)}${randomOf(NOUNS)}${Math.floor(Math.random() * 100)}`;
}

module.exports = { generateRoomCode };
