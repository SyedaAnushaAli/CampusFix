// Business rules: how urgent is a request? (pure functions, easy to unit test)
const URGENCY_WEIGHT = { low: 10, medium: 20, high: 30 };
const SAFETY_BONUS = 25;      // safety hazards jump the queue
const DUPLICATE_BONUS = 5;    // each extra independent report adds weight...
const DUPLICATE_CAP = 25;     // ...but is capped so spam cannot dominate the queue

function computePriority({ urgency, safetyRisk, reportCount }) {
  if (!(urgency in URGENCY_WEIGHT)) throw new Error('Invalid urgency');
  const extra = Math.min((Math.max(reportCount, 1) - 1) * DUPLICATE_BONUS, DUPLICATE_CAP);
  const score = URGENCY_WEIGHT[urgency] + (safetyRisk ? SAFETY_BONUS : 0) + extra;
  const label = score >= 50 ? 'Critical' : score >= 35 ? 'High' : score >= 20 ? 'Medium' : 'Low';
  return { score, label };
}
module.exports = { computePriority, URGENCY_WEIGHT };
