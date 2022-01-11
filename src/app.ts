import express from "express";
import * as jose from "jose";
import qs from "qs";
import cors from "cors";
import { randomUUID } from "crypto";
import path from "path";
import axios from "axios";
import imagingStudyBundle from "./fixtures/Bundle.ImagingStudy.json";
import privateJwks from "./fixtures/RS384.private.json";

const PORT = parseInt(process.env.PORT || "3000");
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const clientDetails = {
  clientPrivateKey: jose.importJWK(privateJwks.keys[1], "RS384"),
  clientId: "e2748445-72e3-4160-8011-0fa526c616a5",
  tokenEndpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
  introspectEndpoint:
    "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/introspect",
};

interface AccessTokenResposne {
  access_token: string;
}

interface IntrospectionResponse {
  active: boolean;
  scope: string;
  client_id: string;
  exp: number;
  sub: string;
  iss: string;
}

async function generateBackendServicesAuthToken() {
  const clientAuthnAssertion = await new jose.SignJWT({
    iss: clientDetails.clientId,
    sub: clientDetails.clientId,
    aud: clientDetails.tokenEndpoint,
  })
    .setExpirationTime("2 minutes")
    .setProtectedHeader({
      alg: "RS384",
      typ: "JWT",
      kid: privateJwks.keys[1].kid,
    })
    .setJti(randomUUID())
    .sign(await clientDetails.clientPrivateKey);

  const tokenRequestParams = {
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAuthnAssertion,
  };

  const tokenResponse = await axios({
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    data: qs.stringify(tokenRequestParams),
    url: clientDetails.tokenEndpoint,
  });

  return tokenResponse.data as unknown as AccessTokenResposne;
}

async function introspect(accessToken) {
  const backendToken = (await generateBackendServicesAuthToken()).access_token;

  const introspectResponse = (
    await axios({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${backendToken}`,
      },
      data: qs.stringify({ token: accessToken }),
      url: clientDetails.introspectEndpoint,
    })
  ).data as IntrospectionResponse;

  return introspectResponse;
}

interface AuthorizedRequest {
  fhirPatient?: string;
}

interface AuthorizedRequest extends express.Request {
  authorizedForPatient?: any;
  authorizedForPatientFullUrl?: string;
}

const tokenIntrospectionMiddleware: express.Handler = async (
  req: AuthorizedRequest,
  res,
  next
) => {
  try {
    const authz = req.headers.authorization;
    const accessToken = authz.split(/bearer /i, 2)[1];
    const introspected = await introspect(accessToken);

    const fhirUser: any = (
      await axios({
        url: introspected.sub,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      })
    ).data;

    let patient;
    let fullUrl;
    if (fhirUser.resourceType === "Patient") {
      fullUrl = introspected.sub;
      patient = fhirUser;
    } else {
      fullUrl = introspected.sub.replace(
        `RelatedPerson/${fhirUser.id}`,
        `Patient/${fhirUser.patient.reference}`
      );
      patient = (
        await axios({
          url: fullUrl,
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        })
      ).data;
    }

    console.log("user", fhirUser.data);
    console.log("patient", patient);
    req.authorizedForPatient = patient;
    req.authorizedForPatientFullUrl = fullUrl;
  } catch {}
  next();
};

export function createApp() {
  const app = express();

  app.use(cors());
  app.set("json spaces", 2);
  app.use(tokenIntrospectionMiddleware);

  app.get("/fhir/ImagingStudy", function (req: AuthorizedRequest, res, next) {
    const patient = req.query.patient;
    if (patient !== req.authorizedForPatient.id) {
      res.status(401);
      return res.json({
        error: "Unauthorized",
        message: `Requested data for Patient ${req.query.patient} but access token is only authorized for ${req.authorizedForPatient.id}`,
      });
    }

    const response = JSON.parse(JSON.stringify(imagingStudyBundle));
    response.entry.forEach((e) => {
      e.fullUrl = `${PUBLIC_URL}/fhir/ImagingStudy/${e.resource.id}`;
      e.resource.contained[0].address = `${PUBLIC_URL}/fhir/Patient/${
        req.query.patient
      }/$wado-rs/studies/${
        e.resource.identifier[0].value.split("urn:oid:")[1]
      }`;
      e.resource.subject.reference = req.authorizedForPatientFullUrl;
    });

    res.json(response);
  });

  app.get(
    "/fhir/Patient/:pid/\\$wado-rs/studies/:oid",
    function (req: AuthorizedRequest, res, next) {
      const patient = req.params.pid;
      if (patient !== req.authorizedForPatient.id) {
        res.status(401);
        return res.json({
          error: "Unauthorized",
          message: `Requested data for Patient ${req.query.patient} but access token is only authorized for ${req.authorizedForPatient.id}`,
        });
      }

      res.sendFile(path.join(__dirname, "fixtures", `${req.params.oid}.dcm`));
    }
  );

  app.get("/hello", function (req, res) {
    res.send("Hello World");
  });

  return app;
}
