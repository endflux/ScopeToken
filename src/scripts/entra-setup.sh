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

# Microsoft Graph delegated permission lookup. Resolves scope -> GUID
# dynamically from the Graph service principal so any delegated scope
# Microsoft publishes is usable in the .env SCOPES line — no static catalog.
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

resolve_scope_id() {
  local scope="$1"
  az ad sp show --id "$GRAPH_APP_ID" \
    --query "oauth2PermissionScopes[?value=='$scope'].id | [0]" \
    -o tsv 2>/dev/null
}

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
SEEN_IDS=""
echo "Resolving SCOPES against Microsoft Graph SP..."
for scope in $SCOPES; do
  id="$(resolve_scope_id "$scope")"
  id="${id//$'\r'/}"
  id="${id//$'\n'/}"
  id="${id## }"; id="${id%% }"
  if [[ -z "$id" || "$id" == "null" || "$id" == "None" ]]; then
    echo "  $scope -> (NOT FOUND)"
    UNKNOWN_SCOPES+=("$scope")
    continue
  fi
  if [[ "$SEEN_IDS" == *"|$id|"* ]]; then
    echo "  $scope -> $id  (DUPLICATE — skipping)"
    continue
  fi
  SEEN_IDS="${SEEN_IDS}|$id|"
  echo "  $scope -> $id"
  RESOURCE_ACCESS_ENTRIES+=("{\"id\":\"$id\",\"type\":\"Scope\"}")
done
if [[ ${#UNKNOWN_SCOPES[@]} -gt 0 ]]; then
  echo "  WARNING: scope(s) not found on Microsoft Graph SP:"
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
echo "Required resource access payload:"
cat "$RRA_FILE"
echo

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
    --sign-in-audience "AzureADMultipleOrgs" \
    --web-redirect-uris "$REDIRECT_URI" \
    --required-resource-accesses "@$RRA_FILE" \
    --query appId -o tsv)
  echo "  Created app: $APP_ID"
else
  echo "  Updating app config..."
  az ad app update \
    --id "$APP_ID" \
    --display-name "$DISPLAY_NAME" \
    --sign-in-audience "AzureADMultipleOrgs" \
    --web-redirect-uris "$REDIRECT_URI" \
    --required-resource-accesses "@$RRA_FILE" >/dev/null
fi
rm -f "$RRA_FILE"

# --- Service principal in home tenant -----------------------------------
echo "  Ensuring service principal exists..."
az ad sp create --id "$APP_ID" >/dev/null 2>&1 || true

# --- Revoke stale consents so new SCOPES take effect immediately ---------
# requiredResourceAccess on the app reg is already replaced above. But any
# oauth2PermissionGrants on the SP from previous consents persist and can
# cause the consent screen to be skipped or bind tokens to old scopes.
# Deleting them forces a fresh consent prompt that matches current SCOPES.
SP_OBJECT_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || true)"
if [[ -n "$SP_OBJECT_ID" ]]; then
  echo "  Revoking stale oauth2PermissionGrants on SP $SP_OBJECT_ID..."
  GRANT_IDS="$(az rest --method get \
    --uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?\$filter=clientId eq '$SP_OBJECT_ID'" \
    --query "value[].id" -o tsv 2>/dev/null || true)"
  if [[ -z "$GRANT_IDS" ]]; then
    echo "    (none)"
  else
    while IFS= read -r gid; do
      [[ -z "$gid" ]] && continue
      az rest --method delete \
        --uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$gid" \
        >/dev/null 2>&1 && echo "    deleted $gid" || echo "    failed $gid"
    done <<< "$GRANT_IDS"
  fi
fi

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
