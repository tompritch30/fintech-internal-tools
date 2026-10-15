export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(readonly required: string) {
    super(`Forbidden: requires ${required}`);
    this.name = "ForbiddenError";
  }
}

/** A maker can never be their own checker. */
export class SelfApprovalError extends ForbiddenError {
  constructor() {
    super("approval:not-requester");
    this.name = "SelfApprovalError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
