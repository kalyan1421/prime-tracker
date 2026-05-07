import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DomainEvent, DomainEventType, DomainEventOf } from './domain-events';

/**
 * In-process domain event bus.
 *
 * Use:
 *   constructor(private bus: EventBus) {}
 *   this.bus.emit({ type: 'milestone.completed', milestoneId, projectId, completedAt });
 *
 * Subscribe (typically in a *EventHandlers* service):
 *   constructor(private bus: EventBus) {
 *     bus.on('milestone.completed', (e) => this.handleMilestoneCompleted(e));
 *   }
 *
 * Errors in handlers are caught and logged — they do NOT bubble up to the emitter.
 * This is intentional: a broken downstream handler must not break the upstream write.
 */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(EventBus.name);

  constructor() {
    // Allow many subscribers per event type without warnings
    this.emitter.setMaxListeners(50);
  }

  emit(event: DomainEvent): void {
    this.logger.debug(`emit ${event.type} ${JSON.stringify(event)}`);
    // Defer to next tick so handlers run AFTER the current write transaction settles.
    // This avoids reading stale Prisma data in event handlers.
    setImmediate(() => {
      try {
        this.emitter.emit(event.type, event);
      } catch (err) {
        this.logger.error(`Synchronous error during emit ${event.type}`, err as Error);
      }
    });
  }

  on<T extends DomainEventType>(
    type: T,
    handler: (event: DomainEventOf<T>) => void | Promise<void>,
  ): void {
    this.emitter.on(type, async (event: DomainEventOf<T>) => {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error(`Handler error for ${type}`, err as Error);
      }
    });
  }
}
