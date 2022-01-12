import axios from "axios";
import crypto, { randomUUID } from "crypto";
import express from "express";
import * as jose from "jose";
import qs from "qs";
import { c10nClientDetails } from "../config";

export interface AuthorizedRequest extends express.Request {
  authorizedForPatient?: any;
  authorizedForPatientFullUrl?: string;
  authorizedForPatientHash?: string;
}

export const tokenIntrospectionMiddleware: express.Handler = async (req: AuthorizedRequest, res, next) => {
  try {
    const authz = req.headers.authorization;
    const accessToken = authz.split(/bearer /i, 2)[1];

    /// TODO grab extra connection details from env or a path segment, instead of hardcoding `c10n...`
    /// TODO cache these so we don't make a million calls for every request :-)
    const am = await AuthorizationManager.create(c10nClientDetails);
    const introspectionResponse = await am.introspect(accessToken);
    const { fullUrl, patient } = await am.introspectedPatient(introspectionResponse, accessToken);

    req.authorizedForPatient = patient;
    req.authorizedForPatientFullUrl = fullUrl;
    req.authorizedForPatientHash = crypto.createHash("sha256").update(req.authorizedForPatientFullUrl).digest("base64");
  } catch {}

  next();
};

class AuthorizationManager {
  #clientPrivateKey: jose.KeyLike;
  #clientPublicKeyId: string;
  #clientId: string;
  #canonicalFhirServer: string;
  discoveryResponse: DiscoveryResponse;
  constructor({ clientPrivateKey, clientPublicKeyId, clientId, canonicalFhirServer, discoveryResponse }) {
    this.#clientPrivateKey = clientPrivateKey;
    this.#clientPublicKeyId = clientPublicKeyId;
    this.#clientId = clientId;
    this.#canonicalFhirServer = canonicalFhirServer;
    this.discoveryResponse = discoveryResponse;
  }

  static async create({ clientId, canonicalFhirServer, privateJwk }) {
    const clientPrivateKey = await jose.importJWK(privateJwk, privateJwk.alg);
    const discoveryResponse = (
      await axios({
        method: "GET",
        url: `${canonicalFhirServer}/.well-known/smart-configuration`,
        headers: { accept: "application/json" },
      })
    ).data;

    // workaround for Epic (missing discovery data, but follows this convention)
    if (discoveryResponse.introspection_endpoint === undefined) {
      discoveryResponse.introspection_endpoint = discoveryResponse.token_endpoint.replace(/\/token/, "/introspect");
    }

    return new AuthorizationManager({
      clientId,
      clientPrivateKey,
      clientPublicKeyId: privateJwk.kid,
      canonicalFhirServer,
      discoveryResponse,
    });
  }

  async generateBackendServicesAuthToken() {
    const clientAuthnAssertion = await new jose.SignJWT({
      iss: this.#clientId,
      sub: this.#clientId,
      aud: this.discoveryResponse.token_endpoint,
    })
      .setExpirationTime("2 minutes")
      .setProtectedHeader({
        alg: "RS384",
        typ: "JWT",
        kid: this.#clientPublicKeyId,
      })
      .setJti(randomUUID())
      .sign(this.#clientPrivateKey);

    const tokenRequestParams = {
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAuthnAssertion,
      scope: "system/$introspect",
    };

    const tokenResponse = await axios({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      data: qs.stringify(tokenRequestParams),
      url: this.discoveryResponse.token_endpoint,
    });

    return tokenResponse.data as unknown as AccessTokenResposne;
  }

  async introspect(accessToken) {
    const backendToken = (await this.generateBackendServicesAuthToken()).access_token;

    const introspectResponse = (
      await axios({
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Bearer ${backendToken}`,
        },
        data: qs.stringify({ token: accessToken }),
        url: this.discoveryResponse.introspection_endpoint,
      })
    ).data as IntrospectionResponse;

    return introspectResponse;
  }

  async introspectedPatient(introspected: IntrospectionResponse, accessToken?: string) {
    const backendServicesToken = await this.generateBackendServicesAuthToken();

    // Epic does not yet populate `patient`, so we use `sub` and follow links
    const fhirUser: any = (
      await axios({
        url: introspected.sub,
        headers: {
          authorization: `Bearer ${backendServicesToken.access_token}`,
        },
      })
    ).data;

    let patient;
    let fullUrl;
    if (fhirUser.resourceType === "Patient") {
      fullUrl = introspected.sub;
      patient = fhirUser;
    } else {
      fullUrl = introspected.sub.replace(`RelatedPerson/${fhirUser.id}`, `Patient/${fhirUser.patient.reference}`);
      patient = (
        await axios({
          url: fullUrl,
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        })
      ).data;
    }

    return { patient, fullUrl };
  }
}

export interface AccessTokenResposne {
  access_token: string;
}

export interface DiscoveryResponse {
  token_endpoint: string;
  introspection_endpoint?: string;
}

export interface IntrospectionResponse {
  active: boolean;
  scope: string;
  client_id: string;
  exp: number;
  sub: string;
  iss: string;
}
