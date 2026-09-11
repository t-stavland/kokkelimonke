// All tunable game numbers live here so a whole game night can be rebalanced in one place.
module.exports = {
  rounds: 8,
  revealStepSeconds: 3, // how long each answer stays on screen during the auto-playing reveal
  scoreboardSeconds: 8, // how long the scoreboard shows before auto-advancing to the next round
  minPlayers: 1, // temporarily lowered for solo testing — set back to 3 before the real game
  recommendedPlayers: 4,
  points: {
    correctGuess: 1000,
    perFool: 500,
    unanimousFoolBonus: 2000,
  },
  port: process.env.PORT || 3000,
};
