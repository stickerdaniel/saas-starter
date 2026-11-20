import { MixedScheduler } from 'effect/Scheduler';

export const syncScheduler = () => new MixedScheduler('sync');
