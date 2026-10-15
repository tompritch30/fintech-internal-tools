import * as client from "openid-client";
import type { OidcConfig } from "../config.ts";

/**
 * Rewrites server-to-server URLs from the public issuer to the internal one.
 * Browser redirects are built from metadata and keep the public URL.
 */
export function rewriteToInternal(url: string, issuer: string, internalIssuer?: string): string {
  if (!internalIssuer) return url;
  const pub = new URL(issuer);
  const internal = new URL(internalIssuer);
  const target = new URL(url);
  if (target.origin !== pub.origin) return url;
  return internal.origin + target.pathname + target.search;
}

export async function discoverOidc(config: OidcConfig): Promise<client.Configuration> {
  const fetchImpl: client.CustomFetch = (url, options) =>
    fetch(rewriteToInternal(url, config.issuer, config.internalIssuer), options as RequestInit);
  return client.discovery(
    new URL(config.issuer),
    config.clientId,
    undefined,
    client.ClientSecretPost(config.clientSecret),
    {
      [client.customFetch]: fetchImpl,
      execute: config.allowInsecureHttp ? [client.allowInsecureRequests] : [],
    },
  );
}

export interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function startLogin(
  oidc: client.Configuration,
  redirectUri: string,
): Promise<{ url: URL; attempt: LoginAttempt }> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const attempt: LoginAttempt = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
  };
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    response_type: "code",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state: attempt.state,
    nonce: attempt.nonce,
  });
  return { url, attempt };
}

export interface IdentityClaims {
  subject: string;
  username: string;
  email?: string;
  displayName?: string;
  roles: string[];
  idToken: string;
}

export async function completeLogin(
  oidc: client.Configuration,
  callbackUrl: URL,
  attempt: LoginAttempt,
  rolesClaim: string,
): Promise<IdentityClaims> {
  const tokens = await client.authorizationCodeGrant(oidc, callbackUrl, {
    pkceCodeVerifier: attempt.codeVerifier,
    expectedState: attempt.state,
    expectedNonce: attempt.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || !tokens.id_token) throw new Error("OIDC: no ID token returned");
  const rawRoles = claims[rolesClaim];
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    subject: claims.sub,
    username: str(claims.preferred_username) ?? str(claims.email) ?? claims.sub,
    email: str(claims.email),
    displayName: str(claims.name),
    roles: Array.isArray(rawRoles) ? rawRoles.filter((r): r is string => typeof r === "string") : [],
    idToken: tokens.id_token,
  };
}

export function buildLogoutUrl(
  oidc: client.Configuration,
  postLogoutRedirectUri: string,
  idToken?: string | null,
): URL | null {
  if (!oidc.serverMetadata().end_session_endpoint) return null;
  return client.buildEndSessionUrl(oidc, {
    post_logout_redirect_uri: postLogoutRedirectUri,
    ...(idToken ? { id_token_hint: idToken } : {}),
  });
}
