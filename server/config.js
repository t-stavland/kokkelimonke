// All tunable game numbers live here so a whole game night can be rebalanced in one place.
module.exports = {
  rounds: 8,
  writingSeconds: 45,
  votingSeconds: 30,
  minPlayers: 1, // set back to 3 for real game nights — the bluffing mechanic needs at least 2 fakes + the truth to work
  recommendedPlayers: 4,
  points: {
    correctGuess: 1000,
    perFool: 500,
    unanimousFoolBonus: 2000,
  },
  missedAnswerText: '(too slow — no answer)',
  port: process.env.PORT || 3000,
};
