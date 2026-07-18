import {
  designOptionSchema,
  designOptionSetSchema,
  type DesignOption,
  type DesignOptionSet,
} from "@interior-design/contracts";

import type {
  AbstainOptionAttemptCommand,
  AcknowledgeOptionCancellationCommand,
  AdvanceOptionAttemptCommand,
  ClaimOptionAttemptCommand,
  DesignOptionRepository,
  FailOptionAttemptCommand,
  HeartbeatOptionAttemptCommand,
  PublishOptionSetCommand,
} from "./types.js";

/** Bounded worker-facing publication surface. It has no actor or canonical mutation capability. */
export class DesignOptionWorkerRuntime {
  readonly #repository: DesignOptionRepository;

  constructor(repository: DesignOptionRepository) {
    this.#repository = repository;
  }

  claimNext(command: ClaimOptionAttemptCommand) {
    return Promise.resolve().then(() => this.#repository.claimNext(command));
  }

  heartbeat(command: HeartbeatOptionAttemptCommand) {
    return Promise.resolve().then(() => this.#repository.heartbeatAttempt(command));
  }

  advance(command: AdvanceOptionAttemptCommand) {
    return Promise.resolve().then(() => this.#repository.advanceAttempt(command));
  }

  publish(
    command: Omit<PublishOptionSetCommand, "optionSet" | "options"> & {
      readonly optionSet: DesignOptionSet;
      readonly options: readonly DesignOption[];
    },
  ) {
    return Promise.resolve().then(() =>
      this.#repository.publishOptions({
        ...command,
        optionSet: designOptionSetSchema.parse(command.optionSet),
        options: command.options.map((option) => designOptionSchema.parse(option)),
      }),
    );
  }

  abstain(command: AbstainOptionAttemptCommand) {
    return Promise.resolve().then(() => this.#repository.abstainAttempt(command));
  }

  fail(command: FailOptionAttemptCommand) {
    return Promise.resolve().then(() => this.#repository.failAttempt(command));
  }

  acknowledgeCancellation(command: AcknowledgeOptionCancellationCommand) {
    return Promise.resolve().then(() => this.#repository.acknowledgeCancellation(command));
  }
}
