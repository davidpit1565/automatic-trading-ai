/**
 * Strategy Engine — order generators consumed by the backtesting engine.
 * All indicator math comes from the indicator engine; none is duplicated here.
 */

export { buyAndHoldStrategy } from './buyHold';
export { dcaStrategy } from './dca';
export { trendStrategy } from './trend';
export { gridStrategy, computeGridLevels } from './grid';
