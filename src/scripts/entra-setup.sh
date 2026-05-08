#!/usr/bin/env bash
set -euo pipefail

# One-time Entra ID prep, driven entirely by ./.env.
# Reconciles the OAuth app used by the consent flow:
#   - finds (by CLIENT_ID) or creates the app registration
#   - syncs displayName, redirectUri, sign-in audience, and Microsoft Graph
#     delegated scopes from .env
#   - ensures a service principal exists in the home tenant
#   - mints a client secret only if .env doesn't already have one
#   - writes CLIENT_ID / CLIENT_SECRET / TENANT back into .env
#
# Inputs read from .env:
#   DISPLAY-NAME   the app's displayName (the heading on the consent screen)
#   REDIRECT_URI   the OAuth redirect URL — must match what the Vercel app sends
#   SCOPES         space-separated Graph delegated scopes
#   CLIENT_ID      (optional) reuse an existing app instead of creating
#   CLIENT_SECRET  (optional) leave secret alone if already populated
#
# Outputs written back to .env:
#   CLIENT_ID, CLIENT_SECRET, TENANT
#
# Safe to re-run.

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }

read_env() {
  local key="$1" val
  val="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  val="${val#\"}"; val="${val%\"}"
  val="${val#\'}"; val="${val%\'}"
  printf '%s' "$val"
}

# Update or insert KEY=value in .env, preserving everything else (comments,
# ordering, unrelated keys). Handles values containing '=' correctly.
write_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      BEGIN{found=0}
      {
        if (!found && index($0, k"=") == 1) { print k"="v; found=1 }
        else { print }
      }
    ' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

# Microsoft Graph delegated permission catalog. Each scope's well-known GUID
# is taken from the published Graph permissions reference. Add more here as
# needed and they become usable in the .env SCOPES line.
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
declare -A GRAPH_SCOPE_IDS=(
  [openid]="37f7f235-527c-4136-accd-4a02d197296e"
  [profile]="14dad69e-099b-42c9-810b-d002981feec1"
  [email]="64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0"
  [offline_access]="7427e0e9-2fba-42fe-b0c0-848c9e6a8182"
  [User.Read]="e1fe6dd8-ba31-4d61-89e7-88639da4683d"
  [User.ReadBasic.All]="b340eb25-3456-403f-be2f-af7a0d370277"
  [Mail.Read]="570282fd-fa5c-430d-a7fd-fc8dc98a9dca"
  [Mail.ReadWrite]="024d486e-b451-40bb-833d-3e66d98c5c73"
  [Mail.Send]="e383f46e-2787-4529-855e-0e479a3ffac0"
  [MailboxSettings.Read]="87f447af-9fa4-4c32-9dfa-4a57a73d18ce"
  [MailboxSettings.ReadWrite]="818c620a-27a9-40bd-a6a5-d96f7d610b4b"
  [Contacts.Read]="ff74d97f-43af-4b68-9f2a-b77ee6968c5d"
  [Calendars.Read]="465a38f9-76ea-45b9-9f34-9e8b0d4b0b42"
  [Files.Read]="025c5429-d3df-4b46-a37f-2e706b46df9b"
  [Files.Read.All]="df85f4d6-205c-4ac5-a5ea-6bf408dba283"
)

# --- Read inputs ---------------------------------------------------------
DISPLAY_NAME="$(read_env 'DISPLAY-NAME')"
[[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="$(read_env DISPLAY_NAME)"
REDIRECT_URI="$(read_env REDIRECT_URI)"
SCOPES="$(read_env SCOPES)"
EXISTING_CLIENT_ID="$(read_env CLIENT_ID || true)"
EXISTING_CLIENT_SECRET="$(read_env CLIENT_SECRET || true)"

[[ -z "$DISPLAY_NAME" ]] && { echo "DISPLAY-NAME (or DISPLAY_NAME) not set in $ENV_FILE"; exit 1; }
[[ -z "$REDIRECT_URI" ]] && { echo "REDIRECT_URI not set in $ENV_FILE"; exit 1; }
[[ -z "$SCOPES" ]]       && { echo "SCOPES not set in $ENV_FILE"; exit 1; }

# --- Verify az context ---------------------------------------------------
echo "Verifying az login..."
if ! az account show >/dev/null 2>&1; then
  echo "Not logged in. Run: az login"
  exit 1
fi
TENANT_ID=$(az account show --query tenantId -o tsv)
SIGNED_IN_AS=$(az account show --query user.name -o tsv)
echo "  Tenant       : $TENANT_ID"
echo "  Signed in as : $SIGNED_IN_AS"

# --- Build requiredResourceAccess from SCOPES ----------------------------
RESOURCE_ACCESS_ENTRIES=()
UNKNOWN_SCOPES=()
for scope in $SCOPES; do
  id="${GRAPH_SCOPE_IDS[$scope]:-}"
  if [[ -z "$id" ]]; then
    UNKNOWN_SCOPES+=("$scope")
    continue
  fi
  RESOURCE_ACCESS_ENTRIES+=("{\"id\":\"$id\",\"type\":\"Scope\"}")
done
if [[ ${#UNKNOWN_SCOPES[@]} -gt 0 ]]; then
  echo "  WARNING: unknown scope(s) — add their GUIDs to GRAPH_SCOPE_IDS:"
  for s in "${UNKNOWN_SCOPES[@]}"; do echo "    - $s"; done
fi
if [[ ${#RESOURCE_ACCESS_ENTRIES[@]} -eq 0 ]]; then
  echo "No recognized scopes in SCOPES; aborting."
  exit 1
fi
RRA_FILE="$(mktemp)"
{
  printf '['
  printf '{"resourceAppId":"%s","resourceAccess":[' "$GRAPH_APP_ID"
  IFS=','; printf '%s' "${RESOURCE_ACCESS_ENTRIES[*]}"; unset IFS
  printf ']}'
  printf ']'
} > "$RRA_FILE"

# --- Find or create the app ---------------------------------------------
echo
echo "Reconciling app: $DISPLAY_NAME"
APP_ID=""
if [[ -n "$EXISTING_CLIENT_ID" ]] && az ad app show --id "$EXISTING_CLIENT_ID" >/dev/null 2>&1; then
  APP_ID="$EXISTING_CLIENT_ID"
  echo "  Found existing app via .env CLIENT_ID: $APP_ID"
else
  APP_ID=$(az ad app list --display-name "$DISPLAY_NAME" --query "[0].appId" -o tsv 2>/dev/null || true)
  [[ -n "$APP_ID" ]] && echo "  Found existing app via displayName: $APP_ID"
fi

if [[ -z "$APP_ID" ]]; then
  echo "  Creating new app..."
  APP_ID=$(az ad app create \
    --display-name "$DISPLAY_NAME" \
    --sign-in-audience "AzureADandPersonalMicrosoftAccount" \
    --web-redirect-uris "$REDIRECT_URI" \
    --required-resource-accesses "@$RRA_FILE" \
    --query appId -o tsv)
  echo "  Created app: $APP_ID"
else
  echo "  Updating app config..."
  az ad app update \
    --id "$APP_ID" \
    --display-name "$DISPLAY_NAME" \
    --web-redirect-uris "$REDIRECT_URI" \
    --required-resource-accesses "@$RRA_FILE" >/dev/null
fi
rm -f "$RRA_FILE"

# --- Service principal in home tenant -----------------------------------
echo "  Ensuring service principal exists..."
az ad sp create --id "$APP_ID" >/dev/null 2>&1 || true

# --- Client secret -------------------------------------------------------
NEED_NEW_SECRET=false
if [[ -z "$EXISTING_CLIENT_SECRET" ]]; then
  NEED_NEW_SECRET=true
  echo "  No CLIENT_SECRET in .env — minting one."
else
  CRED_COUNT=$(az ad app credential list --id "$APP_ID" --query "length(@)" -o tsv 2>/dev/null || echo 0)
  if [[ "$CRED_COUNT" -lt 1 ]]; then
    NEED_NEW_SECRET=true
    echo "  CLIENT_SECRET in .env but app has no credentials — minting fresh."
  else
    echo "  Existing CLIENT_SECRET kept (app has $CRED_COUNT credential(s))."
  fi
fi
NEW_SECRET=""
if $NEED_NEW_SECRET; then
  NEW_SECRET=$(az ad app credential reset \
    --id "$APP_ID" \
    --display-name "entra-setup-$(date +%Y%m%d)" \
    --years 2 \
    --append \
    --query password -o tsv)
fi

# --- Write back ----------------------------------------------------------
echo
echo "Writing values back to $ENV_FILE..."
write_env CLIENT_ID  "$APP_ID"
write_env TENANT     "$TENANT_ID"
[[ -n "$NEW_SECRET" ]] && write_env CLIENT_SECRET "$NEW_SECRET"

# --- Summary -------------------------------------------------------------
urlenc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }

echo
echo "Entra setup complete."
echo "  App (client) ID : $APP_ID"
echo "  Display name    : $DISPLAY_NAME"
echo "  Tenant ID       : $TENANT_ID"
echo "  Redirect URI    : $REDIRECT_URI"
echo "  Scopes          : $SCOPES"
echo
echo "Test consent URL (paste into a browser as a target):"
echo "  https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=$APP_ID&response_type=code&redirect_uri=$(urlenc "$REDIRECT_URI")&response_mode=query&scope=$(urlenc "$SCOPES")&state=test"
