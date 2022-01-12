import express from "express";
import * as jose from "jose";
import cors from "cors";
import path from "path";
import imagingStudyBundle from "./fixtures/Bundle.ImagingStudy.json";
import { tokenIntrospectionMiddleware, AuthorizedRequest } from "./AuthzMiddleware";

const PORT = parseInt(process.env.PORT || "3000");
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

export function createApp() {
  const app = express();
  app.use(cors());
  app.set("json spaces", 2);
  app.use(tokenIntrospectionMiddleware);

  app.get("/fhir/ImagingStudy", function (req: AuthorizedRequest, res, next) {
    const patient = req.query.patient;
    if (patient !== req?.authorizedForPatient?.id) {
      res.status(401);
      return res.json({
        error: "Unauthorized",
        message: `Requested data for Patient ${req.query.patient} but access token is only authorized for ${req?.authorizedForPatient?.id}`,
      });
    }

    const response = JSON.parse(JSON.stringify(imagingStudyBundle));
    response.entry.forEach((e) => {
      e.fullUrl = `${PUBLIC_URL}/fhir/ImagingStudy/${e.resource.id}`;
      e.resource.contained[0].address = `${PUBLIC_URL}/dicom/${req.authorizedForPatientHash}/$wado-rs/studies/${
        e.resource.identifier[0].value.split("urn:oid:")[1]
      }`;
      e.resource.subject.reference = req.authorizedForPatientFullUrl;
    });

    res.json(response);
  });

  app.get("/dicom/:pid/\\$wado-rs/studies/:oid", function (req: AuthorizedRequest, res, next) {
    const patient = req.params.pid;
    if (patient !== req.authorizedForPatientHash) {
      res.status(401);
      return res.json({
        error: "Unauthorized",
        message: `Requested data for Patient ${req.query.patient} but access token is only authorized for ${req?.authorizedForPatientFullUrl}`,
      });
    }
    res.sendFile(path.join(__dirname, "fixtures", `${req.params.oid}.dcm`));
  });

  app.get("/hello", function (req, res) {
    res.send("Hello World");
  });

  return app;
}