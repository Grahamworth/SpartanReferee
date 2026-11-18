// Sets up email accounts for companies on the website: Microsoft Entra External ID, as FinFun uses. Microsoft sends the
// emails (the code that proves an address at sign-up, the code at each sign-in, password reset), so this needs no
// mail service or DNS. Each step is skipped if it's done, so it's safe to run again.
//   node scripts/set-up-email-sign-in.mjs --tenant-only   creates the tenant (up to 30 minutes), with no sign-in
//   node scripts/set-up-email-sign-in.mjs                 asks for one Microsoft sign-in by code, then does the rest
// The rest is: the app (a public client, so there's no secret to keep), the sign-up flow, emailed codes as the second
// step, a Conditional Access policy requiring it, and the site's settings.
// Microsoft refuses a policy aimed at a public client, so this one covers everything in the tenant, which holds only
// this app. The admin running this is left out, as Microsoft advises, so the policy can't lock them out.
// Security defaults are turned off in this tenant only, because Microsoft doesn't allow them alongside that policy.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const SUBSCRIPTION = "65c0ccca-69f7-43eb-9246-3bd6a6a06b24"; // the HeadJudge subscription (SpartanReferee has its own groups). Always named, as the default stays VDASO.
const RESOURCE_GROUP = "rg-spartanreferee-uksouth";
const SITE = "spartanreferee";
const SUBDOMAIN = "spartanreferee";
const TENANT_NAME = "SpartanReferee";
const APP_NAME = "SpartanReferee"; // how this finds it in its own directory
// api/src/email-signin.js has this too
const REDIRECT_URIS = ["https://brave-forest-022879f03.3.azurestaticapps.net/email-return.html"];
const USER_FLOW_NAME = "BroadcasterSignUpSignIn";
const POLICY_NAME = "SpartanReferee: require MFA";

const ARM = "https://management.azure.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const CIAM_API_VERSION = "2023-05-17-preview";
const MICROSOFT_GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
// Microsoft Graph Command Line Tools, Microsoft's public app for scripts like this one.
const GRAPH_TOOLS_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const SIGN_IN_PERMISSIONS = {
  openid: "37f7f235-527c-4136-accd-4a02d197296e",
  profile: "14dad69e-099b-42c9-810b-d002981feec1",
  email: "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0",
};
const SCOPES = [
  "Application.ReadWrite.All", "DelegatedPermissionGrant.ReadWrite.All", "EventListener.ReadWrite.All",
  "Policy.Read.All", "Policy.ReadWrite.ConditionalAccess", "Policy.ReadWrite.AuthenticationMethod", "Policy.ReadWrite.SecurityDefaults",
].join(" ");
const ALL_USERS = [{ targetType: "group", id: "all_users", isRegistrationRequired: false }];
const TENANT_WAIT_MINUTES = 45;
const DEFAULTS_WAIT_MINUTES = 15;

const { values } = parseArgs({ options: { "tenant-only": { type: "boolean", default: false } } });
const settingsFile = join(dirname(fileURLToPath(import.meta.url)), "email-sign-in.json");
const az = (...args) => execFileSync("az", [...args, "--subscription", SUBSCRIPTION], { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "inherit"] }).trim();

async function arm(path, { method = "GET", body } = {}) {
  const response = await fetch(`${ARM}${path}`, {
    method,
    headers: { Authorization: `Bearer ${az("account", "get-access-token", "--query", "accessToken", "--output", "tsv")}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404 && method === "GET") return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} failed with status ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function createTenant() {
  const path = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.AzureActiveDirectory/ciamDirectories/${SUBDOMAIN}?api-version=${CIAM_API_VERSION}`;
  let tenant = await arm(path);
  if (!tenant) {
    console.log(`Creating the ${TENANT_NAME} tenant. This can take up to 30 minutes.`);
    tenant = await arm(path, {
      method: "PUT",
      body: { location: "Europe", sku: { name: "Standard", tier: "A0" }, properties: { createTenantProperties: { displayName: TENANT_NAME, countryCode: "GB" } } },
    });
  }
  const deadline = Date.now() + TENANT_WAIT_MINUTES * 60_000;
  while (tenant?.properties?.provisioningState !== "Succeeded") {
    const state = tenant?.properties?.provisioningState;
    if (state === "Failed" || state === "Canceled") throw new Error(`Creating the tenant ended as ${state}.`);
    if (Date.now() > deadline) throw new Error("The tenant isn't ready yet. Run this again later to carry on.");
    await sleep(30_000);
    tenant = await arm(path);
  }
  console.log(`The tenant is ready: ${tenant.properties.domainName}`);
  return tenant.properties.tenantId;
}

async function signInWithCode(tenantId) {
  const base = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
  const form = (fields) => ({ method: "POST", body: new URLSearchParams(fields) });
  const start = await fetch(`${base}/devicecode`, form({ client_id: GRAPH_TOOLS_CLIENT_ID, scope: SCOPES }));
  const device = await start.json();
  if (!start.ok) throw new Error(`Microsoft refused the sign-in: ${device.error_description ?? device.error}`);
  console.log(`\nTo sign in, open ${device.verification_uri} in a private window and enter the code ${device.user_code}\n`);
  const deadline = Date.now() + device.expires_in * 1000;
  let wait = device.interval;
  while (Date.now() < deadline) {
    await sleep(wait * 1000);
    const response = await fetch(`${base}/token`, form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: GRAPH_TOOLS_CLIENT_ID, device_code: device.device_code }));
    const result = await response.json();
    if (response.ok) return result.access_token;
    if (result.error === "slow_down") wait += 5;
    else if (result.error !== "authorization_pending") throw new Error(`Sign-in failed: ${result.error_description ?? result.error}`);
  }
  throw new Error("The code expired before you signed in.");
}

function makeGraph(token) {
  return async function graph(path, { method = "GET", body } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(`${GRAPH}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : null;
      if (response.status === 404 && method === "GET") return null;
      // A new tenant can take a few minutes to accept calls, and Microsoft limits how quickly settings can change.
      const retryable = response.status === 401 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= 8) throw new Error(`${method} ${path.split("?")[0]} failed with status ${response.status}: ${text.slice(0, 500)}`);
      await sleep(Number(response.headers.get("retry-after") ?? 30) * 1000);
    }
  };
}

async function createApp(graph) {
  const found = await graph(`/applications?$filter=displayName eq '${APP_NAME}'`);
  const existing = found?.value?.[0];
  if (existing) {
    const known = existing.publicClient?.redirectUris ?? [];
    if (REDIRECT_URIS.some((uri) => !known.includes(uri))) {
      console.log("Adding the website's return address.");
      await graph(`/applications/${existing.id}`, { method: "PATCH", body: { publicClient: { redirectUris: [...new Set([...known, ...REDIRECT_URIS])] } } });
    }
    return existing;
  }
  console.log(`Creating the ${APP_NAME} app.`);
  return graph("/applications", {
    method: "POST",
    body: {
      displayName: APP_NAME,
      signInAudience: "AzureADMyOrg",
      publicClient: { redirectUris: REDIRECT_URIS },
      // so the ID token carries the address the person signed up with
      optionalClaims: { idToken: [{ name: "email", essential: false }] },
      requiredResourceAccess: [{ resourceAppId: MICROSOFT_GRAPH_APP_ID, resourceAccess: Object.values(SIGN_IN_PERMISSIONS).map((id) => ({ id, type: "Scope" })) }],
    },
  });
}

// People signing up can't approve permissions themselves in this kind of tenant, so an admin does.
async function approvePermissions(graph, appId) {
  const found = await graph(`/servicePrincipals?$filter=appId eq '${appId}'`);
  const servicePrincipal = found?.value?.[0] ?? await graph("/servicePrincipals", { method: "POST", body: { appId } });
  const grants = await graph(`/servicePrincipals/${servicePrincipal.id}/oauth2PermissionGrants`);
  if (grants?.value?.length) return;
  const microsoftGraph = await graph(`/servicePrincipals(appId='${MICROSOFT_GRAPH_APP_ID}')`);
  await graph("/oauth2PermissionGrants", { method: "POST", body: { clientId: servicePrincipal.id, consentType: "AllPrincipals", resourceId: microsoftGraph.id, scope: Object.keys(SIGN_IN_PERMISSIONS).join(" ") } });
}

async function createUserFlow(graph, appId) {
  const flows = await graph("/identity/authenticationEventsFlows");
  if (flows?.value?.some((flow) => flow.displayName === USER_FLOW_NAME)) return;
  console.log(`Creating the ${USER_FLOW_NAME} user flow.`);
  await graph("/identity/authenticationEventsFlows", {
    method: "POST",
    body: {
      "@odata.type": "#microsoft.graph.externalUsersSelfServiceSignUpEventsFlow",
      displayName: USER_FLOW_NAME,
      conditions: { applications: { includeApplications: [{ appId }] } },
      onAuthenticationMethodLoadStart: { "@odata.type": "#microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp", identityProviders: [{ id: "EmailPassword-OAUTH" }] },
      onInteractiveAuthFlowStart: { "@odata.type": "#microsoft.graph.onInteractiveAuthFlowStartExternalUsersSelfServiceSignUp", isSignUpAllowed: true },
      onAttributeCollection: {
        "@odata.type": "#microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp",
        attributes: [
          { id: "email", displayName: "Email Address", description: "Email address of the user", userFlowAttributeType: "builtIn", dataType: "string" },
          { id: "displayName", displayName: "Display Name", description: "Display Name of the User.", userFlowAttributeType: "builtIn", dataType: "string" },
        ],
        attributeCollectionPage: {
          views: [{
            inputs: [
              { attribute: "email", label: "Email Address", inputType: "text", hidden: true, editable: false, writeToDirectory: true, required: true, validationRegEx: "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*$" },
              // Microsoft's example pattern would turn away names like O'Brien or Smith-Jones.
              { attribute: "displayName", label: "Your name", inputType: "text", hidden: false, editable: true, writeToDirectory: true, required: true, validationRegEx: "^[^<>]{1,100}$" },
            ],
          }],
        },
      },
    },
  });
}

async function enableEmailCodes(graph) {
  await graph("/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email", {
    method: "PATCH",
    body: { "@odata.type": "#microsoft.graph.emailAuthenticationMethodConfiguration", state: "enabled", includeTargets: ALL_USERS },
  });
  const { authenticationMethodConfigurations: methods } = await graph("/policies/authenticationMethodsPolicy");
  console.log("Sign-in methods now on:", methods.filter((entry) => entry.state === "enabled").map((entry) => entry.id).join(", "));
}

async function requireMfa(graph, adminId) {
  const { value: policies } = await graph("/identity/conditionalAccess/policies");
  const existing = policies.find((policy) => policy.displayName === POLICY_NAME);
  if (existing) { console.log(`The "${POLICY_NAME}" policy is already there, and is ${existing.state}.`); return; }
  const defaultsPath = "/policies/identitySecurityDefaultsEnforcementPolicy";
  const defaultsWereOn = (await graph(defaultsPath)).isEnabled;
  if (defaultsWereOn) await graph(defaultsPath, { method: "PATCH", body: { isEnabled: false } });
  try {
    // Microsoft can take a while to notice that security defaults are off, and refuses the policy until it does.
    const deadline = Date.now() + DEFAULTS_WAIT_MINUTES * 60_000;
    for (;;) {
      try {
        await graph("/identity/conditionalAccess/policies", {
          method: "POST",
          body: {
            displayName: POLICY_NAME,
            state: "enabled",
            conditions: { clientAppTypes: ["all"], applications: { includeApplications: ["All"] }, users: { includeUsers: ["All"], excludeUsers: [adminId] } },
            grantControls: { operator: "OR", builtInControls: ["mfa"] },
          },
        });
        break;
      } catch (error) {
        if (!/Security Defaults is enabled/i.test(error.message) || Date.now() > deadline) throw error;
        console.log("Waiting for Microsoft to register that security defaults are off.");
        await sleep(30_000);
      }
    }
  } catch (error) {
    if (defaultsWereOn) await graph(defaultsPath, { method: "PATCH", body: { isEnabled: true } });
    throw error;
  }
  console.log(`Created the "${POLICY_NAME}" policy.`);
}

try {
  const tenantId = await createTenant();
  if (!values["tenant-only"]) {
    const token = await signInWithCode(tenantId);
    const adminId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).oid;
    const graph = makeGraph(token);
    const app = await createApp(graph);
    await approvePermissions(graph, app.appId);
    await createUserFlow(graph, app.appId);
    await enableEmailCodes(graph);
    await requireMfa(graph, adminId);

    const discovery = await fetch(`https://${SUBDOMAIN}.ciamlogin.com/${tenantId}/v2.0/.well-known/openid-configuration`);
    if (!discovery.ok) throw new Error(`Microsoft doesn't recognise the new tenant yet (status ${discovery.status}). Run this again in a few minutes.`);

    // None of these is a secret: the app is a public client, and they all appear in the sign-in address.
    const settings = { ciamSubdomain: SUBDOMAIN, ciamTenantId: tenantId, ciamClientId: app.appId };
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    az("staticwebapp", "appsettings", "set", "--name", SITE, "--resource-group", RESOURCE_GROUP, "--setting-names", `CIAM_SUBDOMAIN=${SUBDOMAIN}`, `CIAM_TENANT_ID=${tenantId}`, `CIAM_CLIENT_ID=${app.appId}`, "--output", "none");
    console.log("\nSetup is saved, and the site has its settings.");
  }
} catch (error) {
  console.error(`\nSetup didn't finish: ${error instanceof Error ? error.message : "see above"}`);
  console.error("You can run this again, and it will carry on from where it stopped.");
  process.exitCode = 1;
}
if (existsSync(settingsFile)) console.log(readFileSync(settingsFile, "utf8"));
