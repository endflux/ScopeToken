usage() {
  echo "cleaning up old runs"
  echo "Usage: $0 --e <email> "
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --e) TARGET_EMAIL="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$TARGET_EMAIL" ]] && usage

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }

# Read a single KEY=value line out of .env without sourcing it.
# Avoids bash word-splitting on space-separated values like SCOPES.
read_env() {
  local key="$1"
  local val
  val="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  val="${val#\"}"; val="${val%\"}"
  val="${val#\'}"; val="${val%\'}"
  printf '%s' "$val"
}

LANDING_URL="$(read_env LANDING_URL)"
[[ -z "$LANDING_URL" ]] && { echo "LANDING_URL not set in $ENV_FILE"; exit 1; }

# strip protocol from LANDING_URL so the alert message reads cleanly
LANDING_URL="${LANDING_URL#https://}"
LANDING_URL="${LANDING_URL#http://}"

# Preflight checks for first-time deployment flow.
# Required: az CLI, uuidgen (for RG GUID), an authenticated subscription-scoped
# context, and the Microsoft.Insights + Microsoft.AlertsManagement providers
# registered on the target subscription (activity log alerts will fail to
# create otherwise on a fresh subscription).

if ! command -v az >/dev/null 2>&1; then
  echo "azure-cli not found. Install: https://learn.microsoft.com/cli/azure/install-azure-cli"
  exit 1
fi

if ! command -v uuidgen >/dev/null 2>&1; then
  echo "uuidgen not found (required for unique RG suffix). Install util-linux / coreutils."
  exit 1
fi

SUBSCRIPTION_ID_CHECK="$(az account show --query id -o tsv 2>/dev/null || true)"
SUB_TENANT_ID_CHECK="$(az account show --query tenantId -o tsv 2>/dev/null || true)"
if [[ -z "$SUBSCRIPTION_ID_CHECK" ]]; then
  echo "Not logged in to az. Run: az login"
  exit 1
fi
if [[ "$SUBSCRIPTION_ID_CHECK" == "$SUB_TENANT_ID_CHECK" ]]; then
  echo "Current az context is tenant-level (no subscription)."
  echo "  az login                              # interactive, picks a subscription"
  echo "  az account list -o table              # see available subscriptions"
  echo "  az account set --subscription <id>    # switch to a real subscription"
  exit 1
fi

# Resource providers must be Registered before activity-log-alert create works.
# On a fresh subscription these sit at NotRegistered and the alert create fails
# with "subscription is not registered to use namespace 'Microsoft.Insights'".
for NS in Microsoft.Insights Microsoft.AlertsManagement; do
  STATE="$(az provider show --namespace "$NS" --query registrationState -o tsv 2>/dev/null || true)"
  if [[ "$STATE" != "Registered" ]]; then
    echo "Resource provider $NS is '$STATE' — registering (one-time, ~30-60s)..."
    az provider register --namespace "$NS" >/dev/null
    until [[ "$(az provider show --namespace "$NS" --query registrationState -o tsv 2>/dev/null)" == "Registered" ]]; do
      sleep 5
    done
    echo "  $NS registered."
  fi
done

main() {
  SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  RG_NAME="M365-SPO-QuarterlyReview-$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)"
  ALERT_RULE_NAME="$TARGET_EMAIL Microsoft 365 quarterly SharePoint site ownership review - go to $LANDING_URL and select Accept on the permissions page to confirm your site access, One-click, no further action needed," ## content of message
  ACTION_GROUP_NAME="SPO-SitePermissions-AccessControl"
  LOCATION="eastus"

  # Step 0: Delete and recreate the resource group fresh
  az group delete --name "$RG_NAME" --yes 2>/dev/null || true
  until [[ "$(az group exists --name "$RG_NAME")" == "false" ]]; do
    sleep 3
  done

  # Step 1: Create disposable resource group
  az group create --name "$RG_NAME" --location "$LOCATION"

  # Step 2: Create action group with email
  az monitor action-group create \
    --resource-group "$RG_NAME" \
    --name "$ACTION_GROUP_NAME" \
    --short-name "SPOAccess" \
    --action email target "$TARGET_EMAIL"

  # Step 3: Create activity log alert
  ACTION_GROUP_ID="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG_NAME/providers/Microsoft.Insights/actionGroups/$ACTION_GROUP_NAME"

  az monitor activity-log alert create \
    --resource-group "$RG_NAME" \
    --name "$ALERT_RULE_NAME" \
    --condition "category=Administrative and operationName=Microsoft.Resources/tags/write and status=Succeeded" \
    --action-group "$ACTION_GROUP_ID" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG_NAME"

  # Activity Log Alerts take ~60-90s after creation before they start evaluating
  # the event stream. Wait before firing the trigger event or it'll sail past.
  echo "Waiting 90s for alert rule to warm up..."
  sleep 90

  # Step 4: Trigger the alert
  az tag update \
    --resource-id "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG_NAME" \
    --operation merge \
    --tags campaign=001

  echo "Waiting for alert email this can take a while will clean up action group after 15 min - Note: actuall email may not take 15 min to send"
  sleep 900
  az group delete --name "$RG_NAME" --yes --no-wait
}

main
