// All tunable game numbers live here so a whole game night can be rebalanced in one place.
module.exports = {
  rounds: 8,
  writingSeconds: 45,
  votingSeconds: 30,
  minPlayers: 3,
  recommendedPlayers: 4,
  points: {
    correctGuess: 1000,
    perFool: 500,
    unanimousFoolBonus: 2000,
  },
  missedAnswerText: '(too slow — no answer)',
  port: process.env.PORT || 3000,
};
