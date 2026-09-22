export class McpUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUserError";
  }
}

export class AuthenticationRequiredError extends McpUserError {
  constructor() {
    super("Zocial Eye is not ready in the dedicated Chrome profile. Complete sign-in in the visible Chrome window, then call zocialeye_auth_status again.");
    this.name = "AuthenticationRequiredError";
  }
}

export class SourceStateError extends McpUserError {
  constructor(message: string) {
    super(message);
    this.name = "SourceStateError";
  }
}
