import { describe, expect, it } from 'vitest';
import { buildHealthMessage } from '../../server/healthReport.mts';

const NOW = 1_800_000_000_000;

function getter(state: Record<string, unknown>) {
  return (key: string) => state[key];
}

const healthy = {
  'autopilot-last-run': { at: NOW - 4 * 60_000 },
  'live:kill-switch': { engaged: false, reason: null },
  'live:live-open-positions': {
    a: { quantity: 0.1559, entryPrice: 58.67 }, // real (~EUR 9)
    b: { quantity: 2.8e-5, entryPrice: 0.117 }, // dust
  },
  'live:confirmation-gate-pending': {},
  'live:live-equity-history': [{ at: 1, equity: 60 }, { at: 2, equity: 61.66 }],
  'live:live-cash-eur': 59.66,
  'equity-history': [{ at: 1, equity: 10300 }],
  'portfolio-engine': { initialCash: 10000 },
  'sentiment-shadow-standings': { standing: { inPosition: true, returnPct: 0.5, btcReturnPct: 1.2 } },
};

describe('buildHealthMessage', () => {
  it('reports a live bot, counts dust separately and shows both accounts', () => {
    const m = buildHealthMessage(getter(healthy), NOW, 'a20a6f8dc2797052');
    expect(m).toContain('✅ הבוט רץ — מחזור אחרון לפני 4 דקות');
    expect(m).toContain('a20a6f8');
    expect(m).toContain('מתג חירום: כבוי');
    expect(m).toContain('פוזיציות אמיתיות פתוחות: 1 (עוד 1 שאריות זעירות)');
    expect(m).toContain('אין בקשות אישור ממתינות');
    expect(m).toContain('€61.66');
    expect(m).toContain('€59.66');
    expect(m).toContain('3.0% מההתחלה');
    expect(m).toContain('מחזיק ביטקוין');
  });

  it('warns when the last cycle is stale, the kill switch is engaged or confirmations are pending', () => {
    const m = buildHealthMessage(
      getter({ ...healthy, 'autopilot-last-run': { at: NOW - 90 * 60_000 }, 'live:kill-switch': { engaged: true }, 'live:confirmation-gate-pending': { x: {}, y: {} } }),
      NOW,
      '',
    );
    expect(m).toContain('⚠️ הבוט לא רץ כבר 90 דקות');
    expect(m).toContain('מתג חירום: פעיל');
    expect(m).toContain('בקשות אישור ממתינות: 2');
    expect(m).toContain('לא ידוע');
  });

  it('never throws on an empty or malformed state', () => {
    expect(() => buildHealthMessage(() => undefined, NOW, '')).not.toThrow();
    expect(buildHealthMessage(() => undefined, NOW, '')).toContain('לא נמצא מחזור אחרון');
    expect(() => buildHealthMessage(() => 'garbage', NOW, '')).not.toThrow();
  });
});
