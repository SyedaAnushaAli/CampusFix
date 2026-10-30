const { computePriority } = require('../src/priority');
const { checkTransition } = require('../src/workflow');

describe('priority scoring', () => {
  test('low urgency, no hazard, single report -> Low', () => {
    expect(computePriority({ urgency: 'low', safetyRisk: false, reportCount: 1 })).toEqual({ score: 10, label: 'Low' });
  });
  test('safety hazard raises a medium request to High', () => {
    expect(computePriority({ urgency: 'medium', safetyRisk: true, reportCount: 1 })).toEqual({ score: 45, label: 'High' });
  });
  test('high urgency + hazard is Critical', () => {
    expect(computePriority({ urgency: 'high', safetyRisk: true, reportCount: 1 }).label).toBe('Critical');
  });
  test('duplicate reports add weight but are capped', () => {
    const three = computePriority({ urgency: 'low', safetyRisk: false, reportCount: 3 }).score;
    const flood = computePriority({ urgency: 'low', safetyRisk: false, reportCount: 500 }).score;
    expect(three).toBe(20);
    expect(flood).toBe(35); // 10 + cap 25
  });
  test('invalid urgency is rejected', () => {
    expect(() => computePriority({ urgency: 'urgent!!', safetyRisk: false, reportCount: 1 })).toThrow();
  });
});

describe('status workflow', () => {
  test('technician can move Assigned -> In Progress', () => expect(checkTransition('Assigned', 'In Progress', 'technician').ok).toBe(true));
  test('cannot skip a step (Assigned -> Resolved)', () => expect(checkTransition('Assigned', 'Resolved', 'technician').ok).toBe(false));
  test('requester cannot start work', () => expect(checkTransition('Assigned', 'In Progress', 'requester').forbidden).toBe(true));
  test('resolving requires a note', () => expect(checkTransition('In Progress', 'Resolved', 'technician').noteRequired).toBe(true));
});
