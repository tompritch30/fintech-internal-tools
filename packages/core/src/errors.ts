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
