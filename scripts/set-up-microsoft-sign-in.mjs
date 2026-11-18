// Sets up "Sign in with Microsoft" on the website: any work or school account, or a personal Microsoft account. The app is
// registered in VDASO's Microsoft directory, so Microsoft's sign-in screen shows it as coming from vdaso.com. It's a public
// client (no secret to keep), coming back to the same return page as email sign-in. Each step is skipped if it's done, so
// it's safe to run again. Uses your Azure CLI sign-in: run `az login` first if it asks.
//   node scripts/set-up-microsoft-sign-in.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORY = "3f85a2ee-4fb3-4db6-b2a9-c33ea30cb80d"; // VDASO (vdaso.com)
const SUBSCRIPTION = "65c0ccca-69f7-43eb-9246-3bd6a6a06b24"; // the HeadJudge subscription, where the site is (its own groups). Always named, as the default stays VDASO.
const RESOURCE_GROUP = "rg-spartanreferee-uksouth";
const SITE_NAME = "spartanreferee";
const SITE = "https://brave-forest-022879f03.3.azurestaticapps.net";
const APP_NAME = "SpartanReferee"; // its own registration: HeadJudge has its own, named HeadJudge
const REDIRECT_URIS = [`${SITE}/email-return.html`]; // api/src/microsoft-signin.js has it too
const MICROSOFT_GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
const SIGN_IN_PERMISSIONS = { openid: "37f7f235-527c-4136-accd-4a02d197296e", profile: "14dad69e-099b-42c9-810b-d002981feec1", email: "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0" };
const here = dirname(fileURLToPath(import.meta.url));
const settingsFile = join(here, "microsoft-sign-in.json");

const az = (...args) => execFileSync("az", args, { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "inherit"] }).trim();
const token = az("account", "get-access-token", "--resource-type", "ms-graph", "--tenant", DIRECTORY, "--query", "accessToken", "--output", "tsv");
async function graph(path, { method = "GET", body, type = "application/json" } = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": type } : {}) },
    ...(body ? { body: type === "application/json" ? JSON.stringify(body) : body } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} failed with status ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

// What the app should look like. Any account may sign in; the ID token carries the address and whether its organisation
// has proved it owns that address's domain (xms_edov), which is what lets an admin sign in with a work account.
const wanted = {
  signInAudience: "AzureADandPersonalMicrosoftAccount",
  isFallbackPublicClient: true,
  publicClient: { redirectUris: REDIRECT_URIS },
  api: { requestedAccessTokenVersion: 2 },
  optionalClaims: { idToken: [{ name: "email", essential: false }, { name: "xms_edov", essential: false }], accessToken: [], saml2Token: [] },
  requiredResourceAccess: [{ resourceAppId: MICROSOFT_GRAPH_APP_ID, resourceAccess: Object.values(SIGN_IN_PERMISSIONS).map((id) => ({ id, type: "Scope" })) }],
  web: { homePageUrl: SITE },
  info: { marketingUrl: SITE },
};

const found = (await graph(`/applications?$filter=displayName eq '${APP_NAME}'&$select=id,appId,signInAudience`)).value;
let app = found.find((a) => a.signInAudience === wanted.signInAudience);
if (!app) {
  console.log(`Registering ${APP_NAME} in the VDASO directory.`);
  app = await graph("/applications", { method: "POST", body: { displayName: APP_NAME, ...wanted } });
} else {
  console.log(`${APP_NAME} is registered already (${app.appId}): bringing its settings up to date.`);
  await graph(`/applications/${app.id}`, { method: "PATCH", body: wanted });
}
// its logo on Microsoft's sign-in screen
await graph(`/applications/${app.id}/logo`, { method: "PUT", body: readFileSync(join(here, "..", "icons", "headjudge", "icon-192.png")), type: "image/png" });
// people in VDASO's own directory sign in through this; elsewhere Microsoft makes one at the first sign-in
const sp = (await graph(`/servicePrincipals?$filter=appId eq '${app.appId}'`)).value[0] ?? await graph("/servicePrincipals", { method: "POST", body: { appId: app.appId } });
console.log(`Service principal: ${sp.id}`);

writeFileSync(settingsFile, `${JSON.stringify({ directory: DIRECTORY, microsoftClientId: app.appId }, null, 2)}\n`);
az("staticwebapp", "appsettings", "set", "--name", SITE_NAME, "--resource-group", RESOURCE_GROUP, "--subscription", SUBSCRIPTION, "--setting-names", `MICROSOFT_CLIENT_ID=${app.appId}`, "--output", "none");
console.log(`\nDone: the site has MICROSOFT_CLIENT_ID=${app.appId}`);
