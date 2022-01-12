import privateJwks from "./fixtures/RS384.private.json";

export const c10nClientDetails = {
  clientId: "e2748445-72e3-4160-8011-0fa526c616a5",
  privateJwk: privateJwks.keys[1],
  canonicalFhirServer: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
};
